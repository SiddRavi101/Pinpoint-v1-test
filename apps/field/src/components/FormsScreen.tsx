import { useEffect, useState } from "react";
import type { FormLayout } from "@pinpoint/core";
import { activeLayout, allLayouts, deleteLayout, saveLayout, setActiveLayout } from "../forms/layouts";
import { FormScanScreen } from "./FormScanScreen";

/**
 * Paper forms: pick which layout the Form view uses, or scan the team's
 * blank paper form to make one. Layouts change how the chart is shown,
 * not what is recorded. Scanned layouts stay PENDING MEDICAL REVIEW.
 */
export function FormsScreen({ onBack }: { onBack: () => void }) {
  const [layouts, setLayouts] = useState<FormLayout[]>([]);
  const [active, setActive] = useState("");
  const [scanning, setScanning] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const reload = async () => {
    setLayouts(await allLayouts());
    setActive((await activeLayout()).id);
  };
  useEffect(() => {
    void reload();
  }, []);

  if (scanning) {
    return (
      <FormScanScreen
        onCancel={() => setScanning(false)}
        onSave={async (layout) => {
          await saveLayout(layout);
          await setActiveLayout(layout.id);
          setScanning(false);
          await reload();
        }}
      />
    );
  }

  return (
    <div className="screen">
      <header className="bar">
        <button type="button" className="btn ghost" onClick={onBack}>Back</button>
        <div className="bar-title"><strong>Paper forms</strong></div>
      </header>
      <p className="muted">The Form view shows each chart laid out like your team's paper form. Scan a blank form to match it. Reading the photo happens on this phone; the photo is not kept.</p>
      <button type="button" className="btn primary big wide" onClick={() => setScanning(true)}>Scan a blank paper form</button>
      <ul className="chart-list">
        {layouts.map((l) => {
          const fields = l.sections.reduce((n, s) => n + s.fields.length, 0);
          return (
            <li key={l.id} className="form-row">
              <button type="button" className="chart-row" aria-pressed={active === l.id} onClick={async () => { await setActiveLayout(l.id); setActive(l.id); }}>
                <span><strong>{l.name}</strong> {active === l.id && <span className="tag">IN USE</span>}</span>
                <span className="muted small">{l.source === "builtin" ? "Built in" : "Scanned"} · {l.sections.length} sections · {fields} fields · {l.reviewStatus}</span>
              </button>
              {l.source !== "builtin" &&
                (removing === l.id ? (
                  <span className="row">
                    <button type="button" className="btn danger small-btn" onClick={async () => { await deleteLayout(l.id); setRemoving(null); await reload(); }}>Delete</button>
                    <button type="button" className="btn ghost small-btn" onClick={() => setRemoving(null)}>Keep</button>
                  </span>
                ) : (
                  <button type="button" className="btn ghost small-btn" onClick={() => setRemoving(l.id)}>Delete</button>
                ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
