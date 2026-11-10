/**
 * Chart projection: the record a medic sees is always computed from the
 * event log. Voided entries drop out; nothing is edited in place.
 */
import type { ChartEvent, Entry, EventSource, Limb, SurveyLetter, TranscriptSegment } from "./types.js";

export interface Stamped<T> {
  eventId: string;
  at: string;
  source: EventSource;
  quote?: string;
  utteranceId?: string;
  value: T;
}

/** One line of the transcript, with the chart entries confirmed from it. */
export interface TranscriptLine {
  eventId: string;
  startedAt: string;
  endedAt: string;
  text: string;
  engine: string;
  segments: TranscriptSegment[];
  /** Active (not voided) entries confirmed from this utterance. */
  entryIds: string[];
  /** Entries from this utterance that were later voided. */
  voidedEntryIds: string[];
}

export interface VitalRow {
  at: string;
  pulse?: Stamped<number>;
  resp?: Stamped<number>;
  bp?: Stamped<{ systolic: number; diastolic: number | null }>;
  spo2?: Stamped<number>;
  gcs?: Stamped<Extract<Entry, { type: "gcs" }>>;
}

export interface TourniquetRecord {
  limb?: Limb;
  onAt?: string;
  offAt?: string;
  onEventId?: string;
  offEventId?: string;
}

export interface Chart {
  id: string;
  training: boolean;
  openedAt: string;
  closedAt?: string;
  syncedAt?: string;
  /** Number of events the server confirmed in its latest receipt. */
  syncedEventCount: number;
  eventCount: number;
  status: "open" | "closed";
  patient: { name?: string; age?: number; sex?: "male" | "female" };
  mechanism: Stamped<string>[];
  timeFound?: Stamped<string>;
  survey: Partial<Record<SurveyLetter, Stamped<string>[]>>;
  reports: Stamped<string>[];
  vitals: VitalRow[];
  meds: Stamped<Extract<Entry, { type: "med" }>>[];
  tourniquets: TourniquetRecord[];
  allergies: { noneKnown?: Stamped<true>; items: Stamped<string>[] };
  notes: Stamped<string>[];
  /** Every active entry, oldest first. */
  entries: Stamped<Entry>[];
  /** Everything heard, oldest first. Not part of the record itself. */
  transcript: TranscriptLine[];
}

export function projectChart(events: readonly ChartEvent[]): Chart {
  const opened = events[0];
  if (!opened || opened.kind !== "chart_opened") throw new Error("A chart must start with chart_opened");

  const voided = new Set(events.filter((e) => e.kind === "entry_voided").map((e) => (e.kind === "entry_voided" ? e.payload.targetId : "")));
  const active = events.filter((e): e is Extract<ChartEvent, { kind: "entry" }> => e.kind === "entry" && !voided.has(e.id));
  const sorted = [...active].sort((a, b) => a.at.localeCompare(b.at) || a.seq - b.seq);

  const chart: Chart = {
    id: opened.chartId,
    training: opened.payload.training,
    openedAt: opened.at,
    status: "open",
    syncedEventCount: 0,
    eventCount: events.length,
    patient: {},
    mechanism: [],
    survey: {},
    reports: [],
    vitals: [],
    meds: [],
    tourniquets: [],
    allergies: { items: [] },
    notes: [],
    entries: [],
    transcript: [],
  };

  for (const e of events) {
    if (e.kind !== "utterance") continue;
    chart.transcript.push({
      eventId: e.id,
      startedAt: e.payload.startedAt,
      endedAt: e.payload.endedAt,
      text: e.payload.text,
      engine: e.payload.engine,
      segments: e.payload.segments ?? [],
      entryIds: [],
      voidedEntryIds: [],
    });
  }
  for (const e of events) {
    if (e.kind !== "entry" || !e.payload.utteranceId) continue;
    const line = chart.transcript.find((t) => t.eventId === e.payload.utteranceId);
    if (line) (voided.has(e.id) ? line.voidedEntryIds : line.entryIds).push(e.id);
  }
  chart.transcript.sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  for (const e of events) {
    if (e.kind === "chart_closed") {
      chart.status = "closed";
      chart.closedAt = e.at;
    }
    if (e.kind === "sync_confirmed") {
      chart.syncedAt = e.payload.confirmedAt;
      chart.syncedEventCount = e.payload.serverEventCount;
    }
  }

  const rowFor = (at: string): VitalRow => {
    let row = chart.vitals.find((r) => r.at === at);
    if (!row) {
      row = { at };
      chart.vitals.push(row);
    }
    return row;
  };

  for (const e of sorted) {
    const entry = e.payload.entry;
    const stamp = <T>(value: T): Stamped<T> => ({ eventId: e.id, at: e.at, source: e.source, ...(e.payload.quote ? { quote: e.payload.quote } : {}), ...(e.payload.utteranceId ? { utteranceId: e.payload.utteranceId } : {}), value });
    chart.entries.push(stamp(entry));
    switch (entry.type) {
      case "pulse":
        rowFor(e.at).pulse = stamp(entry.bpm);
        break;
      case "resp":
        rowFor(e.at).resp = stamp(entry.rate);
        break;
      case "bp":
        rowFor(e.at).bp = stamp({ systolic: entry.systolic, diastolic: entry.diastolic });
        break;
      case "spo2":
        rowFor(e.at).spo2 = stamp(entry.percent);
        break;
      case "gcs":
        rowFor(e.at).gcs = stamp(entry);
        break;
      case "med":
        chart.meds.push(stamp(entry));
        break;
      case "tourniquet": {
        if (entry.action === "on") {
          chart.tourniquets.push({ limb: entry.limb, onAt: e.at, onEventId: e.id });
        } else {
          // Close the most recent open tourniquet on that limb (or the only open one).
          const open = chart.tourniquets.filter((t) => t.onAt && !t.offAt);
          const match = [...open].reverse().find((t) => (entry.limb ? t.limb === entry.limb : open.length === 1));
          if (match) {
            match.offAt = e.at;
            match.offEventId = e.id;
          } else {
            chart.tourniquets.push({ limb: entry.limb, offAt: e.at, offEventId: e.id });
          }
        }
        break;
      }
      case "allergy":
        chart.allergies.items.push(stamp(entry.substance));
        break;
      case "no_known_allergies":
        chart.allergies.noneKnown = stamp(true as const);
        break;
      case "patient_report":
        chart.reports.push(stamp(entry.text));
        break;
      case "mechanism":
        chart.mechanism.push(stamp(entry.text));
        break;
      case "time_found":
        chart.timeFound = stamp(entry.time);
        break;
      case "patient":
        // Later entries win field by field.
        if (entry.name !== undefined) chart.patient.name = entry.name;
        if (entry.age !== undefined) chart.patient.age = entry.age;
        if (entry.sex !== undefined) chart.patient.sex = entry.sex;
        break;
      case "survey":
        (chart.survey[entry.letter] ??= []).push(stamp(entry.finding));
        break;
      case "note":
        chart.notes.push(stamp(entry.text));
        break;
    }
  }
  chart.vitals.sort((a, b) => a.at.localeCompare(b.at));
  return chart;
}

/** Display-only elapsed minutes for a tourniquet. Computed from timestamps (HAZ-08). */
export function tourniquetMinutes(t: TourniquetRecord, now: Date): number | null {
  if (!t.onAt) return null;
  const end = t.offAt ? new Date(t.offAt) : now;
  return Math.max(0, Math.floor((end.getTime() - new Date(t.onAt).getTime()) / 60000));
}
