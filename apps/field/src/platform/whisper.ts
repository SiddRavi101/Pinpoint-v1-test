/**
 * On-device Whisper speech engine (REQ-001, REQ-002).
 *
 * - The model runs in a Web Worker from files on this phone: bundled in the
 *   app under ./models/, or downloaded once (model only) into Cache Storage.
 * - Mic audio is captured with Web Audio at 16 kHz mono and held in memory
 *   only. It is never written to storage or sent anywhere, and the buffer is
 *   dropped as soon as the final text is ready.
 */
import type { Utterance } from "@pinpoint/core";
import type { FromWorker, ToWorker } from "./whisper-protocol";
import {
  SAMPLE_RATE,
  REQUIRED_FILES,
  concatFloat32,
  cleanTranscript,
  isSilent,
  looksLikeWhisperConfig,
  resampleLinear,
  toSegments,
  type WhisperModel,
} from "./whisper-util";

/** Where the model files are, if anywhere. */
export type ModelLocation = "bundled" | "downloaded" | "missing";

const HF_CACHE = "transformers-cache";
const hubUrl = (repo: string, file: string) => `https://huggingface.co/${repo}/resolve/main/${file}`;

/** Absolute URL of the app root, so the worker (under assets/) finds ./models and ./ort. */
export const appBase = (): string => new URL("./", document.baseURI).href;

export function micSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof AudioContext !== "undefined" && typeof Worker !== "undefined";
}

/** Find the model: bundled with the app first, then a previous one-time download. */
export async function locateModel(model: WhisperModel): Promise<ModelLocation> {
  try {
    const r = await fetch(new URL(`./models/${model.repo}/config.json`, appBase()).href, { cache: "no-cache" });
    if (r.ok && looksLikeWhisperConfig(await r.text())) return "bundled";
  } catch {
    /* not bundled */
  }
  try {
    if (typeof caches === "undefined" || !(await caches.has(HF_CACHE))) return "missing";
    const c = await caches.open(HF_CACHE);
    for (const f of REQUIRED_FILES) if (!(await c.match(hubUrl(model.repo, f)))) return "missing";
    return "downloaded";
  } catch {
    return "missing";
  }
}

export interface LoadProgress {
  /** 0..1 across the files seen so far. */
  fraction: number;
  file: string;
}

/** Owns the worker and the loaded model. */
class WhisperRuntime {
  private worker?: Worker;
  private loaded?: { repo: string; promise: Promise<void> };
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: { text: string; chunks: import("./whisper-util").AsrChunk[] }) => void; reject: (e: Error) => void }>();
  private onLoadMsg?: (m: FromWorker) => void;

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module", name: "whisper" });
    w.onmessage = (ev: MessageEvent<FromWorker>) => {
      const m = ev.data;
      if (m.type === "result" || m.type === "error") {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (!p) return;
        if (m.type === "result") p.resolve({ text: m.text, chunks: m.chunks });
        else p.reject(new Error(m.message));
      } else this.onLoadMsg?.(m);
    };
    w.onerror = (ev) => {
      const err = new Error(ev.message || "Voice engine stopped");
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      this.onLoadMsg?.({ type: "load_error", message: err.message });
    };
    this.worker = w;
    return w;
  }

  load(model: WhisperModel, source: "bundled" | "remote", onProgress?: (p: LoadProgress) => void): Promise<void> {
    if (this.loaded?.repo === model.repo) return this.loaded.promise;
    // A different model: start a fresh worker so the old one's memory is freed.
    this.worker?.terminate();
    this.worker = undefined;
    const files = new Map<string, { loaded: number; total: number }>();
    const promise = new Promise<void>((resolve, reject) => {
      this.onLoadMsg = (m) => {
        if (m.type === "progress") {
          files.set(m.file, { loaded: m.loaded, total: m.total });
          let l = 0;
          let t = 0;
          for (const f of files.values()) (l += f.loaded), (t += f.total);
          onProgress?.({ fraction: t ? l / t : 0, file: m.file });
        } else if (m.type === "ready") resolve();
        else if (m.type === "load_error") reject(new Error(m.message));
      };
      const msg: ToWorker = { type: "load", repo: model.repo, base: appBase(), source };
      this.ensureWorker().postMessage(msg);
    });
    this.loaded = { repo: model.repo, promise };
    promise.catch(() => {
      if (this.loaded?.promise === promise) this.loaded = undefined;
    });
    return promise;
  }

  transcribe(audio: Float32Array): Promise<{ text: string; chunks: import("./whisper-util").AsrChunk[] }> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const msg: ToWorker = { type: "transcribe", id, audio };
      this.ensureWorker().postMessage(msg, [audio.buffer]);
    });
  }
}

