/**
 * Core data contracts. Changes here go through PR review by every consumer
 * (field app, server, review page). See docs/quality/change-control.md.
 */

export const SCHEMA_VERSION = 1;

/** Where an event came from. "guidance" is reserved for Track 2 and unused in Track 1. */
export type EventSource = "tap" | "voice" | "guidance" | "system";

export type Limb = "left arm" | "right arm" | "left leg" | "right leg";

export type DoseUnit = "mg" | "mcg" | "g" | "mL" | "L/min" | "units" | "puffs" | "tabs" | "sprays";

export type Route = "PO" | "IM" | "IV" | "IN" | "SL" | "INH" | "NEB" | "TOP" | "NRB" | "NC" | "BVM";

/** xABCDE primary survey letters. Recorded by tap only; findings are the medic's words. */
export type SurveyLetter = "x" | "A" | "B" | "C" | "D" | "E";

export type Entry =
  | { type: "pulse"; bpm: number }
  | { type: "resp"; rate: number }
  | { type: "bp"; systolic: number; diastolic: number | null }
  | { type: "spo2"; percent: number }
  | { type: "gcs"; total: number; e?: number; v?: number; m?: number }
  | {
      type: "med";
      /** Canonical drug name from the vocabulary list, or null when not matched. */
      drug: string | null;
      /** The words the medic said for the drug. */
      spoken: string;
      dose?: { amount: number; unit: DoseUnit };
      route?: Route;
    }
  | { type: "tourniquet"; action: "on" | "off"; limb?: Limb }
  | { type: "allergy"; substance: string }
  | { type: "no_known_allergies" }
  | { type: "patient_report"; text: string }
  | { type: "mechanism"; text: string }
  | { type: "time_found"; time: string }
  | { type: "patient"; name?: string; age?: number; sex?: "male" | "female" }
  | { type: "survey"; letter: SurveyLetter; finding: string }
  | { type: "note"; text: string };

export type EntryType = Entry["type"];

interface BaseEvent {
  /** Unique, client-generated (UUID). Used for idempotent sync. */
  id: string;
  chartId: string;
  /** 1-based position in this chart's log. Gapless. */
  seq: number;
  /** When it happened in the field (speech time for voice). ISO 8601. */
  at: string;
  /** When the event was written to the log. ISO 8601. */
  loggedAt: string;
  source: EventSource;
  /** True when a person confirmed it with a tap. Entries must be confirmed. */
  confirmed: boolean;
  templateVersion: string;
  /** Rule version for voice-derived entries; null otherwise. */
  ruleVersion: string | null;
  deviceId: string;
  schemaVersion: number;
}

export type ChartEvent =
  | (BaseEvent & { kind: "chart_opened"; payload: { training: boolean } })
  | (BaseEvent & { kind: "entry"; payload: { entry: Entry; quote?: string } })
  | (BaseEvent & {
      kind: "entry_voided";
      payload: { targetId: string; reason: "corrected" | "entered_in_error" };
    })
  | (BaseEvent & { kind: "chart_closed"; payload: Record<string, never> })
  | (BaseEvent & {
      kind: "sync_confirmed";
      payload: { receiptId: string; serverEventCount: number; confirmedAt: string };
    });

export type EventKind = ChartEvent["kind"];

/** A voice-derived card waiting for a tap. Never part of the chart until confirmed. */
export interface Proposal {
  id: string;
  entry: Entry;
  /** Source words, 15 or fewer. */
  quote: string;
  /** Speech time. */
  at: string;
  /** Plain-language reasons the medic should look closely. Empty when clear. */
  review: string[];
  /** For unclear drug matches: the closest names on the list. */
  candidates?: string[];
  ruleVersion: string;
}
