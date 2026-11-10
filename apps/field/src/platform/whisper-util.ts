/**
 * Pure helpers for the on-device Whisper engine. No browser APIs here, so
 * they can be unit tested in Node.
 */
import type { TranscriptSegment } from "@pinpoint/core";

export const SAMPLE_RATE = 16_000;

export interface WhisperModel {
  /** Stamped on every utterance as the engine name. */
  id: "whisper-base.en" | "whisper-tiny.en";
  /** Hugging Face repo, also the folder under ./models/. */
  repo: string;
  label: string;
  approxMb: number;
}

export const WHISPER_MODELS: readonly WhisperModel[] = [
  { id: "whisper-base.en", repo: "onnx-community/whisper-base.en", label: "Standard (more accurate)", approxMb: 80 },
  { id: "whisper-tiny.en", repo: "onnx-community/whisper-tiny.en", label: "Light (faster, less accurate)", approxMb: 45 },
];
export const DEFAULT_MODEL = WHISPER_MODELS[0]!;

export const modelById = (id: string | null | undefined): WhisperModel => WHISPER_MODELS.find((m) => m.id === id) ?? DEFAULT_MODEL;

/** Quantized (q8) weights: transformers.js names them *_quantized.onnx. */
export const WHISPER_DTYPE = "q8";
export const REQUIRED_FILES = [
  "config.json",
  "generation_config.json",
  "preprocessor_config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "onnx/encoder_model_quantized.onnx",
  "onnx/decoder_model_merged_quantized.onnx",
] as const;

/** Join chunks of mic samples into one buffer. */
export function concatFloat32(chunks: readonly Float32Array[]): Float32Array {
  let n = 0;
  for (const c of chunks) n += c.length;
  const out = new Float32Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Linear resampling to 16 kHz when the device ignores the requested rate. */
export function resampleLinear(input: Float32Array, from: number, to = SAMPLE_RATE): Float32Array {
  if (from === to || input.length === 0) return input;
  const ratio = from / to;
  const n = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * ratio;
    const j = Math.floor(x);
    const f = x - j;
    const a = input[j] ?? 0;
    const b = input[Math.min(j + 1, input.length - 1)] ?? a;
    out[i] = a + (b - a) * f;
  }
  return out;
}

/** Root-mean-square level, 0..1. */
export function rms(audio: Float32Array): number {
  if (audio.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < audio.length; i++) s += audio[i]! * audio[i]!;
  return Math.sqrt(s / audio.length);
}

/**
 * Whisper tends to invent words for silence ("Thank you."), so near-silent
 * or very short clips are treated as nothing said.
 */
export function isSilent(audio: Float32Array, sampleRate = SAMPLE_RATE): boolean {
  return audio.length < sampleRate * 0.3 || rms(audio) < 0.002;
}

/** Remove Whisper's non-speech markers like [BLANK_AUDIO] or (wind blowing). */
export function cleanTranscript(text: string): string {
  return text
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\((?:[^)]*\b(?:music|noise|wind|silence|blank|inaudible|static|applause|laughs?|breathing|coughs?)\b[^)]*)\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface AsrChunk {
  timestamp: [number | null, number | null] | readonly (number | null)[];
  text: string;
}

/** Map pipeline chunks to transcript segments (seconds from the start of speech). */
export function toSegments(chunks: readonly AsrChunk[] | undefined, durationS: number): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  for (const c of chunks ?? []) {
    const text = cleanTranscript(c.text);
    if (!text) continue;
    const start = Math.max(0, Math.min(durationS, c.timestamp[0] ?? out[out.length - 1]?.end ?? 0));
    const end = Math.max(start, Math.min(durationS, c.timestamp[1] ?? durationS));
    out.push({ start: round2(start), end: round2(end), text });
  }
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** True when a fetched config.json really is a Whisper config (not an SPA fallback page). */
export function looksLikeWhisperConfig(body: string): boolean {
  try {
    const j = JSON.parse(body) as { model_type?: unknown };
    return j.model_type === "whisper";
  } catch {
    return false;
  }
}
