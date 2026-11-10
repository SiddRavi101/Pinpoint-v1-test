import { useState } from "react";
import { hhmm, projectChart, retentionState, type ChartLog } from "@pinpoint/core";
import { PILOT, buildExpired } from "../config";

export function Home(props: {
  logs: ChartLog[];
  onOpen: (id: string) => void;
  onNew: () => void;
  onSync: () => Promise<string>;
  onSettings: () => void;
  onReceive: () => void;
  onForms: () => void;
}) {
  const [syncMsg, setSyncMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const now = new Date();
  const expired = buildExpired(now);
  const charts = props.logs
    .map((l) => ({ chart: projectChart(l.events), ret: retentionState(l.events, now) }))
    .sort((a, b) => b.chart.openedAt.localeCompare(a.chart.openedAt));
  const warn = charts.filter((c) => c.ret.state === "warn_unsynced");

  return (
    <div className="screen">
      <header className="bar">
        <div className="bar-title"><strong>Pinpoint</strong><span className="muted small">{PILOT ? "Pilot build · mock patients only" : "In development"}</span></div>
        <button type="button" className="btn ghost" onClick={props.onSettings}>Settings</button>
      </header>
      {warn.length > 0 && <p className="warn">{warn.length} chart{warn.length > 1 ? "s have" : " has"} not synced for over 24 hours. Sync when you have signal.</p>}
      {expired ? (
        <p className="warn">This test build has expired. Install the new build to open charts.</p>
      ) : (
        <button type="button" className="btn primary big wide" onClick={props.onNew}>New {PILOT ? "training " : ""}chart</button>
      )}
      <div className="row">
        <button type="button" className="btn wide" onClick={props.onReceive}>Receive handoff</button>
        <button type="button" className="btn wide" onClick={props.onForms}>Paper forms</button>
      </div>
      <section aria-label="Charts on this phone">
        <h2>On this phone</h2>
        {charts.length === 0 && <p className="muted">No charts. Charts delete themselves 12 hours after the server confirms them.</p>}
        <ul className="chart-list">
          {charts.map(({ chart, ret }) => (
            <li key={chart.id}>
              <button type="button" className="chart-row" onClick={() => props.onOpen(chart.id)}>
                <span><strong>{chart.id.slice(0, 6).toUpperCase()}</strong> {chart.training && <span className="tag">TRAINING</span>}</span>
                <span className="muted small">
                  {hhmm(chart.openedAt)} · {chart.status === "open" ? "open" : "closed"} ·{" "}
                  {ret.state === "deletable" || (ret.state === "keep" && ret.deleteAfter) ? "synced" : chart.syncedEventCount > 0 ? "partly synced" : "not synced"}
                  {ret.state === "keep" && ret.deleteAfter ? ` · deletes after ${hhmm(ret.deleteAfter)}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <button
        type="button"
        className="btn wide"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setSyncMsg(await props.onSync());
          setBusy(false);
        }}
      >
        {busy ? "Syncing…" : "Sync now"}
      </button>
      {syncMsg && <p className="muted" role="status">{syncMsg}</p>}
    </div>
  );
}
