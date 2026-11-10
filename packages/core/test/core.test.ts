import { describe, expect, it } from "vitest";
import {
  ChartLog,
  LogError,
  QR_MAX_CHARS,
  buildHandoff,
  completenessFlags,
  extract,
  parseNumberWords,
  projectChart,
  retentionState,
  testEnv,
  tourniquetMinutes,
  validateEvent,
} from "../src/index.js";

const H = 60 * 60 * 1000;

function sampleChart(training = false) {
  const env = testEnv("2026-12-16T19:00:00.000Z");
  const log = ChartLog.open({ deviceId: "dev-1", training, env });
  env.set("2026-12-16T19:05:00.000Z");
  const r1 = extract("34 year old female mechanism fall from about 10 feet onto rocks found at 1855", env.now(), env);
  r1.proposals.forEach((p) => log.confirmProposal(p));
  const r2 = extract("pulse 104 resps 20 BP 128 over 82 sats 95 patient reports pain in the right lower leg", env.now(), env);
  r2.proposals.forEach((p) => log.confirmProposal(p));
  env.set("2026-12-16T19:10:00.000Z");
  extract("tourniquet right leg on", env.now(), env).proposals.forEach((p) => log.confirmProposal(p));
  extract("gave ondansetron 4 milligrams by mouth allergic to penicillin", env.now(), env).proposals.forEach((p) => log.confirmProposal(p));
  env.set("2026-12-16T19:20:00.000Z");
  extract("pulse 96 resps 18 BP 124 over 80", env.now(), env).proposals.forEach((p) => log.confirmProposal(p));
  return { env, log };
}

describe("numbers", () => {
  it.each([
    [["one", "twelve"], 112],
    [["one", "thirty", "five"], 135],
    [["a", "hundred", "and", "four"], 104],
    [["ninety", "four"], 94],
    [["fourteen", "twenty"], 1420],
    [["one", "oh", "eight"], 108],
    [["seven"], 7],
  ])("%j -> %i", (words, n) => expect(parseNumberWords(words)).toBe(n));
});

describe("REQ-020 append-only event log", () => {
  it("events are frozen and gapless", () => {
    const { log } = sampleChart();
    log.events.forEach((e, i) => expect(e.seq).toBe(i + 1));
    expect(Object.isFrozen(log.events[0])).toBe(true);
    expect(() => {
      (log.events[0] as { at: string }).at = "x";
    }).toThrow();
  });

  it("every event records source, confirmation, template and rule versions", () => {
    const { log } = sampleChart();
    for (const e of log.events) {
      expect(e.templateVersion).toMatch(/^wilderness-/);
      expect(["tap", "voice", "system"]).toContain(e.source);
      expect(e.confirmed).toBe(true);
      if (e.source === "voice") expect(e.ruleVersion).toMatch(/^rules-/);
    }
  });

  it("corrections void and replace; nothing is edited", () => {
    const { log } = sampleChart();
    const pulse = log.events.find((e) => e.kind === "entry" && e.payload.entry.type === "pulse")!;
    log.correct(pulse.id, { type: "pulse", bpm: 110 });
    const chart = projectChart(log.events);
    expect(chart.vitals[0]!.pulse!.value).toBe(110);
    expect(log.events.find((e) => e.id === pulse.id)).toBeDefined();
    expect(() => log.voidEntry(pulse.id)).toThrow(LogError);
  });

  it("a closed chart only accepts sync receipts", () => {
    const { log } = sampleChart();
    log.close();
    expect(() => log.addTapEntry({ type: "note", text: "late" })).toThrow(LogError);
    expect(() => log.recordSyncConfirmed({ receiptId: "r1", serverEventCount: log.events.length, confirmedAt: new Date().toISOString() })).not.toThrow();
  });

  it("rebuilds from stored events and rejects tampered ones", () => {
    const { log } = sampleChart();
    const copy = ChartLog.fromEvents(log.events);
    expect(copy.events).toHaveLength(log.events.length);
    const bad = log.events.map((e) => ({ ...e }));
    bad[3] = { ...bad[3]!, seq: 9 };
    expect(() => ChartLog.fromEvents(bad)).toThrow(LogError);
  });
});

describe("chart projection", () => {
  it("groups vitals by speech time and pairs tourniquets", () => {
    const { log, env } = sampleChart();
    const chart = projectChart(log.events);
    expect(chart.vitals).toHaveLength(2);
    expect(chart.vitals[0]!.bp!.value).toEqual({ systolic: 128, diastolic: 82 });
    expect(chart.patient).toMatchObject({ age: 34, sex: "female" });
    expect(chart.tourniquets[0]).toMatchObject({ limb: "right leg", onAt: "2026-12-16T19:10:00.000Z" });
    env.set("2026-12-16T19:40:00.000Z");
    expect(tourniquetMinutes(chart.tourniquets[0]!, env.now())).toBe(30);
    extract("tourniquet off right leg", env.now(), env).proposals.forEach((p) => log.confirmProposal(p));
    const after = projectChart(log.events);
    expect(after.tourniquets[0]!.offAt).toBe("2026-12-16T19:40:00.000Z");
    expect(tourniquetMinutes(after.tourniquets[0]!, new Date("2026-12-16T23:00:00Z"))).toBe(30);
  });
});

