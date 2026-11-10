/**
 * Append-only event log for one chart. The chart is always computed from
 * these events (see chart.ts); nothing edits an event after it is written.
 */
import { SCHEMA_VERSION, MIN_SCHEMA_VERSION, type ChartEvent, type Entry, type EventSource, type Proposal, type Utterance } from "./types.js";
import { defaultEnv, type Env } from "./env.js";
import { TEMPLATE_VERSION } from "./template.js";

export class LogError extends Error {}

type NewEvent = Pick<ChartEvent, "kind" | "payload"> & {
  source: EventSource;
  confirmed: boolean;
  at?: string;
  ruleVersion?: string | null;
};

export class ChartLog {
  readonly chartId: string;
  readonly deviceId: string;
  private readonly env: Env;
  private readonly list: ChartEvent[] = [];

  private constructor(chartId: string, deviceId: string, env: Env) {
    this.chartId = chartId;
    this.deviceId = deviceId;
    this.env = env;
  }

  /** Start a new chart. */
  static open(opts: { deviceId: string; training: boolean; env?: Env }): ChartLog {
    const env = opts.env ?? defaultEnv;
    const log = new ChartLog(env.newId(), opts.deviceId, env);
    log.append({ kind: "chart_opened", payload: { training: opts.training }, source: "tap", confirmed: true });
    return log;
  }

  /** Rebuild from stored events, checking every invariant on the way. */
  static fromEvents(events: readonly ChartEvent[], env: Env = defaultEnv): ChartLog {
    const first = events[0];
    if (!first || first.kind !== "chart_opened") throw new LogError("A chart must start with chart_opened");
    const log = new ChartLog(first.chartId, first.deviceId, env);
    for (const e of events) log.check(e), log.list.push(Object.freeze(structuredClone(e)) as ChartEvent);
    return log;
  }

  get events(): readonly ChartEvent[] {
    return this.list;
  }

  get isClosed(): boolean {
    return this.list.some((e) => e.kind === "chart_closed");
  }

  /**
   * Record what was heard, for the transcript. This never creates a chart
   * entry: entries still need a tap on a card (confirmProposal).
   */
  recordUtterance(u: Utterance): ChartEvent {
    return this.append({ kind: "utterance", payload: u, source: "voice", confirmed: false, at: u.startedAt });
  }

  /** Record a confirmed voice card. The only way voice reaches the chart. */
  confirmProposal(p: Proposal): ChartEvent {
    return this.append({
      kind: "entry",
      payload: { entry: p.entry, quote: p.quote, ...(p.utteranceId ? { utteranceId: p.utteranceId } : {}) },
      source: "voice",
      confirmed: true,
      at: p.at,
      ruleVersion: p.ruleVersion,
    });
  }

  /** Record an entry typed or picked on the fix screen. */
  addTapEntry(entry: Entry, at?: string): ChartEvent {
    return this.append({ kind: "entry", payload: { entry }, source: "tap", confirmed: true, at });
  }

  /** Replace an entry: void the old one, then append the corrected one. */
  correct(targetId: string, entry: Entry, at?: string): ChartEvent {
    const target = this.list.find((e) => e.id === targetId);
    this.append({ kind: "entry_voided", payload: { targetId, reason: "corrected" }, source: "tap", confirmed: true });
    return this.append({ kind: "entry", payload: { entry }, source: "tap", confirmed: true, at: at ?? target?.at });
  }

  voidEntry(targetId: string): ChartEvent {
    return this.append({ kind: "entry_voided", payload: { targetId, reason: "entered_in_error" }, source: "tap", confirmed: true });
  }

  close(): ChartEvent {
    return this.append({ kind: "chart_closed", payload: {}, source: "tap", confirmed: true });
  }

  /** Called by the sync client with the server's receipt. */
  recordSyncConfirmed(receipt: { receiptId: string; serverEventCount: number; confirmedAt: string }): ChartEvent {
    return this.append({ kind: "sync_confirmed", payload: receipt, source: "system", confirmed: true });
  }

  private append(e: NewEvent): ChartEvent {
    const now = this.env.now().toISOString();
    const event = {
      id: this.env.newId(),
      chartId: this.chartId,
      seq: this.list.length + 1,
      at: e.at ?? now,
      loggedAt: now,
      source: e.source,
      confirmed: e.confirmed,
      templateVersion: TEMPLATE_VERSION,
      ruleVersion: e.ruleVersion ?? null,
      deviceId: this.deviceId,
      schemaVersion: SCHEMA_VERSION,
      kind: e.kind,
      payload: e.payload,
    } as ChartEvent;
    this.check(event);
    const frozen = Object.freeze(structuredClone(event)) as ChartEvent;
    this.list.push(frozen);
    return frozen;
  }

  private check(e: ChartEvent): void {
    if (e.chartId !== this.chartId) throw new LogError("Event belongs to another chart");
    if (e.seq !== this.list.length + 1) throw new LogError(`Expected seq ${this.list.length + 1}, got ${e.seq}`);
    if (this.list.length === 0 && e.kind !== "chart_opened") throw new LogError("First event must be chart_opened");
    if (this.list.length > 0 && e.kind === "chart_opened") throw new LogError("Chart already opened");
    if (this.list.some((x) => x.id === e.id)) throw new LogError("Duplicate event id");
    const closed = this.isClosed;
    if (closed && e.kind !== "sync_confirmed") throw new LogError("Chart is closed; only sync receipts can be added");
    if (e.kind === "entry" && !e.confirmed) throw new LogError("Entries need a confirming tap");
    if (e.kind === "entry" && e.source === "guidance") throw new LogError("Guidance events are not allowed in Track 1");
    if (e.kind === "entry_voided") {
      const target = this.list.find((x) => x.id === e.payload.targetId);
      if (!target || target.kind !== "entry") throw new LogError("Can only void an entry");
      if (this.list.some((x) => x.kind === "entry_voided" && x.payload.targetId === e.payload.targetId)) throw new LogError("Entry already voided");
    }
    if (e.schemaVersion < MIN_SCHEMA_VERSION || e.schemaVersion > SCHEMA_VERSION) throw new LogError(`Unknown schema version ${e.schemaVersion}`);
    if (e.kind === "utterance") {
      if (e.source !== "voice" || e.confirmed) throw new LogError("An utterance is voice and never a confirmed entry");
      if (e.payload.text.length > 4000) throw new LogError("Utterance too long");
    }
    if (e.kind === "entry" && e.payload.utteranceId !== undefined) {
      const u = this.list.find((x) => x.id === e.payload.utteranceId);
      if (!u || u.kind !== "utterance") throw new LogError("Entry points to a missing utterance");
    }
    if (e.kind === "sync_confirmed" && e.payload.serverEventCount > this.list.length) {
      throw new LogError("Server confirmed more events than exist");
    }
  }
}
