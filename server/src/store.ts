/**
 * Event store on Node's built-in SQLite. Pilot use is mock patients only.
 * Before real patients (Phase B) this moves to a host that signs a BAA,
 * with encryption at rest and the audit log kept there.
 */
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

// Loaded with require so bundlers and test runners keep the "node:" prefix.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
import type { ChartEvent } from "@pinpoint/core";

export interface AuditRow {
  at: string;
  actor: string;
  action: string;
  chartId: string | null;
  detail: string;
}

export class Store {
  private db: DatabaseSyncType;

  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS events (
        chart_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        id TEXT NOT NULL UNIQUE,
        device_id TEXT NOT NULL,
        body TEXT NOT NULL,
        received_at TEXT NOT NULL,
        PRIMARY KEY (chart_id, seq)
      );
      CREATE TABLE IF NOT EXISTS audit (
        at TEXT NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        chart_id TEXT,
        detail TEXT NOT NULL
      );
    `);
  }

  events(chartId: string): ChartEvent[] {
    const rows = this.db.prepare("SELECT body FROM events WHERE chart_id = ? ORDER BY seq").all(chartId) as { body: string }[];
    return rows.map((r) => JSON.parse(r.body) as ChartEvent);
  }

  byId(id: string): { chartId: string; seq: number; body: string } | undefined {
    const r = this.db.prepare("SELECT chart_id, seq, body FROM events WHERE id = ?").get(id) as { chart_id: string; seq: number; body: string } | undefined;
    return r ? { chartId: r.chart_id, seq: r.seq, body: r.body } : undefined;
  }

  bySeq(chartId: string, seq: number): { id: string } | undefined {
    return this.db.prepare("SELECT id FROM events WHERE chart_id = ? AND seq = ?").get(chartId, seq) as { id: string } | undefined;
  }

  chartIds(): string[] {
    return (this.db.prepare("SELECT DISTINCT chart_id FROM events").all() as { chart_id: string }[]).map((r) => r.chart_id);
  }

  /** Writes events atomically; `check` runs inside the transaction and may throw to roll back. */
  insertAll(events: ChartEvent[], receivedAt: string, check: () => void): void {
    const insert = this.db.prepare("INSERT INTO events (chart_id, seq, id, device_id, body, received_at) VALUES (?, ?, ?, ?, ?, ?)");
    this.db.exec("BEGIN");
    try {
      for (const e of events) insert.run(e.chartId, e.seq, e.id, e.deviceId, JSON.stringify(e), receivedAt);
      check();
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  audit(row: AuditRow): void {
    this.db.prepare("INSERT INTO audit (at, actor, action, chart_id, detail) VALUES (?, ?, ?, ?, ?)").run(row.at, row.actor, row.action, row.chartId, row.detail);
  }

  auditRows(): AuditRow[] {
    return this.db.prepare("SELECT at, actor, action, chart_id as chartId, detail FROM audit ORDER BY rowid").all() as unknown as AuditRow[];
  }

  close(): void {
    this.db.close();
  }
}
