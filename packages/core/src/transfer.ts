/**
 * Full-chart transfer between Pinpoint phones by animated QR, with no network.
 *
 * The chart's whole event log (entries, voids, transcript) is serialised,
 * optionally deflated by a compressor the app injects (core stays
 * dependency-free), base64url-encoded and split into frames:
 *
 *   PPT1:<transferId>:<index>/<total>:<crc32>:<data>
 *
 * transferId is the CRC-32 of the whole payload, so a finished transfer is
 * checked end to end; each frame carries the CRC-32 of its own data. Frames
 * are plain text, never URLs (REQ-052). The receiver re-checks every event
 * with validateEvent and rebuilds the log with ChartLog.fromEvents, so a
 * tampered, mixed or partial transfer is rejected rather than shown.
 */
import type { ChartEvent } from "./types.js";
import { ChartLog } from "./log.js";
import { validateEvent } from "./validate.js";

export const TRANSFER_PREFIX = "PPT1";
export const TRANSFER_CHUNK_CHARS = 600;

/** Optional byte compressor, e.g. CompressionStream("deflate-raw") in the app. */
export interface Codec {
  compress(bytes: Uint8Array): Promise<Uint8Array>;
  decompress(bytes: Uint8Array): Promise<Uint8Array>;
}

const FLAG_PLAIN = 0x6e; // "n"
const FLAG_DEFLATE = 0x7a; // "z"

// ---- CRC-32 and base64url ---------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return ((c ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const B64_INDEX = new Map([...B64].map((ch, i) => [ch, i]));

function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!, b = bytes[i + 1], c = bytes[i + 2];
    out += B64[a >> 2]! + B64[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    if (b !== undefined) out += B64[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    if (c !== undefined) out += B64[c & 63]!;
  }
  return out;
}

function fromBase64Url(s: string): Uint8Array {
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const v = [0, 1, 2, 3].map((k) => (i + k < s.length ? B64_INDEX.get(s[i + k]!) : undefined));
    if (v[0] === undefined || v[1] === undefined || (i + 2 < s.length && v[2] === undefined) || (i + 3 < s.length && v[3] === undefined)) {
      throw new TransferError("Frame data is not base64url");
    }
    out[o++] = (v[0] << 2) | (v[1] >> 4);
    if (v[2] !== undefined) out[o++] = ((v[1] & 15) << 4) | (v[2] >> 2);
    if (v[3] !== undefined) out[o++] = ((v[2]! & 3) << 6) | v[3];
  }
  return out.slice(0, o);
}

export class TransferError extends Error {}

// ---- Encode -------------------------------------------------------------------

interface Envelope {
  v: 1;
  chartId: string;
  count: number;
  events: ChartEvent[];
}

export interface Transfer {
  transferId: string;
  frames: string[];
}

/** Encode one chart's events as QR frame texts. */
export async function encodeTransfer(
  events: readonly ChartEvent[],
  opts: { codec?: Codec; chunkChars?: number } = {},
): Promise<Transfer> {
  const first = events[0];
  if (!first) throw new TransferError("Nothing to transfer");
  // Checks the log before it leaves the phone.
  ChartLog.fromEvents(events);
  const env: Envelope = { v: 1, chartId: first.chartId, count: events.length, events: [...events] };
  const json = new TextEncoder().encode(JSON.stringify(env));
  const body = opts.codec ? await opts.codec.compress(json) : json;
  const payload = new Uint8Array(body.length + 1);
  payload[0] = opts.codec ? FLAG_DEFLATE : FLAG_PLAIN;
  payload.set(body, 1);
  const data = toBase64Url(payload);
  const transferId = crc32(data);
  const size = Math.max(100, opts.chunkChars ?? TRANSFER_CHUNK_CHARS);
  const total = Math.max(1, Math.ceil(data.length / size));
  const frames: string[] = [];
  for (let i = 0; i < total; i++) {
    const chunk = data.slice(i * size, (i + 1) * size);
    frames.push(`${TRANSFER_PREFIX}:${transferId}:${i + 1}/${total}:${crc32(chunk)}:${chunk}`);
  }
  return { transferId, frames };
}

