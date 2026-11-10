/**
 * One-page handoff in MIST order (Mechanism, Injuries/illness, Signs,
 * Treatment), plus allergies. Built only from charted entries: it restates
 * what was recorded and never interprets it.
 */
import { type Chart, type VitalRow, tourniquetMinutes } from "./chart.js";
import type { Entry } from "./types.js";

export const QR_MAX_CHARS = 350;

export const hhmm = (iso: string): string => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

function vitalsShort(r: VitalRow): string {
  const parts: string[] = [];
  if (r.pulse) parts.push(`P${r.pulse.value}`);
  if (r.resp) parts.push(`R${r.resp.value}`);
  if (r.bp) parts.push(`BP${r.bp.value.systolic}/${r.bp.value.diastolic ?? "palp"}`);
  if (r.spo2) parts.push(`SpO2 ${r.spo2.value}`);
  if (r.gcs) parts.push(`GCS${r.gcs.value.total}`);
  return `${hhmm(r.at)} ${parts.join(" ")}`;
}

function vitalsSpoken(r: VitalRow): string {
  const parts: string[] = [];
  if (r.pulse) parts.push(`pulse ${r.pulse.value}`);
  if (r.resp) parts.push(`respirations ${r.resp.value}`);
  if (r.bp) parts.push(r.bp.value.diastolic === null ? `BP ${r.bp.value.systolic} by palpation` : `BP ${r.bp.value.systolic} over ${r.bp.value.diastolic}`);
  if (r.spo2) parts.push(`SpO2 ${r.spo2.value} percent`);
  if (r.gcs) parts.push(`GCS ${r.gcs.value.total}`);
  return `at ${hhmm(r.at)}, ${parts.join(", ")}`;
}

function medShort(m: Extract<Entry, { type: "med" }>): string {
  const name = m.drug ?? `${m.spoken}(?)`;
  const dose = m.dose ? ` ${m.dose.amount}${m.dose.unit}` : "";
  const route = m.route ? ` ${m.route}` : "";
  return `${name}${dose}${route}`;
}

const limbShort = (l?: string) => (l ? l.replace("left", "L").replace("right", "R") : "limb?");

export interface Handoff {
  training: boolean;
  /** Screen sections, each a list of lines. */
  sections: { key: "M" | "I" | "S" | "T" | "A"; title: string; lines: string[] }[];
  /** Text for read-aloud. */
  speech: string;
  /** Plain text for the QR code, at most QR_MAX_CHARS characters. */
  qrText: string;
}

