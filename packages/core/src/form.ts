/**
 * Paper-form layouts: how a team's paper patient form maps onto the chart.
 *
 * A layout is display only. It never changes what is recorded (entries and
 * the template version stamped on events stay the same); it decides where
 * each charted value is drawn so the screen looks like the paper the team
 * already uses.
 *
 * Labels come from the paper (scanned layouts) or from template.ts (the
 * built-in layout). Engineers do not write medical wording here. Every
 * scanned layout is PENDING MEDICAL REVIEW until the medical lead signs off.
 */
import type { Chart, Stamped, VitalRow } from "./chart.js";
import { hhmm } from "./handoff.js";
import { TEMPLATE, TEMPLATE_VERSION, SURVEY_LETTERS } from "./template.js";
import type { Entry, EntryType, EventSource, Proposal, SurveyLetter } from "./types.js";

export const PENDING_MEDICAL_REVIEW = "PENDING MEDICAL REVIEW";

export type VitalType = "pulse" | "resp" | "bp" | "spo2" | "gcs";
export type PatientField = "name" | "age" | "sex";

/** Which chart data a paper field shows. null on a field = not captured by Pinpoint. */
export type FieldBinding =
  | { kind: "entries"; types: EntryType[] }
  | { kind: "vitals" }
  | { kind: "vital"; type: VitalType }
  | { kind: "patient"; field?: PatientField }
  | { kind: "survey"; letter: SurveyLetter }
  | { kind: "allergies" };

export interface FormField {
  id: string;
  label: string;
  bind: FieldBinding | null;
}

export interface FormSection {
  id: string;
  label: string;
  fields: FormField[];
}

export interface FormLayout {
  id: string;
  name: string;
  source: "builtin" | "scanned";
  version: string;
  reviewStatus: typeof PENDING_MEDICAL_REVIEW | "reviewed";
  /** Who signed it off and when, once reviewed. */
  reviewedBy?: string;
  createdAt?: string;
  sections: FormSection[];
}

// ---- Built-in layout ---------------------------------------------------------

/** The existing v1 template drawn as a form. Same labels as template.ts. */
export const BUILTIN_LAYOUT: FormLayout = {
  id: "builtin",
  name: "Pinpoint wilderness template",
  source: "builtin",
  version: TEMPLATE_VERSION,
  reviewStatus: PENDING_MEDICAL_REVIEW,
  sections: TEMPLATE.map((s) => {
    let fields: FormField[];
    if (s.id === "survey") {
      fields = SURVEY_LETTERS.map((l) => ({ id: `survey-${l.letter}`, label: l.label, bind: { kind: "survey", letter: l.letter } }));
    } else if (s.id === "vitals") {
      fields = [{ id: "vitals", label: s.label, bind: { kind: "vitals" } }];
    } else if (s.id === "patient") {
      fields = [{ id: "patient", label: s.label, bind: { kind: "patient" } }];
    } else if (s.id === "allergies") {
      fields = [{ id: "allergies", label: s.label, bind: { kind: "allergies" } }];
    } else {
      fields = [{ id: s.id, label: s.label, bind: { kind: "entries", types: [...s.entryTypes] } }];
    }
    return { id: s.id, label: s.label, fields };
  }),
};

// ---- Binding choices (for the review dropdown) ------------------------------

export interface BindingOption {
  key: string;
  label: string;
  bind: FieldBinding | null;
}

