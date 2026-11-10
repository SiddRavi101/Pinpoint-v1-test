import { useState } from "react";
import { projectChart, type ChartLog } from "@pinpoint/core";
import { HandoffScreen } from "./HandoffScreen";
import { TranscriptView } from "./TranscriptView";
import { ScribeReview } from "./ScribeReview";
import "../views.css";

type Tab = "handoff" | "entries" | "transcript";

/**
 * A chart received from another phone by QR. Read-only, and held in memory
 * only: it is not saved, synced or added to, and it is gone when the app
 * closes. The sending phone keeps the original and syncs it.
 */
export function ReceivedChart({ log, onBack }: { log: ChartLog; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>("handoff");
  const chart = projectChart(log.events);
  return (
    <div>
      <div className="screen received-head">
        <p className="warn">
          Received from another phone ({chart.id.slice(0, 6).toUpperCase()}). Read-only and not saved on this phone: it is gone when the app closes. The sending phone keeps and syncs the original.
        </p>
        <nav className="tabs three" role="tablist" aria-label="Received chart views">
          {(["handoff", "entries", "transcript"] as Tab[]).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={`tab${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>
              {t === "handoff" ? "Handoff" : t === "entries" ? "Entries" : "Transcript"}
            </button>
          ))}
        </nav>
      </div>
      {tab === "handoff" && <HandoffScreen log={log} onBack={onBack} />}
      {tab !== "handoff" && (
        <div className="screen">
          <button type="button" className="btn ghost" onClick={onBack}>Back</button>
          {tab === "entries" && <ScribeReview chart={chart} cards={[]} closed onOpenCard={() => {}} onCorrect={() => {}} />}
          {tab === "transcript" && <TranscriptView chart={chart} cards={[]} />}
        </div>
      )}
    </div>
  );
}
