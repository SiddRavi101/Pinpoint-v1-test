import { useEffect, useRef, useState } from "react";
import {
  BINDING_OPTIONS,
  PENDING_MEDICAL_REVIEW,
  bindingFromKey,
  bindingKey,
  layoutFromOcrLines,
  suggestBinding,
  type FormLayout,
  type FormSection,
} from "@pinpoint/core";
import { loadImage, preprocess } from "../forms/preprocess";
import { readFormLines, type OcrProgress } from "../forms/ocr";
import "../forms.css";

type Step = { name: "pick"; error?: string } | { name: "reading"; progress: OcrProgress; preview: string } | { name: "review" };

let counter = 0;
const newId = (p: string) => `${p}-${Date.now().toString(36)}-${++counter}`;

/**
 * Photograph a BLANK paper form; on-device OCR reads the printed labels and
 * builds a draft layout to review. The photo stays in memory and is dropped
 * after reading. Everything runs offline.
 */
export function FormScanScreen({ onSave, onCancel }: { onSave: (layout: FormLayout) => void; onCancel: () => void }) {
  const [step, setStep] = useState<Step>({ name: "pick" });
  const [layout, setLayout] = useState<FormLayout | null>(null);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  const read = async (file: File | undefined) => {
    if (!file) return;
    try {
      const bitmap = await loadImage(file);
      const prepared = preprocess(bitmap);
      bitmap.close();
      const preview = prepared.canvas.toDataURL("image/jpeg", 0.6);
      setStep({ name: "reading", progress: { status: "starting", progress: 0 }, preview });
      const lines = await readFormLines(prepared.canvas, (p) => alive.current && setStep((s) => (s.name === "reading" ? { ...s, progress: p } : s)));
      // Release the image: only the labels are kept.
      prepared.canvas.width = prepared.canvas.height = 0;
      if (!alive.current) return;
      const draft = layoutFromOcrLines(lines, "", { createdAt: new Date().toISOString() });
      if (!draft.sections.length) {
        setStep({ name: "pick", error: "No printed labels were found. Try a flatter, brighter photo of a blank form, or build the form by hand." });
        return;
      }
      setLayout(draft);
      setStep({ name: "review" });
    } catch (e) {
      if (alive.current) setStep({ name: "pick", error: `Could not read the photo: ${(e as Error).message}` });
    }
  };

  const byHand = () => {
    setLayout({
      id: newId("scan"),
      name: "",
      source: "scanned",
      version: newId("manual"),
      reviewStatus: PENDING_MEDICAL_REVIEW,
      createdAt: new Date().toISOString(),
      sections: [{ id: newId("s"), label: "", fields: [{ id: newId("f"), label: "", bind: null }] }],
    });
    setStep({ name: "review" });
  };

  if (step.name === "pick") {
    return (
      <div className="screen">
        <header className="bar">
          <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
          <div className="bar-title"><strong>Scan a paper form</strong></div>
        </header>
        <p>Photograph a <strong>blank</strong> copy of your team's patient form, flat and in good light. Pinpoint reads the printed labels on this phone, with no network, and lays your charts out the same way.</p>
        <p className="muted small">Use a blank form only. The photo is not saved; only the labels you approve are kept. Handwriting is not read.</p>
        {step.error && <p className="warn">{step.error}</p>}
        <label className="btn primary wide file-btn">
          Take or choose photo
          <input type="file" accept="image/*" capture="environment" onChange={(e) => void read(e.target.files?.[0])} />
        </label>
        <button type="button" className="btn wide" onClick={byHand}>Build the form by hand</button>
      </div>
    );
  }

  if (step.name === "reading") {
    return (
      <div className="screen">
        <header className="bar"><div className="bar-title"><strong>Reading the form…</strong></div></header>
        <img className="scan-preview" src={step.preview} alt="Cleaned-up photo of the form being read" />
        <progress className="scan-progress" value={step.progress.progress} max={1} />
        <p className="muted small">{step.progress.status} · on this phone, offline</p>
      </div>
    );
  }

  return <ReviewLayout layout={layout!} setLayout={setLayout} onSave={onSave} onCancel={onCancel} />;
}

