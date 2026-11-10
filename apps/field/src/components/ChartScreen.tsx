import "../views.css";
import { useEffect, useState } from "react";
import {
  SAY_IT_LIKE_THIS,
  completenessFlags,
  extract,
  hhmm,
  projectChart,
  tourniquetMinutes,
  type ChartLog,
  type Entry,
  type Proposal,
  type Stamped,
} from "@pinpoint/core";
import { describeEntry, minutesSince } from "../logic";
import { Cards } from "./Cards";
import { FixSheet } from "./FixSheet";
import { VoiceButton } from "./VoiceButton";
import { TranscriptView } from "./TranscriptView";
import { ScribeReview } from "./ScribeReview";
import { FormPanel } from "./FormPanel";

type Tab = "record" | "form" | "transcript" | "review";
const TABS: { id: Tab; label: string }[] = [
  { id: "record", label: "Record" },
  { id: "form", label: "Form" },
  { id: "transcript", label: "Transcript" },
  { id: "review", label: "Review" },
];

type Sheet =
  | { mode: "add" }
  | { mode: "fixCard"; card: Proposal }
  | { mode: "correct"; target: Stamped<Entry> };

export function ChartScreen(props: {
  log: ChartLog;
  commit: (fn: (log: ChartLog) => unknown) => Promise<void>;
  onHandoff: () => void;
  onBack: () => void;
}) {
  const { log, commit } = props;
  const chart = projectChart(log.events);
  const [cards, setCards] = useState<Proposal[]>([]);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("record");
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);

  const closed = chart.status === "closed";
  const lastVitals = chart.vitals[chart.vitals.length - 1]?.at;
  const sinceVitals = minutesSince(lastVitals, now);
  const tqOn = chart.tourniquets.filter((t) => t.onAt && !t.offAt);
  const flags = completenessFlags(chart);

  const openCard = (id: string) => {
    document.getElementById(`card-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const correctById = (eventId: string) => {
    const target = chart.entries.find((e) => e.eventId === eventId);
    if (target) setSheet({ mode: "correct", target });
  };
  const toCheck = cards.length + chart.transcript.filter((t) => t.entryIds.length === 0 && !cards.some((c) => c.utteranceId === t.eventId)).length;

  const accept = async (accepted: Proposal[]) => {
    await commit((l) => accepted.map((p) => l.confirmProposal(p)));
    const ids = new Set(accepted.map((p) => p.id));
    setCards((cs) => cs.filter((c) => !ids.has(c.id)));
  };

  return (
    <div className="screen">
      <header className="bar">
        <button type="button" className="btn ghost" onClick={props.onBack}>Charts</button>
        <div className="bar-title">
          <strong>Chart {chart.id.slice(0, 6).toUpperCase()}</strong>
          <span className="muted small">Opened {hhmm(chart.openedAt)}{closed ? ` · closed ${hhmm(chart.closedAt!)}` : ""}</span>
        </div>
        <button type="button" className="btn" onClick={props.onHandoff}>Handoff</button>
      </header>

      <section className="timers" aria-label="Timers">
        {tqOn.map((t, i) => (
          <div key={t.onEventId ?? i} className="timer tq">
            <span>Tourniquet {t.limb ?? "limb not said"}</span>
            <strong>{tourniquetMinutes(t, now)} min</strong>
            <span className="muted small">on {hhmm(t.onAt!)}</span>
          </div>
        ))}
        <div className={`timer${sinceVitals !== null && sinceVitals >= 15 ? " due" : ""}`}>
          <span>Since last vitals</span>
          <strong>{sinceVitals === null ? "none yet" : `${sinceVitals} min`}</strong>
        </div>
      </section>

      {!closed && (
        <>
          <VoiceButton
            onUtterance={async (u) => {
              // The transcript line is saved first; cards point back to it.
              let utteranceId = "";
              await commit((l) => {
                const ev = l.recordUtterance(u);
                utteranceId = ev.id;
                return ev;
              });
              const found = extract(u.text, new Date(u.startedAt)).proposals.map((p) => ({ ...p, utteranceId }));
              setCards((cs) => [...cs, ...found]);
            }}
          />
          <Cards
            cards={cards}
            onAccept={accept}
            onDiscard={(id) => setCards((cs) => cs.filter((c) => c.id !== id))}
            onFix={(card) => setSheet({ mode: "fixCard", card })}
            onUpdate={(card) => setCards((cs) => cs.map((c) => (c.id === card.id ? card : c)))}
          />
          {cards.length === 0 && chart.entries.length === 0 && (
            <details className="hint">
              <summary>Say it like this</summary>
              <ul>{SAY_IT_LIKE_THIS.map((s) => <li key={s}>“{s}”</li>)}</ul>
            </details>
          )}
          <button type="button" className="btn wide" onClick={() => setSheet({ mode: "add" })}>Add by tapping</button>
        </>
      )}

      <nav className="tabs" role="tablist" aria-label="Chart views">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`tab${tab === t.id ? " on" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === "transcript" && chart.transcript.length > 0 && <span className="tab-count">{chart.transcript.length}</span>}
            {t.id === "review" && toCheck > 0 && <span className="tab-count attn">{toCheck}</span>}
          </button>
        ))}
      </nav>

      {tab === "form" && <FormPanel chart={chart} cards={cards} />}
      {tab === "transcript" && <TranscriptView chart={chart} cards={cards} onOpenCard={openCard} />}
      {tab === "review" && <ScribeReview chart={chart} cards={cards} closed={closed} onOpenCard={openCard} onCorrect={correctById} />}
      {tab === "record" && (
        <>
        <section aria-label="Chart record">
          <h2>Record</h2>
          {chart.entries.length === 0 && <p className="muted">Nothing charted yet.</p>}
          <ul className="record">
            {[...chart.entries].reverse().map((s) => {
              const d = describeEntry(s.value);
              return (
                <li key={s.eventId}>
                  <span className="rec-time">{hhmm(s.at)}</span>
                  <span className="rec-body">
                    <span className="rec-label">{d.label}</span> {d.value}
                    {s.quote && <span className="quote small"> “{s.quote}”</span>}
                    <span className="muted small"> · {s.source === "voice" ? "voice, confirmed" : "tapped"}</span>
                  </span>
                  {!closed && (
                    removing === s.eventId ? (
                      <span className="row">
                        <button type="button" className="btn danger" onClick={async () => { await commit((l) => l.voidEntry(s.eventId)); setRemoving(null); }}>Remove</button>
                        <button type="button" className="btn ghost" onClick={() => setRemoving(null)}>Keep</button>
                      </span>
                    ) : (
                      <span className="row">
                        <button type="button" className="btn small-btn" onClick={() => setSheet({ mode: "correct", target: s })}>Correct</button>
                        <button type="button" className="btn ghost small-btn" onClick={() => setRemoving(s.eventId)}>Remove</button>
                      </span>
                    )
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-label="Review">
          <h2>Before you close</h2>
          {flags.length === 0 ? <p className="muted">No gaps found by the three checks.</p> : flags.map((f) => <p key={f.code} className="warn">{f.message}</p>)}
          {!closed &&
            (confirmClose ? (
              <div className="confirm">
                <p>Close this chart? You can still view and hand it off, but not add to it.</p>
                <div className="row">
                  <button type="button" className="btn danger" onClick={async () => { await commit((l) => l.close()); setConfirmClose(false); }}>Close chart</button>
                  <button type="button" className="btn ghost" onClick={() => setConfirmClose(false)}>Not yet</button>
                </div>
              </div>
            ) : (
              <button type="button" className="btn wide" onClick={() => setConfirmClose(true)}>Close chart</button>
            ))}
        </section>
        </>
      )}

      {sheet && (
        <FixSheet
          title={sheet.mode === "add" ? "Add an entry" : sheet.mode === "fixCard" ? `Fix: ${describeEntry(sheet.card.entry).label}` : `Correct: ${describeEntry(sheet.target.value).label}`}
          initial={sheet.mode === "fixCard" ? sheet.card.entry : sheet.mode === "correct" ? sheet.target.value : undefined}
          onCancel={() => setSheet(null)}
          onSave={async (entry) => {
            if (sheet.mode === "add") await commit((l) => l.addTapEntry(entry));
            else if (sheet.mode === "correct") await commit((l) => l.correct(sheet.target.eventId, entry, sheet.target.at));
            else {
              // A fixed card is a tap entry at the card's time; the voice card is dropped.
              const card = sheet.card;
              await commit((l) => l.addTapEntry(entry, card.at));
              setCards((cs) => cs.filter((c) => c.id !== card.id));
            }
            setSheet(null);
          }}
        />
      )}
    </div>
  );
}
