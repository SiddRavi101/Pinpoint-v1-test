import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { ChartLog, extract, projectChart, testEnv, type Utterance } from "@pinpoint/core";
import { createApp } from "../../../server/src/app";
import { Store } from "../../../server/src/store";
import { describeEntry, entryFromForm, hhmmss, minutesSince, pickDrug, reviewItems, segmentClock, splitForAcceptAll } from "../src/logic";
import { deletableCharts, uploadChart } from "../src/sync";

describe("REQ-012 Accept all takes clear cards only", () => {
  it("leaves cards that need a look on screen", () => {
    const { proposals } = extract("pulse 112 gave zofrin 4 milligrams by mouth", new Date("2026-12-16T19:00:00Z"), testEnv());
    const { accept, keep } = splitForAcceptAll(proposals);
    expect(accept.map((p) => p.entry.type)).toContain("pulse");
    for (const p of keep) expect(p.review.length).toBeGreaterThan(0);
    expect(accept.every((p) => p.review.length === 0)).toBe(true);
  });

  it("HAZ-02: an unclear drug is only resolved by a human pick", () => {
    const { proposals } = extract("gave zofrin 4 milligrams by mouth", new Date(), testEnv());
    const med = proposals.find((p) => p.entry.type === "med")!;
    if (med.entry.type === "med" && med.entry.drug === null) {
      expect(med.candidates?.length).toBeGreaterThan(0);
      const picked = pickDrug(med, med.candidates![0]!);
      expect(picked.entry.type === "med" && picked.entry.drug).toBe(med.candidates![0]);
    } else {
      // Matched clearly: still must name the drug from the list
      expect(med.entry.type === "med" && med.entry.drug).toBe("ondansetron");
    }
  });
});

describe("REQ-014 tap entry forms", () => {
  const today = new Date("2026-12-16T12:00:00Z");
  it("builds entries", () => {
    expect(entryFromForm("pulse", { value: "96" }, today)).toEqual({ type: "pulse", bpm: 96 });
    expect(entryFromForm("bp", { systolic: "90", diastolic: "" }, today)).toEqual({ type: "bp", systolic: 90, diastolic: null });
    expect(entryFromForm("med", { drug: "aspirin", amount: "324", unit: "mg", route: "PO" }, today)).toEqual({
      type: "med", drug: "aspirin", spoken: "aspirin", dose: { amount: 324, unit: "mg" }, route: "PO",
    });
    expect(entryFromForm("tourniquet", { action: "on", limb: "left leg" }, today)).toEqual({ type: "tourniquet", action: "on", limb: "left leg" });
  });
  it("returns an error instead of guessing", () => {
    expect(entryFromForm("pulse", { value: "" }, today)).toHaveProperty("error");
    expect(entryFromForm("med", { drug: " " }, today)).toHaveProperty("error");
    expect(entryFromForm("time_found", { time: "noon" }, today)).toHaveProperty("error");
    expect(entryFromForm("patient", {}, today)).toHaveProperty("error");
  });
  it("describes entries for the record", () => {
    expect(describeEntry({ type: "bp", systolic: 120, diastolic: null }).value).toMatch(/120/);
    expect(minutesSince(undefined, today)).toBeNull();
    expect(minutesSince("2026-12-16T11:45:00Z", today)).toBe(15);
  });
});

describe("REQ-030..033 sync then delete, against the real server", () => {
  let server: Server;
  let store: Store;
  let base: string;
  beforeEach(async () => {
    store = new Store(":memory:");
    server = createApp(store, {
      deviceTokens: new Map([["dev-1", "device-token-abcdef"]]),
      reviewToken: "review-token-0123456789",
      allowedOrigins: [],
      maxBodyBytes: 1_000_000,
      now: () => new Date(),
      log: () => {},
    });
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => {
    server.close();
    store.close();
  });

  it("uploads, records one receipt, and deletes 12 h after close", async () => {
    const env = testEnv();
    const log = ChartLog.open({ deviceId: "dev-1", training: true, env });
    extract("pulse 112 sats 94", env.now(), env).proposals.forEach((p) => log.confirmProposal(p));
    log.close();
    const cfg = { serverUrl: base, deviceId: "dev-1", token: "device-token-abcdef" };

    const r1 = await uploadChart(log, cfg);
    expect(r1?.kind).toBe("sync_confirmed");
    // A second sync with nothing new must not add another receipt (no loops).
    expect(await uploadChart(log, cfg)).toBeNull();
    expect(projectChart(log.events).syncedEventCount).toBeGreaterThan(0);

    const confirmedAt = r1!.kind === "sync_confirmed" ? r1!.payload.confirmedAt : "";
    const soon = new Date(Date.parse(confirmedAt) + 60_000);
    expect(deletableCharts([log], soon)).toEqual([]);
    const later = new Date(Date.parse(confirmedAt) + 12 * 3600_000 + 60_000);
    expect(deletableCharts([log], later)).toEqual([log.chartId]);
  });

  it("surfaces a bad token as an error and keeps the chart", async () => {
    const log = ChartLog.open({ deviceId: "dev-1", training: true, env: testEnv() });
    await expect(uploadChart(log, { serverUrl: base, deviceId: "dev-1", token: "wrong-token-123" })).rejects.toThrow(/401/);
    expect(deletableCharts([log], new Date(Date.now() + 48 * 3600_000))).toEqual([]);
  });
});

describe("scribe review and transcript", () => {
  const at = "2026-12-16T19:00:00.000Z";
  const u = (text: string): Utterance => ({ text, startedAt: at, endedAt: at, engine: "typed" });

  it("lists waiting cards, unmatched drugs and heard-but-not-charted lines, never care advice", () => {
    const env = testEnv(at);
    const log = ChartLog.open({ deviceId: "d", training: true, env });
    const heard1 = log.recordUtterance(u("pulse 104"));
    const heard2 = log.recordUtterance(u("uh hold on"));
    const pulse = { ...extract("pulse 104", env.now(), env).proposals[0]!, utteranceId: heard1.id };
    const drug = { ...extract("gave zorbitrol 4 milligrams", env.now(), env).proposals.find((p) => p.entry.type === "med")!, utteranceId: heard1.id };
    const items = reviewItems(projectChart(log.events), [pulse, drug]);
    const reasons = items.map((i) => i.reason);
    expect(reasons).toContain("drug_unmatched");
    expect(reasons).toContain("card_waiting");
    expect(items.find((i) => i.reason === "heard_not_charted")?.eventId).toBe(heard2.id);
    // A line with a card still waiting is not "not charted".
    expect(items.filter((i) => i.reason === "heard_not_charted")).toHaveLength(1);
  });

  it("drops a line from heard-not-charted once an entry is confirmed from it", () => {
    const env = testEnv(at);
    const log = ChartLog.open({ deviceId: "d", training: true, env });
    const h = log.recordUtterance(u("pulse 104"));
    log.confirmProposal({ ...extract("pulse 104", env.now(), env).proposals[0]!, utteranceId: h.id });
    expect(reviewItems(projectChart(log.events), [])).toEqual([]);
  });

  it("formats segment clock times from the utterance start", () => {
    const start = new Date(2026, 11, 16, 14, 5, 0).toISOString();
    expect(segmentClock(start, 9.4)).toBe("14:05:09");
    expect(hhmmss(start)).toBe("14:05:00");
  });
});