// ---- Decode -------------------------------------------------------------------

export function isTransferFrame(text: string): boolean {
  return text.startsWith(`${TRANSFER_PREFIX}:`);
}

const FRAME_RE = /^PPT1:([0-9a-f]{8}):(\d{1,4})\/(\d{1,4}):([0-9a-f]{8}):([A-Za-z0-9_-]*)$/;

export interface ReceiveProgress {
  /** "added" new frame, "duplicate" already had it, "error" frame rejected, "ignored" not a transfer frame. */
  status: "added" | "duplicate" | "error" | "ignored";
  received: number;
  total: number | null;
  done: boolean;
  error?: string;
}

/** Collects frames in any order; call finish() when done is true. */
export class TransferReceiver {
  private id: string | null = null;
  private total: number | null = null;
  private chunks = new Map<number, string>();
  private readonly codec?: Codec;

  constructor(opts: { codec?: Codec } = {}) {
    this.codec = opts.codec;
  }

  get transferId(): string | null {
    return this.id;
  }

  reset(): void {
    this.id = null;
    this.total = null;
    this.chunks.clear();
  }

  private progress(status: ReceiveProgress["status"], error?: string): ReceiveProgress {
    return {
      status,
      received: this.chunks.size,
      total: this.total,
      done: this.total !== null && this.chunks.size === this.total,
      ...(error ? { error } : {}),
    };
  }

  add(frameText: string): ReceiveProgress {
    const text = frameText.trim();
    if (!isTransferFrame(text)) return this.progress("ignored");
    const m = FRAME_RE.exec(text);
    if (!m) return this.progress("error", "Damaged frame");
    const [, id, idxS, totS, crc, data] = m as unknown as [string, string, string, string, string, string];
    const index = Number(idxS), total = Number(totS);
    if (total < 1 || index < 1 || index > total) return this.progress("error", "Damaged frame");
    if (crc32(data) !== crc) return this.progress("error", "Frame failed its check");
    if (this.id !== null && id !== this.id) {
      return this.progress("error", "This is a different chart's QR. Finish this one or start again.");
    }
    if (this.total !== null && total !== this.total) return this.progress("error", "Frame count does not match");
    this.id = id;
    this.total = total;
    if (this.chunks.has(index)) return this.progress("duplicate");
    this.chunks.set(index, data);
    return this.progress("added");
  }

  /** Assemble, check and rebuild the log. Throws TransferError if anything is wrong. */
  async finish(): Promise<ChartEvent[]> {
    if (this.total === null || this.chunks.size !== this.total) throw new TransferError("Transfer is not complete");
    let data = "";
    for (let i = 1; i <= this.total; i++) data += this.chunks.get(i)!;
    if (crc32(data) !== this.id) throw new TransferError("Transfer failed its check");
    const payload = fromBase64Url(data);
    const flag = payload[0];
    let body = payload.subarray(1);
    if (flag === FLAG_DEFLATE) {
      if (!this.codec) throw new TransferError("This phone cannot decompress the transfer");
      body = await this.codec.decompress(body);
    } else if (flag !== FLAG_PLAIN) {
      throw new TransferError("Unknown transfer format");
    }
    let env: Envelope;
    try {
      env = JSON.parse(new TextDecoder().decode(body)) as Envelope;
    } catch {
      throw new TransferError("Transfer is not readable");
    }
    if (env?.v !== 1 || !Array.isArray(env.events) || env.events.length !== env.count) throw new TransferError("Transfer is incomplete");
    for (const e of env.events) {
      const r = validateEvent(e);
      if (!r.ok) throw new TransferError(`Invalid event (${r.error})`);
      if (e.chartId !== env.chartId) throw new TransferError("Transfer mixes charts");
    }
    try {
      return [...ChartLog.fromEvents(env.events).events];
    } catch (err) {
      throw new TransferError(`Chart log rejected: ${(err as Error).message}`);
    }
  }
}