/** Names of the kinds of chart data, as the app already labels them. */
export const BINDING_OPTIONS: BindingOption[] = [
  { key: "none", label: "Not captured by Pinpoint", bind: null },
  { key: "patient", label: "Patient (all details)", bind: { kind: "patient" } },
  { key: "patient.name", label: "Patient name", bind: { kind: "patient", field: "name" } },
  { key: "patient.age", label: "Patient age", bind: { kind: "patient", field: "age" } },
  { key: "patient.sex", label: "Patient sex", bind: { kind: "patient", field: "sex" } },
  { key: "mechanism", label: "Mechanism", bind: { kind: "entries", types: ["mechanism"] } },
  { key: "time_found", label: "Time found", bind: { kind: "entries", types: ["time_found"] } },
  { key: "patient_report", label: "Patient reports", bind: { kind: "entries", types: ["patient_report"] } },
  ...SURVEY_LETTERS.map((l) => ({ key: `survey.${l.letter}`, label: `Primary survey ${l.label}`, bind: { kind: "survey", letter: l.letter } as FieldBinding })),
  { key: "vitals", label: "Vital signs table", bind: { kind: "vitals" } },
  { key: "vital.pulse", label: "Pulse", bind: { kind: "vital", type: "pulse" } },
  { key: "vital.resp", label: "Respirations", bind: { kind: "vital", type: "resp" } },
  { key: "vital.bp", label: "Blood pressure", bind: { kind: "vital", type: "bp" } },
  { key: "vital.spo2", label: "SpO2", bind: { kind: "vital", type: "spo2" } },
  { key: "vital.gcs", label: "GCS", bind: { kind: "vital", type: "gcs" } },
  { key: "med", label: "Medications", bind: { kind: "entries", types: ["med"] } },
  { key: "tourniquet", label: "Tourniquet", bind: { kind: "entries", types: ["tourniquet"] } },
  { key: "treatment", label: "Treatment (tourniquet and medications)", bind: { kind: "entries", types: ["tourniquet", "med"] } },
  { key: "allergies", label: "Allergies", bind: { kind: "allergies" } },
  { key: "note", label: "Notes", bind: { kind: "entries", types: ["note"] } },
];

export function bindingKey(b: FieldBinding | null): string {
  if (!b) return "none";
  switch (b.kind) {
    case "patient":
      return b.field ? `patient.${b.field}` : "patient";
    case "survey":
      return `survey.${b.letter}`;
    case "vital":
      return `vital.${b.type}`;
    case "vitals":
    case "allergies":
      return b.kind;
    case "entries": {
      const t = [...b.types].sort().join("+");
      if (t === "med+tourniquet") return "treatment";
      return b.types.length === 1 ? b.types[0]! : `entries.${t}`;
    }
  }
}

export function bindingFromKey(key: string): FieldBinding | null {
  return BINDING_OPTIONS.find((o) => o.key === key)?.bind ?? null;
}

export function bindingLabel(b: FieldBinding | null): string {
  const key = bindingKey(b);
  return BINDING_OPTIONS.find((o) => o.key === key)?.label ?? key;
}

// ---- Suggesting bindings from paper labels ----------------------------------

