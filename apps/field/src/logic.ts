/** Pure UI logic, kept out of components so it can be unit tested. */
import type { DoseUnit, Entry, EntryType, Limb, Proposal, Route, SurveyLetter } from "@pinpoint/core";
import { hhmm } from "@pinpoint/core";

export const ENTRY_LABELS: Record<EntryType, string> = {
  pulse: "Pulse",
  resp: "Respirations",
  bp: "Blood pressure",
  spo2: "SpO2",
  gcs: "GCS",
  med: "Medication",
  tourniquet: "Tourniquet",
  allergy: "Allergy",
  no_known_allergies: "Allergies",
  patient_report: "Patient reports",
  mechanism: "Mechanism",
  time_found: "Time found",
  patient: "Patient",
  survey: "Primary survey",
  note: "Note",
};

export function describeEntry(e: Entry): { label: string; value: string } {
  const label = ENTRY_LABELS[e.type];
  switch (e.type) {
    case "pulse":
      return { label, value: `${e.bpm} /min` };
    case "resp":
      return { label, value: `${e.rate} /min` };
    case "bp":
      return { label, value: e.diastolic === null ? `${e.systolic} by palpation` : `${e.systolic} / ${e.diastolic}` };
    case "spo2":
      return { label, value: `${e.percent}%` };
    case "gcs":
      return { label, value: e.e !== undefined ? `${e.total} (E${e.e} V${e.v} M${e.m})` : `${e.total}` };
    case "med": {
      const name = e.drug ?? `"${e.spoken}" (not matched)`;
      return { label, value: [name, e.dose ? `${e.dose.amount} ${e.dose.unit}` : "no dose", e.route ?? "no route"].join(" · ") };
    }
    case "tourniquet":
      return { label, value: `${e.action.toUpperCase()} · ${e.limb ?? "limb not said"}` };
    case "allergy":
      return { label, value: e.substance };
    case "no_known_allergies":
      return { label, value: "No known allergies" };
    case "patient_report":
    case "mechanism":
    case "note":
      return { label, value: e.text };
    case "time_found":
      return { label, value: hhmm(e.time) };
    case "patient":
      return { label, value: [e.name, e.age !== undefined ? `${e.age}` : undefined, e.sex].filter(Boolean).join(" · ") };
    case "survey":
      return { label: `${label} ${e.letter}`, value: e.finding };
  }
}

/** "Accept all" accepts clear cards only; cards that need a look stay on screen. */
export function splitForAcceptAll(cards: Proposal[]): { accept: Proposal[]; keep: Proposal[] } {
  const accept = cards.filter((c) => c.review.length === 0);
  const keep = cards.filter((c) => c.review.length > 0);
  return { accept, keep };
}

/** Resolve an unclear drug card by picking a name. */
export function pickDrug(card: Proposal, drug: string): Proposal {
  if (card.entry.type !== "med") return card;
  return { ...card, entry: { ...card.entry, drug }, review: card.review.filter((r) => !r.startsWith("Drug name unclear") && !r.includes("not on the drug list")) };
}

// ---- Fix screen forms ------------------------------------------------------

export type FormValues = Record<string, string>;

export const FORM_TYPES: EntryType[] = [
  "pulse", "resp", "bp", "spo2", "gcs", "tourniquet", "med", "allergy", "no_known_allergies",
  "patient_report", "mechanism", "time_found", "patient", "survey", "note",
];

export const LIMBS: Limb[] = ["left arm", "right arm", "left leg", "right leg"];
export const ROUTES: Route[] = ["PO", "IM", "IV", "IN", "SL", "INH", "NEB", "TOP", "NRB", "NC", "BVM"];
export const UNITS: DoseUnit[] = ["mg", "mcg", "g", "mL", "L/min", "units", "puffs", "tabs", "sprays"];
export const LETTERS: SurveyLetter[] = ["x", "A", "B", "C", "D", "E"];

const num = (v: string | undefined) => (v !== undefined && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);

/** Build an entry from fix-screen fields. Returns an error message instead when something is missing. */
export function entryFromForm(type: EntryType, f: FormValues, today: Date): Entry | { error: string } {
  const need = (v: number | undefined, name: string) => (v === undefined ? { error: `Enter ${name}` } : null);
  switch (type) {
    case "pulse": {
      const v = num(f.value);
      return need(v, "the pulse") ?? { type, bpm: v! };
    }
    case "resp": {
      const v = num(f.value);
      return need(v, "respirations") ?? { type, rate: v! };
    }
    case "spo2": {
      const v = num(f.value);
      return need(v, "SpO2") ?? { type, percent: v! };
    }
    case "bp": {
      const s = num(f.systolic);
      return need(s, "the systolic number") ?? { type, systolic: s!, diastolic: num(f.diastolic) ?? null };
    }
    case "gcs": {
      const t = num(f.total);
      return need(t, "the GCS total") ?? { type, total: t!, ...(num(f.e) !== undefined ? { e: num(f.e), v: num(f.v), m: num(f.m) } : {}) };
    }
    case "tourniquet":
      return { type, action: f.action === "off" ? "off" : "on", ...(f.limb ? { limb: f.limb as Limb } : {}) };
    case "med": {
      if (!f.drug?.trim()) return { error: "Enter the drug name" };
      const amount = num(f.amount);
      return {
        type,
        drug: f.drug.trim(),
        spoken: f.drug.trim(),
        ...(amount !== undefined ? { dose: { amount, unit: (f.unit || "mg") as DoseUnit } } : {}),
        ...(f.route ? { route: f.route as Route } : {}),
      };
    }
    case "allergy":
      return f.text?.trim() ? { type, substance: f.text.trim() } : { error: "Enter the allergy" };
    case "no_known_allergies":
      return { type };
    case "patient_report":
    case "mechanism":
    case "note":
      return f.text?.trim() ? { type, text: f.text.trim() } : { error: "Enter the text" };
    case "time_found": {
      const m = /^(\d{1,2}):?(\d{2})$/.exec(f.time ?? "");
      if (!m) return { error: "Enter the time as HH:MM" };
      const d = new Date(today);
      d.setHours(Number(m[1]), Number(m[2]), 0, 0);
      return { type, time: d.toISOString() };
    }
    case "patient": {
      const age = num(f.age);
      const out: Entry = { type, ...(f.name?.trim() ? { name: f.name.trim() } : {}), ...(age !== undefined ? { age } : {}), ...(f.sex === "male" || f.sex === "female" ? { sex: f.sex } : {}) };
      return Object.keys(out).length > 1 ? out : { error: "Enter at least one patient detail" };
    }
    case "survey":
      return f.finding?.trim() && f.letter ? { type, letter: f.letter as SurveyLetter, finding: f.finding.trim() } : { error: "Pick a letter and enter the finding" };
  }
}

/** Minutes since the latest vital sign, for display only. */
export function minutesSince(iso: string | undefined, now: Date): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60000));
}
