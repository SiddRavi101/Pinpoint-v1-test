import { describe, expect, it } from "vitest";
import { ChartLog, LogError, extract, projectChart, testEnv, validateEvent, type Utterance } from "../src/index.js";

function heard(text: string, at: string): Utterance {
  return { text, startedAt: at, endedAt: at, engine: "typed", segments: [{ start: 0, end: 1.5, text }] };
}

describe("REQ-004 transcript", () => {
  it("records what was heard without creating chart entries", () => {
    const env = testEnv("2026-12-16T19:00:00.000Z");
    const log = ChartLog.open({ deviceId: "d", training: true, env });
    const u = log.recordUtterance(heard("pulse 104 sats 95", env.now().toISOString()));
    expect(u.kind).toBe("utterance");
    expect(u.confirmed).toBe(false);
    const chart = projectChart(log.events);
    expect(chart.entries).toHaveLength(0);
    expect(chart.transcript).toHaveLength(1);
    expect(chart.transcript[0]!.text).toBe("pulse 104 sats 95");
  });

  it("links confirmed entries to their utterance, and voided ones separately", () => {
    const env = testEnv("2026-12-16T19:00:00.000Z");
    const log = ChartLog.open({ deviceId: "d", training: true, env });
    const u = log.recordUtterance(heard("pulse 104 sats 95", env.now().toISOString()));
    const cards = extract("pulse 104 sats 95", env.now(), env).proposals.map((p) => ({ ...p, utteranceId: u.id }));
    const [a, b] = cards.map((c) => log.confirmProposal(c));
    log.voidEntry(b!.id);
    const line = projectChart(log.events).transcript[0]!;
    expect(line.entryIds).toEqual([a!.id]);
    expect(line.voidedEntryIds).toEqual([b!.id]);
    expect(projectChart(log.events).entries[0]!.utteranceId).toBe(u.id);
  });

  it("rejects entries pointing at a missing utterance, and confirmed utterances", () => {
    const env = testEnv("2026-12-16T19:00:00.000Z");
    const log = ChartLog.open({ deviceId: "d", training: true, env });
    const card = extract("pulse 104", env.now(), env).proposals[0]!;
    expect(() => log.confirmProposal({ ...card, utteranceId: "nope" })).toThrow(LogError);
    const u = log.recordUtterance(heard("pulse 104", env.now().toISOString()));
    const forged = { ...u, id: "x", seq: log.events.length + 1, confirmed: true };
    expect(() => ChartLog.fromEvents([...log.events, forged])).toThrow(LogError);
  });

  it("round-trips through fromEvents and server validation", () => {
    const env = testEnv("2026-12-16T19:00:00.000Z");
    const log = ChartLog.open({ deviceId: "d", training: true, env });
    log.recordUtterance(heard("gcs 15", env.now().toISOString()));
    expect(ChartLog.fromEvents(log.events).events).toHaveLength(2);
    for (const e of log.events) expect(validateEvent(structuredClone(e)).ok).toBe(true);
    const bad = { ...structuredClone(log.events[1]!), payload: { text: "x", startedAt: "no", endedAt: "no", engine: "typed" } };
    expect(validateEvent(bad).ok).toBe(false);
  });

  it("still accepts schema version 1 events", () => {
    const env = testEnv("2026-12-16T19:00:00.000Z");
    const log = ChartLog.open({ deviceId: "d", training: true, env });
    const v1 = { ...structuredClone(log.events[0]!), schemaVersion: 1 };
    expect(validateEvent(v1).ok).toBe(true);
    expect(validateEvent({ ...v1, schemaVersion: 3 }).ok).toBe(false);
  });
});
