/**
 * The protected store: the only place patient data lives on the phone.
 * Never use localStorage, the clipboard, URLs or logs for chart data.
 *
 * - Native: SQLite encrypted with SQLCipher (@capacitor-community/sqlite).
 *   The passphrase is generated once and kept in the Keychain/Keystore by
 *   the plugin. This is the default pending the week-0 check of WebView
 *   storage protection (docs/decisions/0004-storage.md).
 * - Browser preview: in-memory only, so nothing persists on dev machines.
 */
import { Capacitor } from "@capacitor/core";
import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from "@capacitor-community/sqlite";
import type { ChartEvent } from "@pinpoint/core";

export interface ChartStore {
  init(): Promise<void>;
  allEvents(): Promise<ChartEvent[]>;
  append(e: ChartEvent): Promise<void>;
  deleteChart(chartId: string): Promise<void>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
}

const DB = "pinpoint";

class EncryptedSqliteStore implements ChartStore {
  private sqlite = new SQLiteConnection(CapacitorSQLite);
  private db?: SQLiteDBConnection;

  async init() {
    const stored = await this.sqlite.isSecretStored();
    if (!stored.result) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      await this.sqlite.setEncryptionSecret(Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""));
    }
    const consistent = (await this.sqlite.checkConnectionsConsistency()).result;
    const exists = (await this.sqlite.isConnection(DB, false)).result;
    this.db = consistent && exists ? await this.sqlite.retrieveConnection(DB, false) : await this.sqlite.createConnection(DB, true, "secret", 1, false);
    await this.db.open();
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY NOT NULL, chart_id TEXT NOT NULL, seq INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS events_chart_seq ON events (chart_id, seq);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
    `);
  }

  private get conn(): SQLiteDBConnection {
    if (!this.db) throw new Error("Store not initialized");
    return this.db;
  }

  async allEvents() {
    const r = await this.conn.query("SELECT body FROM events ORDER BY chart_id, seq");
    return (r.values ?? []).map((row: { body: string }) => JSON.parse(row.body) as ChartEvent);
  }

  async append(e: ChartEvent) {
    await this.conn.run("INSERT INTO events (id, chart_id, seq, body) VALUES (?, ?, ?, ?)", [e.id, e.chartId, e.seq, JSON.stringify(e)]);
  }

  async deleteChart(chartId: string) {
    await this.conn.run("DELETE FROM events WHERE chart_id = ?", [chartId]);
    await this.conn.execute("VACUUM;", false);
  }

  async getSetting(key: string) {
    const r = await this.conn.query("SELECT value FROM settings WHERE key = ?", [key]);
    return (r.values?.[0] as { value?: string } | undefined)?.value ?? null;
  }

  async setSetting(key: string, value: string) {
    await this.conn.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, value]);
  }
}

export class MemoryStore implements ChartStore {
  private events: ChartEvent[] = [];
  private settings = new Map<string, string>();
  async init() {}
  async allEvents() {
    return [...this.events];
  }
  async append(e: ChartEvent) {
    if (this.events.some((x) => x.id === e.id)) throw new Error("duplicate event");
    this.events.push(e);
  }
  async deleteChart(chartId: string) {
    this.events = this.events.filter((e) => e.chartId !== chartId);
  }
  async getSetting(key: string) {
    return this.settings.get(key) ?? null;
  }
  async setSetting(key: string, value: string) {
    this.settings.set(key, value);
  }
}

export const store: ChartStore = Capacitor.isNativePlatform() ? new EncryptedSqliteStore() : new MemoryStore();