const RULES: { re: RegExp; bind: FieldBinding }[] = [
  { re: /\b(tourniquet|tq)\b/, bind: { kind: "entries", types: ["tourniquet"] } },
  { re: /\btime (pt |patient )?(found|located|reached)\b|\bfound at\b|\blocated at\b/, bind: { kind: "entries", types: ["time_found"] } },
  { re: /\bvital signs?\b|\bvitals\b/, bind: { kind: "vitals" } },
  { re: /\bblood pressure\b|\bb\/?p\b|\bnibp\b/, bind: { kind: "vital", type: "bp" } },
  { re: /\bsp ?o2\b|\bsp ?02\b|\bsa ?o2\b|\bo2 sat|\bsats?\b|\bpulse ?ox|\boxygen sat/, bind: { kind: "vital", type: "spo2" } },
  { re: /\bpulse\b|\bheart rate\b|\bhr\b/, bind: { kind: "vital", type: "pulse" } },
  { re: /\bresp(s|irations?|iratory rate)?\b|\brr\b|\bbreaths? ?(per|\/) ?min/, bind: { kind: "vital", type: "resp" } },
  { re: /\bgcs\b|\bglasgow\b|\bloc\b|\blevel of consciousness\b/, bind: { kind: "vital", type: "gcs" } },
  { re: /\ballerg|\bnkda\b|\bnka\b/, bind: { kind: "allergies" } },
  { re: /\bmed(s|ication|ications)?\b|\bdrugs?\b|\brx\b/, bind: { kind: "entries", types: ["med"] } },
  { re: /\btreatments?\b|\binterventions?\b|\bcare given\b/, bind: { kind: "entries", types: ["tourniquet", "med"] } },
  { re: /\bmechanism\b|\bmoi\b|\bhow (it happened|injured)\b/, bind: { kind: "entries", types: ["mechanism"] } },
  { re: /\bchief complaint\b|\bc\/?c\b|\bcomplaints?\b|\bpatient reports?\b|\bpt reports?\b|\bhpi\b|\bsubjective\b|\bsymptoms\b/, bind: { kind: "entries", types: ["patient_report"] } },
  { re: /\b(pt |patient )?name\b/, bind: { kind: "patient", field: "name" } },
  { re: /\bage\b|\bdob\b|\bdate of birth\b/, bind: { kind: "patient", field: "age" } },
  { re: /\bsex\b|\bgender\b/, bind: { kind: "patient", field: "sex" } },
  { re: /\bmassive (hemorrhage|haemorrhage|bleeding)\b|\bhemorrhage\b|\bhaemorrhage\b|\bbleeding\b|\bx ?[-:]/, bind: { kind: "survey", letter: "x" } },
  { re: /\bairway\b/, bind: { kind: "survey", letter: "A" } },
  { re: /\bbreathing\b/, bind: { kind: "survey", letter: "B" } },
  { re: /\bcirculation\b/, bind: { kind: "survey", letter: "C" } },
  { re: /\bdisability\b|\bneuro\b/, bind: { kind: "survey", letter: "D" } },
  { re: /\bexposure\b|\benvironment(al)?\b/, bind: { kind: "survey", letter: "E" } },
  { re: /\bnotes?\b|\bnarrative\b|\bcomments?\b|\bremarks\b|\bsoap\b/, bind: { kind: "entries", types: ["note"] } },
];

/** Words a scanned label is checked against for one-letter OCR slips ("Alrway"). */
const KEYWORDS = [
  "tourniquet", "vitals", "pressure", "pulse", "respirations", "respiratory", "glasgow", "allergies", "allergy",
  "medications", "medication", "treatment", "mechanism", "complaint", "symptoms", "subjective", "gender",
  "hemorrhage", "haemorrhage", "bleeding", "airway", "breathing", "circulation", "disability", "exposure",
  "environment", "narrative", "comments", "remarks", "found", "located", "name",
];

