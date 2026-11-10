import { useState } from "react";
import type { Entry, EntryType } from "@pinpoint/core";
import { SURVEY_LETTERS } from "@pinpoint/core";
import { ENTRY_LABELS, FORM_TYPES, LIMBS, ROUTES, UNITS, entryFromForm, type FormValues } from "../logic";

/** Tap charting: add or correct any field. Also the fallback when voice is off. */
export function FixSheet(props: {
  initialType?: EntryType;
  initial?: Entry;
  title: string;
  onSave: (entry: Entry) => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<EntryType>(props.initialType ?? props.initial?.type ?? "pulse");
  const [f, setF] = useState<FormValues>(() => toForm(props.initial));
  const [error, setError] = useState("");
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  const field = (k: string, label: string, opts: { inputMode?: "numeric" | "decimal" | "text"; placeholder?: string } = {}) => (
    <label className="field" htmlFor={`fix-${k}`}>
      <span>{label}</span>
      <input id={`fix-${k}`} value={f[k] ?? ""} onChange={set(k)} inputMode={opts.inputMode ?? "text"} placeholder={opts.placeholder} autoComplete="off" />
    </label>
  );
  const select = (k: string, label: string, options: string[], blank = true) => (
    <label className="field" htmlFor={`fix-${k}`}>
      <span>{label}</span>
      <select id={`fix-${k}`} value={f[k] ?? ""} onChange={set(k)}>
        {blank && <option value="">Not said</option>}
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="sheet" role="dialog" aria-label={props.title}>
      <form
        className="sheet-body"
        onSubmit={(e) => {
          e.preventDefault();
          const r = entryFromForm(type, f, new Date());
          if ("error" in r) setError(r.error);
          else props.onSave(r);
        }}
      >
        <h2>{props.title}</h2>
        {!props.initial && (
          <label className="field" htmlFor="fix-type">
            <span>Field</span>
            <select id="fix-type" value={type} onChange={(e) => { setType(e.target.value as EntryType); setError(""); }}>
              {FORM_TYPES.map((t) => (
                <option key={t} value={t}>{ENTRY_LABELS[t]}</option>
              ))}
            </select>
          </label>
        )}
        {(type === "pulse" || type === "resp" || type === "spo2") && field("value", ENTRY_LABELS[type], { inputMode: "numeric" })}
        {type === "bp" && (
          <div className="row">
            {field("systolic", "Systolic", { inputMode: "numeric" })}
            {field("diastolic", "Diastolic (blank if palpated)", { inputMode: "numeric" })}
          </div>
        )}
        {type === "gcs" && (
          <>
            {field("total", "GCS total", { inputMode: "numeric" })}
            <div className="row">
              {field("e", "E", { inputMode: "numeric" })}
              {field("v", "V", { inputMode: "numeric" })}
              {field("m", "M", { inputMode: "numeric" })}
            </div>
          </>
        )}
        {type === "tourniquet" && (
          <div className="row">
            {select("action", "On or off", ["on", "off"], false)}
            {select("limb", "Limb", LIMBS)}
          </div>
        )}
        {type === "med" && (
          <>
            {field("drug", "Drug")}
            <div className="row">
              {field("amount", "Dose", { inputMode: "decimal" })}
              {select("unit", "Unit", UNITS, false)}
              {select("route", "Route", ROUTES)}
            </div>
          </>
        )}
        {(type === "allergy" || type === "patient_report" || type === "mechanism" || type === "note") && field("text", ENTRY_LABELS[type])}
        {type === "time_found" && field("time", "Time found (HH:MM)", { inputMode: "numeric", placeholder: "14:20" })}
        {type === "patient" && (
          <>
            {field("name", "Name")}
            <div className="row">
              {field("age", "Age", { inputMode: "numeric" })}
              {select("sex", "Sex", ["female", "male"])}
            </div>
          </>
        )}
        {type === "survey" && (
          <>
            <label className="field" htmlFor="fix-letter">
              <span>Letter</span>
              <select id="fix-letter" value={f.letter ?? ""} onChange={set("letter")}>
                <option value="">Pick</option>
                {SURVEY_LETTERS.map((s) => (
                  <option key={s.letter} value={s.letter}>{s.label}</option>
                ))}
              </select>
            </label>
            {field("finding", "Finding, in your words")}
          </>
        )}
        {type === "no_known_allergies" && <p className="muted">Records “No known allergies”.</p>}
        {error && <p className="warn">{error}</p>}
        <div className="row">
          <button type="submit" className="btn primary big">Save</button>
          <button type="button" className="btn ghost" onClick={props.onCancel}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

function toForm(e?: Entry): FormValues {
  if (!e) return { action: "on", unit: "mg" };
  switch (e.type) {
    case "pulse":
      return { value: String(e.bpm) };
    case "resp":
      return { value: String(e.rate) };
    case "spo2":
      return { value: String(e.percent) };
    case "bp":
      return { systolic: String(e.systolic), diastolic: e.diastolic === null ? "" : String(e.diastolic) };
    case "gcs":
      return { total: String(e.total), e: e.e?.toString() ?? "", v: e.v?.toString() ?? "", m: e.m?.toString() ?? "" };
    case "tourniquet":
      return { action: e.action, limb: e.limb ?? "" };
    case "med":
      return { drug: e.drug ?? e.spoken, amount: e.dose ? String(e.dose.amount) : "", unit: e.dose?.unit ?? "mg", route: e.route ?? "" };
    case "allergy":
      return { text: e.substance };
    case "patient_report":
    case "mechanism":
    case "note":
      return { text: e.text };
    case "time_found": {
      const d = new Date(e.time);
      return { time: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` };
    }
    case "patient":
      return { name: e.name ?? "", age: e.age?.toString() ?? "", sex: e.sex ?? "" };
    case "survey":
      return { letter: e.letter, finding: e.finding };
    default:
      return {};
  }
}