export function buildHandoff(chart: Chart, now: Date): Handoff {
  const pt = [chart.patient.age !== undefined ? `${chart.patient.age}` : "", chart.patient.sex ? chart.patient.sex[0]!.toUpperCase() : ""].join("");

  const M: string[] = chart.mechanism.map((m) => m.value);
  if (chart.timeFound) M.push(`Found ${hhmm(chart.timeFound.value)}`);
  const I: string[] = chart.reports.map((r) => r.value);
  const S: string[] = [];
  const first = chart.vitals[0];
  const last = chart.vitals[chart.vitals.length - 1];
  if (last) S.push(`Latest ${vitalsShort(last)}`);
  if (first && first !== last) S.push(`First ${vitalsShort(first)}`);
  const T: string[] = [];
  for (const t of chart.tourniquets) {
    const mins = tourniquetMinutes(t, now);
    if (t.onAt && !t.offAt) T.push(`TQ ${limbShort(t.limb)} ON ${hhmm(t.onAt)} (${mins} min)`);
    else if (t.onAt && t.offAt) T.push(`TQ ${limbShort(t.limb)} ${hhmm(t.onAt)}-${hhmm(t.offAt)} off`);
    else if (t.offAt) T.push(`TQ ${limbShort(t.limb)} off ${hhmm(t.offAt)}`);
  }
  for (const m of chart.meds) T.push(`${hhmm(m.at)} ${medShort(m.value)}`);
  const A: string[] = chart.allergies.items.length
    ? chart.allergies.items.map((a) => a.value)
    : chart.allergies.noneKnown
      ? ["No known allergies"]
      : ["Not recorded"];

  const sections: Handoff["sections"] = [
    { key: "M", title: "Mechanism", lines: M.length ? M : ["Not recorded"] },
    { key: "I", title: "Injuries / patient reports", lines: I.length ? I : ["Not recorded"] },
    { key: "S", title: "Signs", lines: S.length ? S : ["No vital signs recorded"] },
    { key: "T", title: "Treatment", lines: T.length ? T : ["None recorded"] },
    { key: "A", title: "Allergies", lines: A },
  ];

  // Read-aloud text.
  const say: string[] = [];
  if (chart.training) say.push("Training chart.");
  const who = [chart.patient.age !== undefined ? `${chart.patient.age} year old` : "", chart.patient.sex ?? ""].join(" ").trim();
  say.push(`Handoff for ${who || "patient"}.`);
  say.push(M.length ? `Mechanism: ${M.join("; ")}.` : "Mechanism not recorded.");
  if (I.length) say.push(`Patient reports: ${I.join("; ")}.`);
  if (last) say.push(`Latest vitals ${vitalsSpoken(last)}.`);
  if (first && first !== last) say.push(`First vitals ${vitalsSpoken(first)}.`);
  for (const t of chart.tourniquets) {
    if (t.onAt && !t.offAt) say.push(`Tourniquet on the ${t.limb ?? "limb"} since ${hhmm(t.onAt)}, ${tourniquetMinutes(t, now)} minutes.`);
    else if (t.onAt && t.offAt) say.push(`Tourniquet on the ${t.limb ?? "limb"} from ${hhmm(t.onAt)} to ${hhmm(t.offAt)}.`);
  }
  for (const m of chart.meds) {
    const v = m.value;
    say.push(`At ${hhmm(m.at)}, ${v.drug ?? v.spoken}${v.dose ? ` ${v.dose.amount} ${v.dose.unit}` : ""}${v.route ? ` ${v.route}` : ""}.`);
  }
  say.push(chart.allergies.items.length ? `Allergies: ${A.join(", ")}.` : chart.allergies.noneKnown ? "No known allergies." : "Allergies not recorded.");

  return { training: chart.training, sections, speech: say.join(" "), qrText: buildQrText(chart, { pt, M, I, S, T, A }) };
}

/**
 * Plain-text QR payload, readable by any stock camera with no network.
 * Priority when space runs out: header, treatment, allergies, signs, then
 * mechanism and reports are shortened first.
 */
function buildQrText(chart: Chart, p: { pt: string; M: string[]; I: string[]; S: string[]; T: string[]; A: string[] }): string {
  const header = [
    ...(chart.training ? ["TRAINING - NOT A REAL PATIENT"] : []),
    `PINPOINT HANDOFF ${chart.id.slice(0, 6).toUpperCase()} ${hhmm(chart.openedAt)}`,
    ...(p.pt ? [`PT ${p.pt}`] : []),
  ];
  const line = (k: string, items: string[]) => (items.length ? `${k}: ${items.join(" | ")}` : `${k}: -`);
  const body = { M: line("M", p.M), I: line("I", p.I), S: line("S", p.S), T: line("T", p.T), A: line("A", p.A) };
  const assemble = () => [...header, body.M, body.I, body.S, body.T, body.A].join("\n");

  const shrinkOrder: (keyof typeof body)[] = ["I", "M", "S", "T", "A"];
  let text = assemble();
  for (const k of shrinkOrder) {
    if (text.length <= QR_MAX_CHARS) break;
    const over = text.length - QR_MAX_CHARS;
    const cur = body[k];
    const keep = Math.max(k.length + 3, cur.length - over - 1);
    body[k] = cur.length > keep ? cur.slice(0, keep).trimEnd() + "~" : cur;
    text = assemble();
  }
  if (text.length > QR_MAX_CHARS) text = text.slice(0, QR_MAX_CHARS - 1) + "~";
  return text;
}