function within1(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** Undo common OCR slips in a lowercased label: "bip" for b/p, digits for letters, near-miss keywords. */
function fixOcr(text: string): string {
  return text
    .split(" ")
    .map((w) => {
      if (w === "bip" || w === "b1p" || w === "blp") return "b/p";
      if (/^sp[o0]2$|^sp0o2$|^spo02$/.test(w)) return "spo2";
      if (w.length < 5 || KEYWORDS.includes(w)) return w;
      const letters = w.replace(/1/g, "l").replace(/0/g, "o");
      // "rn" is often a misread "m", but real words have "rn" too (tourniquet), so try both.
      for (const v of [letters, letters.replace(/rn/g, "m")]) {
        if (KEYWORDS.includes(v)) return v;
        const near = KEYWORDS.find((k) => k.length >= 5 && within1(v, k));
        if (near) return near;
      }
      return w;
    })
    .join(" ");
}

/**
 * Guess what chart data a paper label holds. The match that starts earliest
 * in the label wins ("Circulation (pulse, skin)" is survey C, not pulse);
 * ties go to the longer match ("Pulse ox" is SpO2). Tolerates one-letter OCR
 * slips in longer words. Null when nothing fits.
 */
export function suggestBinding(label: string): FieldBinding | null {
  const text = ` ${fixOcr(label.toLowerCase().replace(/[^a-z0-9/ ]+/g, " ").replace(/\s+/g, " ").trim())} `;
  let best: { index: number; length: number; bind: FieldBinding } | null = null;
  for (const r of RULES) {
    const m = r.re.exec(text);
    if (!m) continue;
    if (!best || m.index < best.index || (m.index === best.index && m[0].length > best.length)) best = { index: m.index, length: m[0].length, bind: r.bind };
  }
  return best ? structuredClone(best.bind) : null;
}

// ---- Building a draft layout from OCR ---------------------------------------

export interface OcrLine {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  /** 0-100, as tesseract reports it. */
  confidence: number;
}

export interface LayoutFromOcrOptions {
  /** Lines below this confidence are dropped. Default 40. */
  minConfidence?: number;
  createdAt?: string;
}

/** Strip fill-in lines, checkboxes and trailing colons from a printed label. */
export function cleanLabel(raw: string): string {
  return raw
    .replace(/[_]{2,}|\.{3,}|[-]{3,}|[|]+/g, " ")
    .replace(/[□☐☑☒■◻◼▢]/g, " ")
    .replace(/^\s*(\[\s*\]|\(\s*\)|[o0]\s(?=[A-Z]))\s*/, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s:;,.\-–—•*]+|[\s:;,.\-–—•*]+$/g, "")
    .trim();
}

/** "Age: ____ Sex: ____" is two fields. Split on fill-in lines and on "Label:" runs. */
export function splitLabels(raw: string): string[] {
  const parts = raw.split(/_{2,}|\.{3,}|\s{3,}|\s\|\s/);
  const out: string[] = [];
  for (const part of parts) {
    // "Age: Sex:" -> ["Age", "Sex"]; "Time: 14:20" stays one.
    const pieces = part.split(/(?<=[A-Za-z)]):\s+(?=[A-Z])/);
    for (const p of pieces) {
      const c = cleanLabel(p);
      if (c) out.push(c);
    }
  }
  return out;
}

const letters = (s: string) => (s.match(/[A-Za-z]/g) ?? []).length;

function isNoise(label: string): boolean {
  if (label.length < 2) return label !== "x" && label !== "X";
  const l = letters(label);
  if (l === 0) return true;
  // Mostly symbols or digits: page numbers, stray marks, OCR garbage.
  if (l / label.replace(/\s/g, "").length < 0.5) return true;
  return false;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "field";
}

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

/**
 * Turn OCR lines from a photo of a blank paper form into a draft layout.
 * Larger or short ALL-CAPS lines without a colon become section headers,
 * everything else becomes field labels, in paper order. Bindings are only
 * suggestions; a person reviews every field before the layout is saved.
 */
