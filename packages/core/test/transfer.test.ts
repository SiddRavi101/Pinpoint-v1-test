import { deflateRawSync, inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  ChartLog,
  TransferError,
  TransferReceiver,
  crc32,
  encodeTransfer,
  extract,
  projectChart,
  testEnv,
  type ChartEvent,
  type Codec,
} from "../src/index.js";

const codec: Codec = {
  compress: async (b) => new Uint8Array(deflateRawSync(b)),
  decompress: async (b) => new Uint8Array(inflateRawSync(b)),
};

function chart(extraVitals = 0) {
  const env = testEnv("2026-12-16T19:00:00.000Z");
  const log = ChartLog.open({ deviceId: "dev-1", training: true, env });
  const say = (text: string) => {
    const u = log.recordUtterance({ text, startedAt: env.now().toISOString(), endedAt: env.now().toISOString(), engine: "typed", segments: [{ start: 0, end: 1, text }] });
    extract(text, env.now(), env).proposals.forEach((p) => log.confirmProposal({ ...p, utteranceId: u.id }));
  };
  say("34 year old female mechanism fall from about 10 feet onto rocks found at 1855");
  say("pulse 104 resps 20 BP 128 over 82 sats 95 patient reports pain in the right lower leg");
  say("tourniquet right leg on");
  say("gave ondansetron 4 milligrams by mouth allergic to penicillin");
  const first = log.events.find((e) => e.kind === "entry")!;
  log.voidEntry(first.id);
  for (let i = 0; i < extraVitals; i++) {
    env.set(new Date(env.now().getTime() + 60_000).toISOString());
    say(`pulse ${80 + (i % 40)} sats ${90 + (i % 9)}`);
  }
  return log;
}

async function receive(frames: string[], c?: Codec) {
  const r = new TransferReceiver({ codec: c });
  let last;
  for (const f of frames) last = r.add(f);
  return { r, last: last! };
}

const strip = (events: readonly ChartEvent[]) => JSON.parse(JSON.stringify(events));

describe("REQ-041 full-chart QR transfer", () => {
  it("round-trips a chart with transcript, entries and voids (compressed and plain)", async () => {
    const log = chart();
    for (const c of [codec, undefined]) {
      const t = await encodeTransfer(log.events, { codec: c });
      for (const f of t.frames) expect(f).toMatch(/^PPT1:[0-9a-f]{8}:\d+\/\d+:[0-9a-f]{8}:[A-Za-z0-9_-]+$/);
      const { r, last } = await receive(t.frames, c);
      expect(last.done).toBe(true);
      const events = await r.finish();
      expect(strip(events)).toEqual(strip(log.events));
      expect(projectChart(events)).toEqual(projectChart(log.events));
      expect(projectChart(events).transcript).toHaveLength(4);
    }
  });

  it("accepts frames out of order and ignores duplicates", async () => {
    const log = chart(40);
    const t = await encodeTransfer(log.events, { codec, chunkChars: 200 });
    expect(t.frames.length).toBeGreaterThan(3);
    const shuffled = [...t.frames].reverse();
    const r = new TransferReceiver({ codec });
    expect(r.add(shuffled[0]!).status).toBe("added");
    expect(r.add(shuffled[0]!).status).toBe("duplicate");
    for (const f of shuffled.slice(1)) r.add(f);
    expect(strip(await r.finish())).toEqual(strip(log.events));
  });

  it("rejects corrupted frames and leaves the transfer incomplete", async () => {
    const t = await encodeTransfer(chart().events, { codec, chunkChars: 200 });
    const r = new TransferReceiver({ codec });
    const bad = t.frames[0]!.slice(0, -3) + (t.frames[0]!.endsWith("AAA") ? "BBB" : "AAA");
    expect(r.add(bad)).toMatchObject({ status: "error", error: "Frame failed its check" });
    expect(r.add("PPT1:garbage")).toMatchObject({ status: "error" });
    expect(r.add("hello world").status).toBe("ignored");
    for (const f of t.frames.slice(1)) r.add(f);
    await expect(r.finish()).rejects.toThrow(TransferError);
  });

  it("refuses frames from a second chart mid-transfer", async () => {
    const a = await encodeTransfer(chart().events, { codec, chunkChars: 200 });
    const b = await encodeTransfer(chart(3).events, { codec, chunkChars: 200 });
    const r = new TransferReceiver({ codec });
    r.add(a.frames[0]!);
    expect(r.add(b.frames[1]!).status).toBe("error");
    expect(r.transferId).toBe(a.transferId);
  });

  it("rejects a forged transfer whose frames check out but whose log is invalid", async () => {
    const log = chart();
    const forged = structuredClone(log.events) as ChartEvent[];
    const entry = forged.find((e) => e.kind === "entry")!;
    (entry as { confirmed: boolean }).confirmed = false;
    // Build frames by hand around an invalid log (encodeTransfer itself refuses).
    await expect(encodeTransfer(forged)).rejects.toThrow();
    const json = JSON.stringify({ v: 1, chartId: log.chartId, count: forged.length, events: forged });
    const bytes = new TextEncoder().encode(json);
    const payload = new Uint8Array(bytes.length + 1);
    payload[0] = 0x6e;
    payload.set(bytes, 1);
    const data = Buffer.from(payload).toString("base64url");
    const frame = `PPT1:${crc32(data)}:1/1:${crc32(data)}:${data}`;
    const r = new TransferReceiver();
    expect(r.add(frame).done).toBe(true);
    await expect(r.finish()).rejects.toThrow(TransferError);
  });

  it("handles a 300-event chart", async () => {
    const log = chart(110);
    expect(log.events.length).toBeGreaterThanOrEqual(300);
    const t = await encodeTransfer(log.events, { codec });
    const { r } = await receive(t.frames, codec);
    expect(strip(await r.finish())).toEqual(strip(log.events));
  });

  it("matches Node's base64url so other decoders agree", async () => {
    const t = await encodeTransfer(chart().events);
    const data = t.frames.map((f) => f.split(":")[4]).join("");
    const json = Buffer.from(data, "base64url").subarray(1).toString("utf8");
    expect(JSON.parse(json).v).toBe(1);
  });
});
