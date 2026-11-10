/** Messages between the app and the Whisper worker. Audio stays in memory. */
import type { AsrChunk } from "./whisper-util";

export type ToWorker =
  | {
      type: "load";
      repo: string;
      /** Absolute URL of the app root (where ./models/ and ./ort/ live). */
      base: string;
      /** "bundled": ./models/ only. "remote": allow a one-time download from the model hub into Cache Storage. */
      source: "bundled" | "remote";
    }
  | { type: "transcribe"; id: number; audio: Float32Array };

export type FromWorker =
  | { type: "progress"; file: string; loaded: number; total: number }
  | { type: "ready" }
  | { type: "load_error"; message: string }
  | { type: "result"; id: number; text: string; chunks: AsrChunk[] }
  | { type: "error"; id: number; message: string };
