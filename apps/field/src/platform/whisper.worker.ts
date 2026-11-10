/// <reference lib="webworker" />
/**
 * Runs Whisper (transformers.js + ONNX Runtime WASM) off the UI thread.
 * Audio arrives as a Float32Array and is dropped after each pass. Nothing
 * here touches the network except the one-time model download the person
 * starts from Setup (source "remote").
 */
import { env, pipeline } from "@huggingface/transformers";
import type { FromWorker, ToWorker } from "./whisper-protocol";
import { SAMPLE_RATE, WHISPER_DTYPE, type AsrChunk } from "./whisper-util";

type Asr = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text: string; chunks?: AsrChunk[] }>;

const post = (m: FromWorker) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

let asr: Asr | null = null;
let queue: Promise<unknown> = Promise.resolve();

function configure(base: string, source: "bundled" | "remote") {
  // transformers.js 4.3.2's local-model path skips existence checks for
  // http(s) model paths (tokenizer and preprocessor then count as missing),
  // so the app itself is used as the model host instead:
  // - "bundled": files come from this app's own ./models/ folder. The model
  //   hub is never contacted. The service worker keeps them for offline use.
  // - "remote": the one-time download from the model hub into Cache Storage.
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useFS = false;
  if (source === "bundled") {
    env.remoteHost = new URL("./", base).href;
    env.remotePathTemplate = "models/{model}/";
    env.useBrowserCache = false;
  } else {
    env.remoteHost = "https://huggingface.co/";
    env.remotePathTemplate = "{model}/resolve/{revision}/";
    env.useBrowserCache = true;
  }
  // Load the wasm files directly from ./ort/ (no blob: imports, no CDN).
  env.useWasmCache = false;
  const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number; proxy?: boolean } };
  if (onnx.wasm) {
    onnx.wasm.wasmPaths = {
      mjs: new URL("./ort/ort-wasm-simd-threaded.mjs", base).href,
      wasm: new URL("./ort/ort-wasm-simd-threaded.wasm", base).href,
    };
    onnx.wasm.proxy = false;
    if (!(self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated) onnx.wasm.numThreads = 1;
  }
}

async function load(msg: Extract<ToWorker, { type: "load" }>) {
  try {
    configure(msg.base, msg.source);
    asr = (await pipeline("automatic-speech-recognition", msg.repo, {
      dtype: WHISPER_DTYPE,
      device: "wasm",
      progress_callback: (p: { status?: string; file?: string; loaded?: number; total?: number }) => {
        if (p.status === "progress" && p.file) post({ type: "progress", file: p.file, loaded: p.loaded ?? 0, total: p.total ?? 0 });
      },
    })) as unknown as Asr;
    post({ type: "ready" });
  } catch (e) {
    asr = null;
    post({ type: "load_error", message: (e as Error).message || String(e) });
  }
}

async function transcribe(msg: Extract<ToWorker, { type: "transcribe" }>) {
  if (!asr) return post({ type: "error", id: msg.id, message: "Voice model is not loaded" });
  try {
    const long = msg.audio.length > SAMPLE_RATE * 28;
    const out = await asr(msg.audio, {
      return_timestamps: true,
      ...(long ? { chunk_length_s: 30, stride_length_s: 5 } : {}),
    });
    post({ type: "result", id: msg.id, text: out.text ?? "", chunks: (out.chunks ?? []).map((c) => ({ timestamp: [...c.timestamp], text: c.text })) });
  } catch (e) {
    post({ type: "error", id: msg.id, message: (e as Error).message || String(e) });
  }
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  // One job at a time, in order.
  queue = queue.then(() => (msg.type === "load" ? load(msg) : transcribe(msg)));
};
