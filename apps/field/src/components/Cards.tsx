import type { Proposal } from "@pinpoint/core";
import { hhmm } from "@pinpoint/core";
import { describeEntry, pickDrug, splitForAcceptAll } from "../logic";

/**
 * Voice results as large cards. Nothing enters the chart without a tap.
 * Each card shows the words it came from.
 */
export function Cards(props: {
  cards: Proposal[];
  onAccept: (cards: Proposal[]) => void;
  onDiscard: (id: string) => void;
  onFix: (card: Proposal) => void;
  onUpdate: (card: Proposal) => void;
}) {
  const { cards } = props;
  if (cards.length === 0) return null;
  const { accept } = splitForAcceptAll(cards);
  return (
    <section className="cards" aria-label="Cards to confirm">
      <div className="cards-head">
        <h2>Confirm {cards.length === 1 ? "this card" : `${cards.length} cards`}</h2>
        {accept.length > 0 && (
          <button type="button" className="btn primary big" onClick={() => props.onAccept(accept)}>
            Accept {accept.length === cards.length ? "all" : `${accept.length} clear`}
          </button>
        )}
      </div>
      {cards.map((c) => {
        const d = describeEntry(c.entry);
        return (
          <article key={c.id} className={`card${c.review.length ? " needs-look" : ""}`}>
            <div className="card-main">
              <span className="card-label">{d.label}</span>
              <span className="card-value">{d.value}</span>
              <span className="card-time">{hhmm(c.at)}</span>
            </div>
            <p className="quote">You said: “{c.quote}”</p>
            {c.review.map((r) => (
              <p key={r} className="warn">{r}</p>
            ))}
            {c.candidates && c.candidates.length > 0 && c.entry.type === "med" && c.entry.drug === null && (
              <div className="row wrap">
                {c.candidates.map((name) => (
                  <button key={name} type="button" className="btn" onClick={() => props.onUpdate(pickDrug(c, name))}>
                    {name}
                  </button>
                ))}
              </div>
            )}
            <div className="row">
              <button type="button" className="btn primary" onClick={() => props.onAccept([c])} disabled={c.entry.type === "med" && c.entry.drug === null}>
                Accept
              </button>
              <button type="button" className="btn" onClick={() => props.onFix(c)}>Fix</button>
              <button type="button" className="btn ghost" onClick={() => props.onDiscard(c.id)}>Discard</button>
            </div>
          </article>
        );
      })}
    </section>
  );
}