export function layoutFromOcrLines(lines: OcrLine[], name: string, opts: LayoutFromOcrOptions = {}): FormLayout {
  const minConf = opts.minConfidence ?? 40;
  const kept = lines.filter((l) => l.confidence >= minConf && l.text.trim());
  const heights = kept.map((l) => l.bbox.y1 - l.bbox.y0);
  const medH = median(heights) || 1;

  // Paper order: rows top to bottom (lines within half a line height share a row), then left to right.
  const sorted = [...kept].sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const rows: OcrLine[][] = [];
  for (const l of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(l.bbox.y0 - row[0]!.bbox.y0) < medH * 0.5) row.push(l);
    else rows.push([l]);
  }
  const ordered = rows.flatMap((r) => r.sort((a, b) => a.bbox.x0 - b.bbox.x0));
  // Column headings of a printed grid ("Pulse  Resp  BP  GCS") share a row; they are fields, not sections.
  const inSharedRow = new Set(rows.filter((r) => r.length > 1).flat());

  const sections: FormSection[] = [];
  let title = name.trim();
  const ensureSection = () => {
    if (!sections.length) sections.push({ id: "s1", label: "Section 1", fields: [] });
    return sections[sections.length - 1]!;
  };

  ordered.forEach((line, i) => {
    const raw = line.text.trim();
    const h = line.bbox.y1 - line.bbox.y0;
    const whole = cleanLabel(raw);
    if (!whole || isNoise(whole)) return;
    const caps = letters(whole) >= 3 && whole === whole.toUpperCase();
    const words = whole.split(" ").length;
    const hasColon = /:\s*($|_)/.test(raw) || /_{2,}/.test(raw);
    const large = h >= medH * 1.35;
    const header = !hasColon && !inSharedRow.has(line) && (large || (caps && words <= 5));

    if (header) {
      // The first, largest line at the top is the form's title when no name was given.
      if (i === 0 && large && !title) {
        title = whole;
        return;
      }
      if (i === 0 && large && title && whole.toLowerCase() === title.toLowerCase()) return;
      sections.push({ id: `s${sections.length + 1}`, label: whole, fields: [] });
      return;
    }
    const sec = ensureSection();
    for (const label of splitLabels(raw)) {
      if (isNoise(label)) continue;
      if (sec.fields.some((f) => f.label.toLowerCase() === label.toLowerCase())) continue;
      sec.fields.push({ id: `${sec.id}-${slug(label)}-${sec.fields.length + 1}`, label, bind: suggestBinding(label) });
    }
  });

  // A header with nothing under it ("VITAL SIGNS" over a printed grid) is itself the field.
  for (const sec of sections) {
    if (sec.fields.length === 0) sec.fields.push({ id: `${sec.id}-${slug(sec.label)}-1`, label: sec.label, bind: suggestBinding(sec.label) });
  }

  const hash = fnv(JSON.stringify(sections.map((s) => [s.label, s.fields.map((f) => f.label)])));
  return {
    id: `scan-${hash}`,
    name: title || "Scanned form",
    source: "scanned",
    version: `scan-${hash}`,
    reviewStatus: PENDING_MEDICAL_REVIEW,
    ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    sections: sections.filter((s) => s.fields.length > 0),
  };
}

/** Basic shape check for layouts read back from storage. */
export function isFormLayout(x: unknown): x is FormLayout {
  if (typeof x !== "object" || x === null) return false;
  const l = x as FormLayout;
  return (
    typeof l.id === "string" &&
    typeof l.name === "string" &&
    (l.source === "builtin" || l.source === "scanned") &&
    Array.isArray(l.sections) &&
    l.sections.every((s) => typeof s.id === "string" && typeof s.label === "string" && Array.isArray(s.fields) && s.fields.every((f) => typeof f.id === "string" && typeof f.label === "string"))
  );
}

// ---- Filling the form ---------------------------------------------------------

export interface FilledValue {
  text: string;
  /** When it happened (entry time, or speech time for a waiting card). */
  at: string;
  /** Confirmed values only. */
  source?: EventSource;
  eventId?: string;
  /** Source words, when it came from voice. */
  quote?: string;
  /** True for a voice card that has not been confirmed. Never part of the record. */
  pending: boolean;
  cardId?: string;
}

export const VITAL_COLUMNS: { key: VitalType; label: string }[] = [
  { key: "pulse", label: "Pulse" },
  { key: "resp", label: "Resp" },
  { key: "bp", label: "BP" },
  { key: "spo2", label: "SpO2" },
  { key: "gcs", label: "GCS" },
];

export interface VitalsTableRow {
  at: string;
  pending: boolean;
  cells: Partial<Record<VitalType, FilledValue>>;
}

export interface FilledField {
  id: string;
  label: string;
  bind: FieldBinding | null;
  /** Oldest first. Empty when nothing is charted. */
  values: FilledValue[];
  /** Only for the vital signs table binding. */
  table?: VitalsTableRow[];
  /** The paper has this field but Pinpoint doesn't capture it. */
  unsupported: boolean;
}

