import { useState } from "react";
import {
  PENDING_MEDICAL_REVIEW,
  VITAL_COLUMNS,
  fillForm,
  formatEntryValue,
  hhmm,
  type Chart,
  type FilledField,
  type FilledValue,
  type FormLayout,
  type Proposal,
  type VitalType,
  type VitalsTableRow,
} from "@pinpoint/core";
import "../forms.css";

/**
 * The chart drawn as the team's paper form, live. Confirmed values are in
 * ink with their time; cards still waiting for a tap are ghosted and are not
 * part of the record. Tap a value to see the words it came from.
 */
export function FormView({ chart, pending, layout, onFieldTap }: { chart: Chart; pending: Proposal[]; layout: FormLayout; onFieldTap?: (fieldId: string) => void }) {
  const filled = fillForm(layout, chart, pending);
  const [open, setOpen] = useState<string | null>(null);
  const unplaced = chart.entries.filter((e) => filled.unplacedEntryIds.includes(e.eventId));

  const value = (v: FilledValue, key: string) => {
    const id = `${key}:${v.eventId ?? v.cardId}`;
    const how = v.pending ? "card waiting for a tap" : v.source === "voice" ? "voice, confirmed" : v.source === "tap" ? "tapped" : v.source;
    return (
      <li key={id} className={`pf-value${v.pending ? " pending" : ""}`}>
        <button
          type="button"
          className="pf-value-btn"
          aria-expanded={open === id}
          title={v.quote ? `“${v.quote}”` : how}
          onClick={() => setOpen((o) => (o === id ? null : id))}
        >
          <span className="pf-text">{v.text}</span>
          <span className="pf-time">{hhmm(v.at)}</span>
          {v.pending && <span className="pf-tag">card waiting</span>}
        </button>
        {open === id && (
          <span className="pf-source small">
            {v.quote ? <>“{v.quote}” · </> : null}
            {how}
          </span>
        )}
      </li>
    );
  };

  const table = (key: string, timeLabel: string, columns: { key: VitalType; label: string }[], rows: VitalsTableRow[]) => (
    <div className="pf-table-wrap" key={key}>
      <table className="pf-table">
        <thead>
          <tr>
            <th scope="col">{timeLabel}</th>
            {columns.map((c) => <th key={c.key} scope="col">{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <th scope="row">&nbsp;</th>
              {columns.map((c) => <td key={c.key} />)}
            </tr>
          )}
          {rows.map((r, i) => (
            <tr key={`${r.at}-${i}`} className={r.pending ? "pending" : undefined}>
              <th scope="row">{hhmm(r.at)}</th>
              {columns.map((c) => {
                const cell = r.cells[c.key];
                return (
                  <td key={c.key} className={cell?.pending ? "pending" : undefined} title={cell?.quote ? `“${cell.quote}”` : undefined}>
                    {cell?.text ?? ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.some((r) => r.pending) && <p className="pf-caption small">Italic rows are cards waiting for a tap, not yet in the record.</p>}
    </div>
  );

  const field = (f: FilledField, sectionLabel: string) => {
    const body = f.unsupported ? (
      <p className="pf-empty small">Pinpoint doesn't capture this field yet</p>
    ) : f.table ? (
      table(f.id, "Time", VITAL_COLUMNS, f.table)
    ) : f.values.length === 0 ? (
      <p className="pf-line" aria-label="empty" />
    ) : (
      <ul className="pf-values">{f.values.map((v) => value(v, f.id))}</ul>
    );
    return (
      <div key={f.id} className={`pf-field${f.unsupported ? " unsupported" : ""}${f.table ? " wide" : ""}`}>
        {onFieldTap ? (
          <button type="button" className="pf-label pf-label-btn" onClick={() => onFieldTap(f.id)}>{f.label}</button>
        ) : f.label.trim().toLowerCase() === sectionLabel.trim().toLowerCase() ? null : (
          <span className="pf-label">{f.label}</span>
        )}
        {body}
      </div>
    );
  };

  return (
    <article className="paper-form" aria-label={`${filled.name} form`}>
      <header className="pf-head">
        <strong>{filled.name}</strong>
        {filled.reviewStatus === PENDING_MEDICAL_REVIEW && <span className="pf-badge">{PENDING_MEDICAL_REVIEW}</span>}
        <span className="muted small">
          {filled.counts.confirmed} charted · {filled.counts.pending} waiting · {filled.counts.empty} blank
        </span>
      </header>
      <div className="pf-sections">
        {filled.sections.map((s) => (
          <section key={s.id} className="pf-section" aria-label={s.label}>
            <h3>{s.label}</h3>
            {s.vitalsGrid && table(`${s.id}-grid`, s.vitalsGrid.timeLabel, s.vitalsGrid.columns.map((c) => ({ key: c.type, label: c.label })), s.vitalsGrid.rows)}
            {s.fields.length > 0 && <div className="pf-fields">{s.fields.map((f) => field(f, s.label))}</div>}
          </section>
        ))}
      </div>
      {unplaced.length > 0 && (
        <section className="pf-section pf-unplaced" aria-label="Not on this form">
          <h3>Charted, but no place on this form</h3>
          <ul className="pf-values">
            {unplaced.map((e) => (
              <li key={e.eventId} className="pf-value">
                <span className="pf-value-btn">
                  <span className="pf-text">{formatEntryValue(e.value, true)}</span>
                  <span className="pf-time">{hhmm(e.at)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
