import { completenessFlags, hhmm, type Chart, type Proposal } from "@pinpoint/core";
import { describeEntry, hhmmss, reviewItems, type ReviewItem } from "../logic";

const HEADINGS: Record<ReviewItem["reason"], string> = {
  card_needs_look: "Cards that need a look",
  drug_unmatched: "Drug names not matched",
  card_waiting: "Cards waiting for a tap",
  med_incomplete: "Medications missing a detail",
  tourniquet_no_limb: "Tourniquets missing a limb",
  heard_not_charted: "Heard but not charted",
};

/**
 * One place for the scribe to check the whole chart: what still needs a
 * tap, documentation gaps, words that never became an entry, and every
 * entry with its time, source and the words it came from.
 */
export function ScribeReview(props: {
  chart: Chart;
  cards: Proposal[];
  closed: boolean;
  onOpenCard: (id: string) => void;
  onCorrect: (eventId: string) => void;
}) {
  const { chart, cards } = props;
  const items = reviewItems(chart, cards);
  const flags = completenessFlags(chart);
  const groups = new Map<ReviewItem["reason"], ReviewItem[]>();
  for (const i of items) (groups.get(i.reason) ?? groups.set(i.reason, []).get(i.reason)!).push(i);
  const voice = chart.entries.filter((e) => e.source === "voice").length;

  return (
    <div className="review stack">
      <div className="review-sum">
        <div><strong>{chart.entries.length}</strong><span className="muted small">entries</span></div>
        <div><strong>{voice}</strong><span className="muted small">from voice</span></div>
        <div><strong>{chart.transcript.length}</strong><span className="muted small">utterances</span></div>
        <div className={items.length ? "attn" : ""}><strong>{items.length}</strong><span className="muted small">to check</span></div>
      </div>

      {flags.length > 0 && (
        <section>
          <h2>Completeness checks</h2>
          {flags.map((f) => <p key={f.code} className="warn">{f.message}</p>)}
        </section>
      )}

      {items.length === 0 && flags.length === 0 && <p className="muted">Nothing waiting and no gaps found by the checks. Read through the entries below before handoff.</p>}

      {[...groups].map(([reason, list]) => (
        <section key={reason}>
          <h2>{HEADINGS[reason]} ({list.length})</h2>
          <ul className="review-list">
            {list.map((i, n) => (
              <li key={`${i.cardId ?? i.eventId ?? ""}-${n}`}>
                <span className="rec-time">{hhmm(i.at)}</span>
                <span className="rec-body">
                  {i.message}
                  {i.quote && <span className="quote small"> “{i.quote}”</span>}
                </span>
                {i.cardId && !props.closed && <button type="button" className="btn small-btn" onClick={() => props.onOpenCard(i.cardId!)}>Open card</button>}
                {i.eventId && i.reason !== "heard_not_charted" && !props.closed && <button type="button" className="btn small-btn" onClick={() => props.onCorrect(i.eventId!)}>Correct</button>}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section>
        <h2>Every entry ({chart.entries.length})</h2>
        {chart.entries.length === 0 && <p className="muted">Nothing charted yet.</p>}
        <table className="review-table">
          <thead>
            <tr><th>Time</th><th>Field</th><th>Value</th><th>Source</th></tr>
          </thead>
          <tbody>
            {chart.entries.map((e) => {
              const d = describeEntry(e.value);
              return (
                <tr key={e.eventId}>
                  <td className="num">{hhmmss(e.at)}</td>
                  <td>{d.label}</td>
                  <td>
                    {d.value}
                    {e.quote && <div className="quote small">“{e.quote}”</div>}
                  </td>
                  <td className="small">{e.source === "voice" ? "voice, confirmed" : "tapped"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
