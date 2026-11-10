/**
 * The one versioned wilderness template for v1.
 *
 * PENDING: field names and order must be replaced with SCCSSAR's paper
 * patient form (ask Jerry), reviewed by the medical director. The primary
 * survey follows xABCDE; letters are recorded by tap with the medic's own
 * words. Labels here are form labels, not care instructions.
 */
import type { EntryType, SurveyLetter } from "./types.js";

export const TEMPLATE_VERSION = "wilderness-0.1.0-pending-sccssar-form";

export interface TemplateSection {
  id: string;
  label: string;
  entryTypes: EntryType[];
}

export const TEMPLATE: TemplateSection[] = [
  { id: "patient", label: "Patient", entryTypes: ["patient"] },
  { id: "incident", label: "Mechanism and time found", entryTypes: ["mechanism", "time_found"] },
  { id: "survey", label: "Primary survey (xABCDE)", entryTypes: ["survey"] },
  { id: "subjective", label: "Patient reports", entryTypes: ["patient_report"] },
  { id: "vitals", label: "Vital signs", entryTypes: ["pulse", "resp", "bp", "spo2", "gcs"] },
  { id: "treatment", label: "Treatment", entryTypes: ["tourniquet", "med"] },
  { id: "allergies", label: "Allergies", entryTypes: ["allergy", "no_known_allergies"] },
  { id: "notes", label: "Narrative notes", entryTypes: ["note"] },
];

export const SURVEY_LETTERS: { letter: SurveyLetter; label: string }[] = [
  { letter: "x", label: "x: Major bleeding" },
  { letter: "A", label: "A: Airway" },
  { letter: "B", label: "B: Breathing" },
  { letter: "C", label: "C: Circulation" },
  { letter: "D", label: "D: Disability" },
  { letter: "E", label: "E: Exposure / environment" },
];

/** Shown on the training card so medics learn phrasing the rules understand. */
export const SAY_IT_LIKE_THIS = [
  "Pulse 112, BP 130 over 85",
  "Resps 20, sats 94",
  "GCS 15",
  "Tourniquet left leg on",
  "Gave ondansetron 4 milligrams by mouth",
  "Allergic to penicillin",
  "Patient reports pain in the right ankle",
  "Mechanism fall from about 10 feet",
  "Found at 14 20",
];
