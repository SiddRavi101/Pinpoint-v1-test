/**
 * HTTP API (no framework). Logs never contain request bodies or patient data.
 *
 *   POST /v1/charts/:chartId/events   device token   upload events, get a receipt
 *   GET  /v1/review                    review token   chart list with completeness flags
 *   GET  /v1/charts/:chartId           review token   one chart: events, projection, handoff
 *   GET  /healthz
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { ChartLog, buildHandoff, completenessFlags, projectChart, validateEvent, type ChartEvent } from "@pinpoint/core";
import { Store } from "./store.js";

export interface Config {
  /** deviceId -> token */
  deviceTokens: Map<string, string>;
  reviewToken: string;
  allowedOrigins: string[];
  maxBodyBytes: number;
  now: () => Date;
  log: (line: string) => void;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

function bearer(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
}

async function readJson(req: IncomingMessage, max: number): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > max) throw new HttpError(413, "Body too large");
    chunks.push(c as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Body is not JSON");
  }
}

export function createApp(store: Store, config: Config): Server {
  const authDevice = (req: IncomingMessage): string => {
    const token = bearer(req);
    if (!token) throw new HttpError(401, "Missing token");
    for (const [deviceId, t] of config.deviceTokens) if (safeEqual(t, token)) return deviceId;
    throw new HttpError(401, "Unknown device");
  };
  const authReview = (req: IncomingMessage) => {
    const token = bearer(req);
    if (!token || !safeEqual(token, config.reviewToken)) throw new HttpError(401, "Review token required");
  };

  async function upload(req: IncomingMessage, chartId: string) {
    const deviceId = authDevice(req);
    const body = (await readJson(req, config.maxBodyBytes)) as { events?: unknown };
    if (!Array.isArray(body.events) || body.events.length === 0) throw new HttpError(400, "events must be a non-empty array");
    if (body.events.length > 2000) throw new HttpError(413, "Too many events");

    const incoming: ChartEvent[] = [];
    for (const raw of body.events) {
      const v = validateEvent(raw);
      if (!v.ok) throw new HttpError(422, `Invalid event: ${v.error}`);
      if (v.event.chartId !== chartId) throw new HttpError(422, "Event chartId does not match URL");
      if (v.event.deviceId !== deviceId) throw new HttpError(403, "Event deviceId does not match token");
      incoming.push(v.event);
    }

    // Idempotency: identical re-sends are fine; a different event at a used seq is a conflict.
    const fresh: ChartEvent[] = [];
    for (const e of incoming) {
      const existing = store.byId(e.id);
      if (existing) {
        if (existing.chartId !== chartId || existing.seq !== e.seq || existing.body !== JSON.stringify(e)) throw new HttpError(409, "Event id reused with different content");
        continue;
      }
      if (store.bySeq(chartId, e.seq)) throw new HttpError(409, `Seq ${e.seq} already holds a different event`);
      fresh.push(e);
    }

    const at = config.now().toISOString();
    if (fresh.length) {
      try {
        store.insertAll(fresh, at, () => {
          // The stored log must still satisfy every invariant (gapless prefix is checked below).
          const all = store.events(chartId);
          const prefix: ChartEvent[] = [];
          for (const e of all) {
            if (e.seq !== prefix.length + 1) break;
            prefix.push(e);
          }
          ChartLog.fromEvents(prefix);
        });
      } catch (err) {
        if (err instanceof HttpError) throw err;
        throw new HttpError(422, `Events break the chart log: ${(err as Error).message}`);
      }
    }

    // Confirm only the gapless prefix the server holds.
    const stored = store.events(chartId);
    let count = 0;
    for (const e of stored) {
      if (e.seq !== count + 1) break;
      count++;
    }
    const receipt = { receiptId: randomUUID(), serverEventCount: count, confirmedAt: at };
    store.audit({ at, actor: `device:${deviceId}`, action: "upload", chartId, detail: `received ${incoming.length}, new ${fresh.length}, confirmed ${count}` });
    return receipt;
  }

  function review(req: IncomingMessage) {
    authReview(req);
    const at = config.now().toISOString();
    const charts = store.chartIds().map((id) => {
      const chart = projectChart(store.events(id));
      return {
        id,
        training: chart.training,
        openedAt: chart.openedAt,
        closedAt: chart.closedAt ?? null,
        eventCount: chart.eventCount,
        flags: completenessFlags(chart),
      };
    });
    charts.sort((a, b) => b.openedAt.localeCompare(a.openedAt));
    store.audit({ at, actor: "reviewer", action: "list", chartId: null, detail: `${charts.length} charts` });
    return { charts };
  }

  function chartDetail(req: IncomingMessage, chartId: string) {
    authReview(req);
    const events = store.events(chartId);
    if (events.length === 0) throw new HttpError(404, "No such chart");
    const now = config.now();
    const chart = projectChart(events);
    store.audit({ at: now.toISOString(), actor: "reviewer", action: "view", chartId, detail: "chart opened" });
    return { events, chart, flags: completenessFlags(chart), handoff: buildHandoff(chart, now) };
  }

  const cors = (req: IncomingMessage, res: ServerResponse) => {
    const origin = req.headers.origin;
    if (origin && config.allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }
  };

  return createServer(async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url ?? "/", "http://local");
    let route = "unknown";
    let status = 200;
    let out: unknown;
    try {
      cors(req, res);
      res.setHeader("Cache-Control", "no-store");
      if (req.method === "OPTIONS") {
        status = 204;
      } else if (req.method === "GET" && url.pathname === "/healthz") {
        route = "health";
        out = { ok: true };
      } else if (req.method === "POST" && /^\/v1\/charts\/[^/]+\/events$/.test(url.pathname)) {
        route = "upload";
        out = await upload(req, decodeURIComponent(url.pathname.split("/")[3]!));
      } else if (req.method === "GET" && url.pathname === "/v1/review") {
        route = "review";
        out = review(req);
      } else if (req.method === "GET" && /^\/v1\/charts\/[^/]+$/.test(url.pathname)) {
        route = "chart";
        out = chartDetail(req, decodeURIComponent(url.pathname.split("/")[3]!));
      } else {
        throw new HttpError(404, "Not found");
      }
    } catch (err) {
      status = err instanceof HttpError ? err.status : 500;
      out = { error: err instanceof HttpError ? err.message : "Server error" };
    }
    res.statusCode = status;
    if (status !== 204) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(out));
    } else res.end();
    // Route name and status only: no ids, bodies or patient data.
    config.log(`${req.method} ${route} ${status} ${Date.now() - started}ms`);
  });
}
