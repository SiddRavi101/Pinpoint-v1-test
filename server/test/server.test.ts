import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { ChartLog, extract, retentionState, testEnv } from "@pinpoint/core";
import { createApp } from "../src/app.js";
import { Store } from "../src/store.js";

const DEVICE_TOKEN = "device-token-abcdef";
const REVIEW_TOKEN = "review-token-0123456789";

let server: Server;
let store: Store;
let base: string;
let logs: string[];

beforeEach(async () => {
  store = new Store(":memory:");
  logs = [];
  server = createApp(store, {
    deviceTokens: new Map([["dev-1", DEVICE_TOKEN]]),
    reviewToken: REVIEW_TOKEN,
    allowedOrigins: ["capacitor://localhost"],
    maxBodyBytes: 1_000_000,
    now: () => new Date("2026-12-16T20:00:00.000Z"),
    log: (l) => logs.push(l),
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => {
  server.close();
  store.close();
});

function chart() {
  const env = testEnv();
  const log = ChartLog.open({ deviceId: "dev-1", training: true, env });
  extract("pulse 112 BP 130 over 85 gave ondansetron 4 milligrams", env.now(), env).proposals.forEach((p) => log.confirmProposal(p));
  return { log, env };
}

const post = (chartId: string, events: unknown[], token = DEVICE_TOKEN) =>
  fetch(`${base}/v1/charts/${chartId}/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ events }),
  });

describe("REQ-031 server confirm", () => {
  it("stores events and returns a receipt for the gapless prefix", async () => {
    const { log } = chart();
    const res = await post(log.chartId, [...log.events]);
    expect(res.status).toBe(200);
    const receipt = (await res.json()) as { serverEventCount: number; receiptId: string };
    expect(receipt.serverEventCount).toBe(log.events.length);
  });

  it("is idempotent for re-sends and rejects conflicting content", async () => {
    const { log } = chart();
    await post(log.chartId, [...log.events]);
    expect((await post(log.chartId, [...log.events])).status).toBe(200);
    const tampered = { ...log.events[1]!, at: "2026-12-16T00:00:00.000Z" };
    expect((await post(log.chartId, [tampered])).status).toBe(409);
  });

  it("confirms only what it holds when a batch has a gap", async () => {
    const { log } = chart();
    const res = await post(log.chartId, [log.events[0]!, log.events[2]!]);
    expect(((await res.json()) as { serverEventCount: number }).serverEventCount).toBe(1);
  });

  it("rejects unknown devices, unconfirmed entries and mismatched charts", async () => {
    const { log } = chart();
    expect((await post(log.chartId, [...log.events], "wrong-token")).status).toBe(401);
    expect((await post(log.chartId, [{ ...log.events[1]!, confirmed: false }])).status).toBe(422);
    expect((await post("other-chart", [...log.events])).status).toBe(422);
  });

  it("full cycle: close, sync, receipt, deletable after 12 h", async () => {
    const { log } = chart();
    log.close();
    const receipt = (await (await post(log.chartId, [...log.events])).json()) as { receiptId: string; serverEventCount: number; confirmedAt: string };
    log.recordSyncConfirmed(receipt);
    expect(retentionState(log.events, new Date("2026-12-17T08:00:00.000Z")).state).toBe("deletable");
    // The receipt itself can be uploaded later without breaking the log.
    expect((await post(log.chartId, [...log.events])).status).toBe(200);
  });
});

describe("review list", () => {
  it("needs the review token and returns flags, not raw data", async () => {
    const { log } = chart();
    await post(log.chartId, [...log.events]);
    expect((await fetch(`${base}/v1/review`)).status).toBe(401);
    const res = await fetch(`${base}/v1/review`, { headers: { Authorization: `Bearer ${REVIEW_TOKEN}` } });
    const body = (await res.json()) as { charts: { id: string; flags: { code: string }[] }[] };
    expect(body.charts[0]!.id).toBe(log.chartId);
    expect(body.charts[0]!.flags.map((f) => f.code)).toContain("med_incomplete");
    const detail = await fetch(`${base}/v1/charts/${log.chartId}`, { headers: { Authorization: `Bearer ${REVIEW_TOKEN}` } });
    expect(((await detail.json()) as { handoff: { qrText: string } }).handoff.qrText).toMatch(/^TRAINING/);
  });

  it("audits every access and never logs patient data", async () => {
    const { log } = chart();
    await post(log.chartId, [...log.events]);
    await fetch(`${base}/v1/review`, { headers: { Authorization: `Bearer ${REVIEW_TOKEN}` } });
    expect(store.auditRows().map((r) => r.action)).toEqual(["upload", "list"]);
    const joined = logs.join("\n");
    expect(joined).not.toContain(log.chartId);
    expect(joined).not.toMatch(/ondansetron|112|130/);
  });
});