function move<T>(list: T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

function ReviewLayout({ layout, setLayout, onSave, onCancel }: { layout: FormLayout; setLayout: (l: FormLayout) => void; onSave: (l: FormLayout) => void; onCancel: () => void }) {
  const [error, setError] = useState("");
  const setSections = (fn: (s: FormSection[]) => FormSection[]) => setLayout({ ...layout, sections: fn(layout.sections) });
  const setSection = (i: number, fn: (s: FormSection) => FormSection) => setSections((ss) => ss.map((s, k) => (k === i ? fn(s) : s)));

  const save = () => {
    const sections = layout.sections
      .map((s) => ({ ...s, label: s.label.trim(), fields: s.fields.map((f) => ({ ...f, label: f.label.trim() })).filter((f) => f.label) }))
      .filter((s) => s.label && s.fields.length);
    if (!layout.name.trim()) return setError("Give the form a name.");
    if (!sections.length) return setError("Add at least one section with a named field.");
    onSave({ ...layout, name: layout.name.trim(), sections, reviewStatus: PENDING_MEDICAL_REVIEW, source: "scanned" });
  };

  const bound = layout.sections.flatMap((s) => s.fields).filter((f) => f.bind).length;
  const total = layout.sections.flatMap((s) => s.fields).length;

  return (
    <div className="screen">
      <header className="bar">
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
        <div className="bar-title"><strong>Check the form</strong><span className="muted small">{bound} of {total} fields linked to chart data</span></div>
      </header>
      <p className="warn small">Check every label against the paper. Fields marked “Not captured” stay blank on the form. This form is {PENDING_MEDICAL_REVIEW} until your medical lead signs it off.</p>
      <label className="field">
        <span>Form name</span>
        <input value={layout.name} onChange={(e) => setLayout({ ...layout, name: e.target.value })} placeholder="As printed on the paper" />
      </label>

      {layout.sections.map((s, i) => (
        <section key={s.id} className="scan-section" aria-label={`Section ${i + 1}`}>
          <div className="scan-row">
            <input aria-label="Section heading" value={s.label} onChange={(e) => setSection(i, (x) => ({ ...x, label: e.target.value }))} placeholder="Section heading" />
            <button type="button" className="icon-btn" aria-label="Move section up" disabled={i === 0} onClick={() => setSections((ss) => move(ss, i, -1))}>↑</button>
            <button type="button" className="icon-btn" aria-label="Move section down" disabled={i === layout.sections.length - 1} onClick={() => setSections((ss) => move(ss, i, 1))}>↓</button>
            <button type="button" className="icon-btn" aria-label="Delete section" onClick={() => setSections((ss) => ss.filter((_, k) => k !== i))}>✕</button>
          </div>
          {s.fields.map((f, j) => (
            <div key={f.id} className="scan-row scan-field">
              <input
                aria-label="Field label"
                value={f.label}
                placeholder="Field label"
                onChange={(e) => setSection(i, (x) => ({ ...x, fields: x.fields.map((y, k) => (k === j ? { ...y, label: e.target.value } : y)) }))}
                onBlur={(e) => {
                  // Offer a link for a newly typed label that has none yet.
                  if (!f.bind) {
                    const b = suggestBinding(e.target.value);
                    if (b) setSection(i, (x) => ({ ...x, fields: x.fields.map((y, k) => (k === j ? { ...y, bind: b } : y)) }));
                  }
                }}
              />
              <select
                aria-label={`What “${f.label || "this field"}” holds`}
                value={bindingKey(f.bind)}
                onChange={(e) => setSection(i, (x) => ({ ...x, fields: x.fields.map((y, k) => (k === j ? { ...y, bind: bindingFromKey(e.target.value) } : y)) }))}
              >
                {BINDING_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
              <button type="button" className="icon-btn" aria-label="Move field up" disabled={j === 0} onClick={() => setSection(i, (x) => ({ ...x, fields: move(x.fields, j, -1) }))}>↑</button>
              <button type="button" className="icon-btn" aria-label="Move field down" disabled={j === s.fields.length - 1} onClick={() => setSection(i, (x) => ({ ...x, fields: move(x.fields, j, 1) }))}>↓</button>
              <button type="button" className="icon-btn" aria-label="Delete field" onClick={() => setSection(i, (x) => ({ ...x, fields: x.fields.filter((_, k) => k !== j) }))}>✕</button>
            </div>
          ))}
          <button type="button" className="btn" onClick={() => setSection(i, (x) => ({ ...x, fields: [...x.fields, { id: newId("f"), label: "", bind: null }] }))}>Add field</button>
        </section>
      ))}
      <button type="button" className="btn wide" onClick={() => setSections((ss) => [...ss, { id: newId("s"), label: "", fields: [{ id: newId("f"), label: "", bind: null }] }])}>Add section</button>
      {error && <p className="warn">{error}</p>}
      <button type="button" className="btn primary wide" onClick={save}>Save form · {PENDING_MEDICAL_REVIEW}</button>
    </div>
  );
}
