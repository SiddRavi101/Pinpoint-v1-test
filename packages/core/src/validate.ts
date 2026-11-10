/**
 * Shape checks for events crossing a trust boundary (device -> server).
 * Hand-written so the core stays dependency-free.
 */
import { MIN_SCHEMA_VERSION, SCHEMA_VERSION, type ChartEvent } from "./types.js";

const KINDS = new Set(["chart_opened", "entry", "entry_voided", "chart_closed", "sync_confirmed", "utterance"]);
const SOURCES = new Set(["tap", "voice", "guidance", "system"]);
const ENTRY_TYPES = new Set([
  "pulse", "resp", "bp", "spo2", "gcs", "med", "tourniquet", "allergy", "no_known_allergies",
  "patient_report", "mechanism", "time_found", "patient", "survey", "note",
]);

const isIso = (v: unknown) => typeof v === "string" && !Number.isNaN(Date.parse(v));
const isStr = (v: unknown, max = 2000) => typeof v === "string" && v.length <= max;

export function validateEvent(e: unknown): { ok: true; event: ChartEvent } | { ok: false; error: string } {
  if (typeof e !== "object" || e === null) return { ok: false, error: "not an object" };
  const x = e as Record<string, unknown>;
  if (!isStr(x.id, 100) || !x.id) return { ok: false, error: "id" };
  if (!isStr(x.chartId, 100) || !x.chartId) return { ok: false, error: "chartId" };
  if (!Number.isInteger(x.seq) || (x.seq as number) < 1) return { ok: false, error: "seq" };
  if (!isIso(x.at) || !isIso(x.loggedAt)) return { ok: false, error: "timestamps" };
  if (!SOURCES.has(x.source as string)) return { ok: false, error: "source" };
  if (typeof x.confirmed !== "boolean") return { ok: false, error: "confirmed" };
  if (!isStr(x.templateVersion, 100) || !isStr(x.deviceId, 100)) return { ok: false, error: "versions" };
  if (x.ruleVersion !== null && !isStr(x.ruleVersion, 100)) return { ok: false, error: "ruleVersion" };
  if (!Number.isInteger(x.schemaVersion) || (x.schemaVersion as number) < MIN_SCHEMA_VERSION || (x.schemaVersion as number) > SCHEMA_VERSION) return { ok: false, error: "schemaVersion" };
  if (!KINDS.has(x.kind as string)) return { ok: false, error: "kind" };
  if (typeof x.payload !== "object" || x.payload === null) return { ok: false, error: "payload" };
  const p = x.payload as Record<string, unknown>;
  if (x.kind === "entry") {
    if (x.confirmed !== true) return { ok: false, error: "entries must be confirmed" };
    if (x.source === "guidance") return { ok: false, error: "guidance not allowed" };
    const entry = p.entry as Record<string, unknown> | undefined;
    if (!entry || !ENTRY_TYPES.has(entry.type as string)) return { ok: false, error: "entry.type" };
    if (JSON.stringify(entry).length > 4000) return { ok: false, error: "entry too large" };
    if (p.quote !== undefined && !isStr(p.quote, 500)) return { ok: false, error: "quote" };
    if (p.utteranceId !== undefined && (!isStr(p.utteranceId, 100) || !p.utteranceId)) return { ok: false, error: "utteranceId" };
  }
  if (x.kind === "utterance") {
    if (x.source !== "voice" || x.confirmed !== false) return { ok: false, error: "utterance source" };
    if (!isStr(p.text, 4000) || !isIso(p.startedAt) || !isIso(p.endedAt) || !isStr(p.engine, 100)) return { ok: false, error: "utterance" };
    if (p.segments !== undefined) {
      const segs = p.segments;
      if (!Array.isArray(segs) || segs.length > 500) return { ok: false, error: "segments" };
      for (const g of segs as Record<string, unknown>[]) {
        if (typeof g !== "object" || g === null || !Number.isFinite(g.start) || !Number.isFinite(g.end) || !isStr(g.text, 4000)) return { ok: false, error: "segment" };
      }
    }
  }
  if (x.kind === "entry_voided" && !isStr(p.targetId, 100)) return { ok: false, error: "targetId" };
  if (x.kind === "chart_opened" && typeof p.training !== "boolean") return { ok: false, error: "training" };
  return { ok: true, event: e as ChartEvent };
}