export const whisperRuntime = new WhisperRuntime();

/** Mic capture into memory. One instance per utterance. */
class MicCapture {
  private stream?: MediaStream;
  private ctx?: AudioContext;
  private node?: ScriptProcessorNode;
  private source?: MediaStreamAudioSourceNode;
  private chunks: Float32Array[] = [];
  private rate = SAMPLE_RATE;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    try {
      this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    } catch {
      this.ctx = new AudioContext();
    }
    this.rate = this.ctx.sampleRate;
    this.source = this.ctx.createMediaStreamSource(this.stream);
    // ScriptProcessor is deprecated but works in every WebView without an extra module file.
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.node.onaudioprocess = (ev) => {
      this.chunks.push(new Float32Array(ev.inputBuffer.getChannelData(0)));
    };
    this.source.connect(this.node);
    this.node.connect(this.ctx.destination);
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  /** A 16 kHz copy of everything so far. */
  snapshot(): Float32Array {
    return resampleLinear(concatFloat32(this.chunks), this.rate, SAMPLE_RATE);
  }

  get seconds(): number {
    let n = 0;
    for (const c of this.chunks) n += c.length;
    return n / this.rate;
  }

  async stop(): Promise<Float32Array> {
    const audio = this.snapshot();
    this.chunks = [];
    this.node?.disconnect();
    this.source?.disconnect();
    if (this.node) this.node.onaudioprocess = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close().catch(() => undefined);
    this.node = undefined;
    this.source = undefined;
    this.stream = undefined;
    this.ctx = undefined;
    return audio;
  }
}

const PARTIAL_EVERY_MS = 2500;

export class WhisperSpeech {
  readonly id: string;
  private mic?: MicCapture;
  private startedAt = new Date();
  private timer?: ReturnType<typeof setInterval>;
  private partialBusy = false;
  private generation = 0;

  constructor(
    readonly model: WhisperModel,
    private readonly source: "bundled" | "remote",
  ) {
    this.id = model.id;
  }

  /** Load the model (fast when already loaded). */
  ready(): Promise<void> {
    return whisperRuntime.load(this.model, this.source);
  }

  async start(onPartial: (text: string) => void): Promise<void> {
    await this.ready();
    const gen = ++this.generation;
    this.mic = new MicCapture();
    await this.mic.start();
    this.startedAt = new Date();
    this.partialBusy = false;
    this.timer = setInterval(() => {
      const mic = this.mic;
      if (!mic || this.partialBusy || mic.seconds < 1) return;
      const audio = mic.snapshot();
      if (isSilent(audio)) return;
      this.partialBusy = true;
      whisperRuntime
        .transcribe(audio)
        .then((r) => {
          const text = cleanTranscript(r.text);
          if (gen === this.generation && this.mic && text) onPartial(text);
        })
        .catch(() => undefined)
        .finally(() => {
          this.partialBusy = false;
        });
    }, PARTIAL_EVERY_MS);
  }

  async stop(): Promise<Utterance | null> {
    clearInterval(this.timer);
    this.timer = undefined;
    const mic = this.mic;
    this.mic = undefined;
    this.generation++;
    if (!mic) return null;
    const endedAt = new Date();
    let audio: Float32Array | null = await mic.stop();
    if (isSilent(audio)) return null;
    const durationS = audio.length / SAMPLE_RATE;
    // The buffer is transferred to the worker and released there.
    const r = await whisperRuntime.transcribe(audio);
    audio = null;
    const text = cleanTranscript(r.text);
    if (!text) return null;
    return {
      text,
      startedAt: this.startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      engine: this.id,
      segments: toSegments(r.chunks, durationS),
    };
  }
}