export interface FilledSection {
  id: string;
  label: string;
  fields: FilledField[];
}

export interface FilledForm {
  layoutId: string;
  name: string;
  reviewStatus: FormLayout["reviewStatus"];
  sections: FilledSection[];
  counts: { confirmed: number; pending: number; empty: number; unsupported: number };
  /** Chart entry ids shown nowhere on this layout (so nothing charted is hidden). */
  unplacedEntryIds: string[];
}

const VITAL_ENTRY: Record<VitalType, EntryType> = { pulse: "pulse", resp: "resp", bp: "bp", spo2: "spo2", gcs: "gcs" };

/** Short value text for the paper, without the field label. */
export function formatEntryValue(e: Entry, withKind = false): string {
  switch (e.type) {
    case "pulse":
      return `${e.bpm} /min`;
    case "resp":
      return `${e.rate} /min`;
    case "bp":
      return e.diastolic === null ? `${e.systolic} palp` : `${e.systolic}/${e.diastolic}`;
    case "spo2":
      return `${e.percent}%`;
    case "gcs":
      return e.e !== undefined ? `${e.total} (E${e.e} V${e.v} M${e.m})` : `${e.total}`;
    case "med": {
      const name = e.drug ?? `"${e.spoken}" (not matched)`;
      return [name, e.dose ? `${e.dose.amount} ${e.dose.unit}` : "", e.route ?? ""].filter(Boolean).join(" ");
    }
    case "tourniquet":
      return `${withKind ? "Tourniquet " : ""}${e.action.toUpperCase()}${e.limb ? ` · ${e.limb}` : ""}`;
    case "allergy":
      return e.substance;
    case "no_known_allergies":
      return "No known allergies";
    case "patient_report":
    case "mechanism":
    case "note":
      return e.text;
    case "time_found":
      return `${withKind ? "Found " : ""}${hhmm(e.time)}`;
    case "patient":
      return [e.name, e.age !== undefined ? `${e.age}` : undefined, e.sex].filter(Boolean).join(" · ");
    case "survey":
      return e.finding;
  }
}

function patientValue(e: Extract<Entry, { type: "patient" }>, field?: PatientField): string | null {
  if (!field) return formatEntryValue(e);
  const v = e[field];
  return v === undefined ? null : String(v);
}

/** Does this entry belong in a field with this binding? Returns the text to show, or null. */
function textFor(bind: FieldBinding, entry: Entry): string | null {
  switch (bind.kind) {
    case "entries":
      return bind.types.includes(entry.type) ? formatEntryValue(entry, bind.types.length > 1) : null;
    case "vital":
      return entry.type === VITAL_ENTRY[bind.type] ? formatEntryValue(entry) : null;
    case "vitals":
      return null; // drawn as a table
    case "patient":
      return entry.type === "patient" ? patientValue(entry, bind.field) : null;
    case "survey":
      return entry.type === "survey" && entry.letter === bind.letter ? entry.finding : null;
    case "allergies":
      return entry.type === "allergy" || entry.type === "no_known_allergies" ? formatEntryValue(entry) : null;
  }
}

const isVital = (t: EntryType): t is VitalType => t === "pulse" || t === "resp" || t === "bp" || t === "spo2" || t === "gcs";

function confirmedValue(s: Stamped<Entry>, text: string): FilledValue {
  return { text, at: s.at, source: s.source, eventId: s.eventId, ...(s.quote ? { quote: s.quote } : {}), pending: false };
}

function pendingValue(p: Proposal, text: string): FilledValue {
  return { text, at: p.at, quote: p.quote, pending: true, cardId: p.id };
}