describe("REQ-040 handoff", () => {
  it("is in MIST order and fits the QR limit", () => {
    const { log, env } = sampleChart();
    const h = buildHandoff(projectChart(log.events), env.now());
    expect(h.sections.map((s) => s.key)).toEqual(["M", "I", "S", "T", "A"]);
    expect(h.qrText.length).toBeLessThanOrEqual(QR_MAX_CHARS);
    expect(h.qrText).toContain("TQ R leg ON 19:10 (10 min)");
    expect(h.qrText).toContain("ondansetron 4mg PO");
    expect(h.qrText).toContain("A: penicillin");
    expect(h.speech).toContain("Latest vitals at 19:20, pulse 96");
    expect(h.qrText).not.toMatch(/https?:/);
  });

  it("training charts start with TRAINING", () => {
    const { log, env } = sampleChart(true);
    const h = buildHandoff(projectChart(log.events), env.now());
    expect(h.qrText.split("\n")[0]).toMatch(/^TRAINING/);
    expect(h.speech.startsWith("Training chart.")).toBe(true);
  });

  it("long charts are shortened, never over the limit", () => {
    const { log, env } = sampleChart();
    for (let i = 0; i < 20; i++) log.addTapEntry({ type: "patient_report", text: `long report number ${i} with many extra words about the injury` });
    for (let i = 0; i < 6; i++) log.addTapEntry({ type: "med", drug: "oxygen", spoken: "oxygen", dose: { amount: 15, unit: "L/min" }, route: "NRB" });
    const h = buildHandoff(projectChart(log.events), env.now());
    expect(h.qrText.length).toBeLessThanOrEqual(QR_MAX_CHARS);
    expect(h.qrText).toContain("PINPOINT HANDOFF");
  });
});

describe("REQ-030 sync then delete", () => {
  it("keeps until closed, confirmed and 12 hours old", () => {
    const { log, env } = sampleChart();
    expect(retentionState(log.events, env.now()).state).toBe("keep");
    log.close();
    const dataCount = log.events.length;
    expect(retentionState(log.events, env.now()).state).toBe("keep");
    const confirmedAt = env.now().toISOString();
    log.recordSyncConfirmed({ receiptId: "r1", serverEventCount: dataCount, confirmedAt });
    const later = (ms: number) => new Date(new Date(confirmedAt).getTime() + ms);
    expect(retentionState(log.events, later(11 * H)).state).toBe("keep");
    expect(retentionState(log.events, later(12 * H)).state).toBe("deletable");
  });

  it("a partial confirmation is never deletable", () => {
    const { log, env } = sampleChart();
    log.close();
    log.recordSyncConfirmed({ receiptId: "r1", serverEventCount: 3, confirmedAt: env.now().toISOString() });
    expect(retentionState(log.events, new Date(env.now().getTime() + 13 * H)).state).not.toBe("deletable");
  });

  it("warns after 24 hours unsynced", () => {
    const { log, env } = sampleChart();
    log.close();
    expect(retentionState(log.events, new Date(env.now().getTime() + 25 * H)).state).toBe("warn_unsynced");
  });
});

describe("completeness flags", () => {
  it("flags missing vitals, incomplete meds and tourniquets", () => {
    const env = testEnv();
    const log = ChartLog.open({ deviceId: "d", training: false, env });
    log.addTapEntry({ type: "med", drug: "aspirin", spoken: "aspirin" });
    log.addTapEntry({ type: "tourniquet", action: "on" });
    const codes = completenessFlags(projectChart(log.events)).map((f) => f.code);
    expect(codes).toEqual(["no_vitals", "med_incomplete", "tourniquet_incomplete"]);
  });
});

describe("validateEvent", () => {
  it("accepts real events and rejects unconfirmed or guidance entries", () => {
    const { log } = sampleChart();
    for (const e of log.events) expect(validateEvent(e).ok).toBe(true);
    const entry = log.events.find((e) => e.kind === "entry")!;
    expect(validateEvent({ ...entry, confirmed: false }).ok).toBe(false);
    expect(validateEvent({ ...entry, source: "guidance" }).ok).toBe(false);
    expect(validateEvent({ ...entry, schemaVersion: 99 }).ok).toBe(false);
  });
});
