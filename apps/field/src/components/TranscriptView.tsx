import type { Chart, Entry, Proposal, Stamped } from "@pinpoint/core";
import { describeEntry, hhmmss, segmentClock } from "../logic";

/**
 * Everything the speech engine heard, in order, with clock times. Under
 * each line: the chart entries confirmed from it, cards still waiting, and
 * entries later removed. The transcript is not the record; the record is
 * what was confirmed.
 */
export function TranscriptView({ chart, cards, onOpenCard }: { chart: Chart; cards: Proposal[]; onOpenCard?: (id: string) => void }) {
  if (chart.transcript.length === 0) {
    return <p className="muted">Nothing heard yet. Hold the talk button and speak; each utterance appears here with its time.</p>;
  }
  const byId = new Map<string, Stamped<Entry>>(chart.entries.map((e) => [e.eventId, e]));
  return (
    <ol className="transcript" aria-label="Transcript">
      {chart.transcript.map((line) => {
        const waiting = cards.filter((c) => c.utteranceId === line.eventId);
        const confirmed = line.entryIds.map((id) => byId.get(id)).filter((e): e is Stamped<Entry> => !!e);
        const secs = Math.max(0, Math.round((new Date(line.endedAt).getTime() - new Date(line.startedAt).getTime()) / 1000));
        const segments = line.segments.length > 1 ? line.segments : [];
        return (
          <li key={line.eventId} className="tx-line">
            <div className="tx-head">
              <time className="tx-time" dateTime={line.startedAt}>{hhmmss(line.startedAt)}</time>
              <span className="muted small">{secs > 0 ? `${secs} s · ` : ""}{engineLabel(line.engine)}</span>
            </div>
            {segments.length ? (
              <p className="tx-text">
                {segments.map((s, i) => (
                  <span key={i} className="tx-seg">
                    <time className="tx-seg-time">{segmentClock(line.startedAt, s.start)}</time> {s.text.trim()}{" "}
                  </span>
                ))}
              </p>
            ) : (
              <p className="tx-text">{line.text}</p>
            )}
            {(confirmed.length > 0 || waiting.length > 0 || line.voidedEntryIds.length > 0) && (
              <ul className="tx-chips">
                {confirmed.map((e) => {
                  const d = describeEntry(e.value);
                  return <li key={e.eventId} className="chip ok">✓ {d.label} {d.value}</li>;
                })}
                {waiting.map((c) => {
                  const d = describeEntry(c.entry);
                  return (
                    <li key={c.id} className="chip wait">
                      <button type="button" onClick={() => onOpenCard?.(c.id)}>Waiting: {d.label} {d.value}</button>
                    </li>
                  );
                })}
                {line.voidedEntryIds.length > 0 && <li className="chip gone">{line.voidedEntryIds.length} removed</li>}
              </ul>
            )}
            {confirmed.length === 0 && waiting.length === 0 && <p className="muted small">Nothing charted from this.</p>}
          </li>
        );
      })}
    </ol>
  );
}

function engineLabel(engine: string): string {
  if (engine.startsWith("whisper")) return "on-device Whisper";
  if (engine === "phone-on-device") return "phone speech engine";
  if (engine === "typed") return "typed";
  return engine;
}