function vitalsTable(rows: VitalRow[], pending: Proposal[]): VitalsTableRow[] {
  const out: VitalsTableRow[] = rows.map((r) => {
    const cells: VitalsTableRow["cells"] = {};
    for (const c of VITAL_COLUMNS) {
      const s = r[c.key] as Stamped<unknown> | undefined;
      if (!s) continue;
      const entry = c.key === "gcs" ? (s.value as Entry) : null;
      const text =
        c.key === "bp"
          ? formatEntryValue({ type: "bp", ...(s.value as { systolic: number; diastolic: number | null }) })
          : c.key === "gcs"
            ? formatEntryValue(entry!)
            : `${s.value as number}`;
      cells[c.key] = { text, at: s.at, source: s.source, eventId: s.eventId, ...(s.quote ? { quote: s.quote } : {}), pending: false };
    }
    return { at: r.at, pending: false, cells };
  });
  const byTime = new Map<string, VitalsTableRow>();
  for (const p of pending) {
    if (!isVital(p.entry.type)) continue;
    let row = byTime.get(p.at);
    if (!row) {
      row = { at: p.at, pending: true, cells: {} };
      byTime.set(p.at, row);
      out.push(row);
    }
    const text = p.entry.type === "pulse" || p.entry.type === "resp" || p.entry.type === "spo2" ? formatEntryValue(p.entry).replace(/ \/min|%/, "") : formatEntryValue(p.entry);
    row.cells[p.entry.type] = pendingValue(p, text);
  }
  return out.sort((a, b) => a.at.localeCompare(b.at) || Number(a.pending) - Number(b.pending));
}

/**
 * Lay the chart (and any cards still waiting for a tap) onto a paper form.
 * Pure: call it on every render and it stays live as cards arrive.
 */
export function fillForm(layout: FormLayout, chart: Chart, pending: Proposal[] = []): FilledForm {
  const counts = { confirmed: 0, pending: 0, empty: 0, unsupported: 0 };
  const placed = new Set<string>();

  const sections: FilledSection[] = layout.sections.map((sec) => ({
    id: sec.id,
    label: sec.label,
    fields: sec.fields.map((f): FilledField => {
      if (!f.bind) {
        counts.unsupported++;
        return { id: f.id, label: f.label, bind: null, values: [], unsupported: true };
      }
      const bind = f.bind;
      if (bind.kind === "vitals") {
        const table = vitalsTable(chart.vitals, pending);
        for (const r of table) for (const c of Object.values(r.cells)) {
          if (!c) continue;
          if (c.pending) counts.pending++;
          else {
            counts.confirmed++;
            placed.add(c.eventId!);
          }
        }
        if (!table.length) counts.empty++;
        return { id: f.id, label: f.label, bind, values: [], table, unsupported: false };
      }

      let values: FilledValue[] = [];
      if (bind.kind === "patient" && bind.field) {
        // Later entries win field by field, as in the chart projection.
        const latest = [...chart.entries].reverse().find((s) => s.value.type === "patient" && s.value[bind.field!] !== undefined);
        if (latest) values.push(confirmedValue(latest, textFor(bind, latest.value)!));
        for (const s of chart.entries) if (s.value.type === "patient" && s.value[bind.field] !== undefined) placed.add(s.eventId);
      } else {
        for (const s of chart.entries) {
          const text = textFor(bind, s.value);
          if (text === null) continue;
          values.push(confirmedValue(s, text));
          placed.add(s.eventId);
        }
      }
      counts.confirmed += values.length;
      const waiting = pending.flatMap((p) => {
        const text = textFor(bind, p.entry);
        return text === null ? [] : [pendingValue(p, text)];
      });
      counts.pending += waiting.length;
      values = [...values, ...waiting].sort((a, b) => a.at.localeCompare(b.at) || Number(a.pending) - Number(b.pending));
      if (!values.length) counts.empty++;
      return { id: f.id, label: f.label, bind, values, unsupported: false };
    }),
  }));

  return {
    layoutId: layout.id,
    name: layout.name,
    reviewStatus: layout.reviewStatus,
    sections,
    counts,
    unplacedEntryIds: chart.entries.filter((s) => !placed.has(s.eventId)).map((s) => s.eventId),
  };
}
