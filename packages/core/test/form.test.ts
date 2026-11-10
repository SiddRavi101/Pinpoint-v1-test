import { describe, expect, it } from "vitest";
import {
  BINDING_OPTIONS,
  BUILTIN_LAYOUT,
  ChartLog,
  PENDING_MEDICAL_REVIEW,
  TEMPLATE,
  bindingFromKey,
  bindingKey,
  cleanLabel,
  extract,
  fillForm,
  isFormLayout,
  layoutFromOcrLines,
  projectChart,
  splitLabels,
  suggestBinding,
  testEnv,
  type FormLayout,
  type OcrLine,
} from "../src/index.js";

function sample() {
  const env = testEnv("2026-12-16T19:00:00.000Z");
  const log = ChartLog.open({ deviceId: "d", training: true, env });
  env.set("2026-12-16T19:05:00.000Z");
  for (const said of [
    "34 year old female mechanism fall from about 10 feet onto rocks found at 1855",
    "pulse 104 resps 20 BP 128 over 82 sats 95 patient reports pain in the right lower leg",
  ]) extract(said, env.now(), env).proposals.forEach((p) => log.confirmProposal(p));
  env.set("2026-12-16T19:10:00.000Z");
  extract("tourniquet right leg on gave ondansetron 4 milligrams by mouth allergic to penicillin", env.now(), env).proposals.forEach((p) => log.confirmProposal(p));
  log.addTapEntry({ type: "survey", letter: "A", finding: "clear, talking" });
  return { env, log };
}

describe("built-in layout", () => {
  it("uses only the template's labels, in template order", () => {
    expect(BUILTIN_LAYOUT.sections.map((s) => s.label)).toEqual(TEMPLATE.map((t) => t.label));
    expect(BUILTIN_LAYOUT.reviewStatus).toBe(PENDING_MEDICAL_REVIEW);
    expect(isFormLayout(BUILTIN_LAYOUT)).toBe(true);
  });

  it("places every charted entry somewhere", () => {
    const { log } = sample();
    const filled = fillForm(BUILTIN_LAYOUT, projectChart(log.events));
    expect(filled.unplacedEntryIds).toEqual([]);
    expect(filled.counts.pending).toBe(0);
    expect(filled.counts.confirmed).toBe(projectChart(log.events).entries.length);
  });
});

describe("fillForm", () => {
  it("fills fields with confirmed values, time, source and quote", () => {
    const { log } = sample();
    const filled = fillForm(BUILTIN_LAYOUT, projectChart(log.events));
    const field = (id: string) => filled.sections.flatMap((s) => s.fields).find((f) => f.id === id)!;
    const treatment = field("treatment").values;
    expect(treatment.map((v) => v.text)).toEqual(["Tourniquet ON · right leg", "ondansetron 4 mg PO"]);
    expect(treatment[0]!.quote).toMatch(/tourniquet right leg on/);
    expect(treatment[0]!.source).toBe("voice");
    expect(field("allergies").values.map((v) => v.text)).toEqual(["penicillin"]);
    expect(field("survey-A").values[0]).toMatchObject({ text: "clear, talking", source: "tap", pending: false });
    expect(field("survey-B").values).toEqual([]);
    expect(field("incident").values.map((v) => v.text)).toContain("Found 18:55");
  });

  it("draws vital signs as a time-ordered table, waiting cards ghosted", () => {
    const { log, env } = sample();
    const chart = projectChart(log.events);
    env.set("2026-12-16T19:20:00.000Z");
    const waiting = extract("pulse 96 BP 124 over 80", env.now(), env).proposals;
    const filled = fillForm(BUILTIN_LAYOUT, chart, waiting);
    const table = filled.sections.find((s) => s.id === "vitals")!.fields[0]!.table!;
    expect(table).toHaveLength(2);
    expect(table[0]).toMatchObject({ pending: false });
    expect(table[0]!.cells.pulse!.text).toBe("104");
    expect(table[0]!.cells.bp!.text).toBe("128/82");
    expect(table[1]!.pending).toBe(true);
    expect(table[1]!.cells.pulse).toMatchObject({ text: "96", pending: true });
    expect(table[1]!.cells.resp).toBeUndefined();
    expect(filled.counts.pending).toBe(2);
  });

  it("shows a waiting card in its field without making it part of the record", () => {
    const env = testEnv();
    const log = ChartLog.open({ deviceId: "d", training: true, env });
    const cards = extract("mechanism rolled ankle on the trail", env.now(), env).proposals;
    const filled = fillForm(BUILTIN_LAYOUT, projectChart(log.events), cards);
    const v = filled.sections.find((s) => s.id === "incident")!.fields[0]!.values;
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ pending: true, cardId: cards[0]!.id });
    expect(projectChart(log.events).entries).toHaveLength(0);
  });

  it("drops voided entries and marks unbound paper fields as not captured", () => {
    const { log } = sample();
    const chart0 = projectChart(log.events);
    const allergy = chart0.entries.find((e) => e.value.type === "allergy")!;
    log.voidEntry(allergy.eventId);
    const layout: FormLayout = {
      ...BUILTIN_LAYOUT,
      sections: [{ id: "s", label: "S", fields: [{ id: "a", label: "Allergies", bind: { kind: "allergies" } }, { id: "w", label: "Weight", bind: null }] }],
    };
    const filled = fillForm(layout, projectChart(log.events));
    expect(filled.sections[0]!.fields[0]!.values).toEqual([]);
    expect(filled.sections[0]!.fields[1]!.unsupported).toBe(true);
    expect(filled.counts.unsupported).toBe(1);
    expect(filled.unplacedEntryIds.length).toBeGreaterThan(0);
  });

  it("patient fields show the latest value for that detail", () => {
    const env = testEnv();
    const log = ChartLog.open({ deviceId: "d", training: true, env });
    log.addTapEntry({ type: "patient", age: 30, sex: "male" });
    env.advance(60_000);
    log.addTapEntry({ type: "patient", age: 31 });
    const layout: FormLayout = {
      ...BUILTIN_LAYOUT,
      sections: [{ id: "p", label: "Patient", fields: [{ id: "age", label: "Age", bind: { kind: "patient", field: "age" } }, { id: "sex", label: "Sex", bind: { kind: "patient", field: "sex" } }] }],
    };
    const f = fillForm(layout, projectChart(log.events)).sections[0]!.fields;
    expect(f[0]!.values.map((v) => v.text)).toEqual(["31"]);
    expect(f[1]!.values.map((v) => v.text)).toEqual(["male"]);
  });
});

describe("suggestBinding", () => {
  it.each([
    ["Pulse", "vital.pulse"],
    ["Heart Rate", "vital.pulse"],
    ["HR", "vital.pulse"],
    ["B/P", "vital.bp"],
    ["Blood Pressure", "vital.bp"],
    ["Resp. Rate", "vital.resp"],
    ["RR", "vital.resp"],
    ["SpO2 %", "vital.spo2"],
    ["Pulse Ox", "vital.spo2"],
    ["O2 Sat", "vital.spo2"],
    ["GCS", "vital.gcs"],
    ["LOC", "vital.gcs"],
    ["Allergies", "allergies"],
    ["NKDA", "allergies"],
    ["Medications Given", "med"],
    ["Meds", "med"],
    ["Tourniquet", "tourniquet"],
    ["TQ time", "tourniquet"],
    ["MOI", "mechanism"],
    ["Mechanism of Injury", "mechanism"],
    ["Chief Complaint", "patient_report"],
    ["C/C", "patient_report"],
    ["Patient Name", "patient.name"],
    ["Age", "patient.age"],
    ["DOB", "patient.age"],
    ["Sex", "patient.sex"],
    ["Gender", "patient.sex"],
    ["Time Found", "time_found"],
    ["Time Pt Located", "time_found"],
    ["Massive Hemorrhage", "survey.x"],
    ["Airway", "survey.A"],
    ["Breathing", "survey.B"],
    ["Circulation (pulse, skin)", "survey.C"],
    ["Disability", "survey.D"],
    ["Exposure / Environment", "survey.E"],
    ["Narrative", "note"],
    ["Notes / Comments", "note"],
    ["VITAL SIGNS", "vitals"],
    ["Treatment", "treatment"],
  ])("%s -> %s", (label, key) => {
    expect(bindingKey(suggestBinding(label))).toBe(key);
  });

  it.each([
    ["Alrway", "survey.A"],
    ["BIP", "vital.bp"],
    ["Sp0O2", "vital.spo2"],
    ["GCs", "vital.gcs"],
    ["A11ergies", "allergies"],
    ["Circu1ation", "survey.C"],
    ["Tourniquct", "tourniquet"],
  ])("tolerates OCR slip %s -> %s", (label, key) => {
    expect(bindingKey(suggestBinding(label))).toBe(key);
  });

  it("returns null for fields Pinpoint does not capture", () => {
    for (const l of ["Weight", "Incident #", "Team Leader", "Signature", "Lat/Long"]) expect(suggestBinding(l)).toBeNull();
  });

  it("binding keys round-trip for every option", () => {
    for (const o of BINDING_OPTIONS) expect(bindingKey(bindingFromKey(o.key))).toBe(o.key);
  });
});

describe("cleaning OCR labels", () => {
  it("strips fill-in lines, boxes and colons", () => {
    expect(cleanLabel("Pulse: ________")).toBe("Pulse");
    expect(cleanLabel("☐ NKDA")).toBe("NKDA");
    expect(cleanLabel("Allergies ......")).toBe("Allergies");
  });
  it("splits several labels on one printed line", () => {
    expect(splitLabels("Age: ______ Sex: ______ Weight: ______")).toEqual(["Age", "Sex", "Weight"]);
    expect(splitLabels("Age: Sex:")).toEqual(["Age", "Sex"]);
    expect(splitLabels("Time found: 14:20")).toEqual(["Time found: 14:20"]);
  });
});

/** OCR of a typical county SAR patient care form (blank), as tesseract returns lines. */
function sarFormOcr(): OcrLine[] {
  let y = 20;
  const line = (text: string, h = 18, confidence = 90, x0 = 40): OcrLine => {
    const l = { text, bbox: { x0, y0: y, x1: x0 + text.length * 9, y1: y + h }, confidence };
    y += h + 14;
    return l;
  };
  const same = (prev: OcrLine, text: string, x0: number, confidence = 90): OcrLine => ({ text, bbox: { x0, y0: prev.bbox.y0 + 1, x1: x0 + text.length * 9, y1: prev.bbox.y1 }, confidence });
  const lines: OcrLine[] = [];
  lines.push(line("SEARCH AND RESCUE PATIENT CARE REPORT", 30));
  lines.push(line("Incident #: ________ Date: ________"));
  lines.push(line("PATIENT"));
  const nm = line("Name: ______________________");
  lines.push(nm);
  lines.push(line("Age: _____ Sex: _____ Weight: _____"));
  lines.push(line("INCIDENT"));
  lines.push(line("Mechanism of Injury: __________________"));
  lines.push(line("Time Found: ______"));
  lines.push(line("~~ ;; 3 ,,", 18, 30)); // smudge
  lines.push(line("Pt Status", 18, 20)); // too faint to trust
  lines.push(line("PRIMARY SURVEY"));
  const ms = line("Massive Hemorrhage: ________");
  lines.push(ms);
  lines.push(line("Airway: ________"));
  lines.push(line("Breathing: ________"));
  lines.push(line("Circulation: ________"));
  lines.push(line("Disability: ________"));
  lines.push(line("Exposure: ________"));
  lines.push(line("VITAL SIGNS"));
  const t = line("Time");
  lines.push(t, same(t, "Pulse", 140), same(t, "Resp", 240), same(t, "B/P", 340), same(t, "SpO2", 440), same(t, "GCS", 540));
  lines.push(line("TREATMENT"));
  lines.push(line("Tourniquet: ______ Time on: ______"));
  lines.push(line("Medications Given: ______________"));
  lines.push(line("Allergies: ______________"));
  lines.push(line("Chief Complaint: _______________"));
  lines.push(line("NARRATIVE"));
  lines.push(line("Signature: ____________"));
  lines.push(line("1"));
  // tesseract can return lines slightly out of order; the layout must re-sort.
  return [lines[3]!, ...lines.slice(0, 3), ...lines.slice(4)];
}

describe("layoutFromOcrLines (SAR patient form sample)", () => {
  const layout = layoutFromOcrLines(sarFormOcr(), "", { createdAt: "2026-11-10T00:00:00.000Z" });
  const sec = (label: string) => layout.sections.find((s) => s.label === label)!;
  const keys = (label: string) => sec(label).fields.map((f) => [f.label, bindingKey(f.bind)]);

  it("is a scanned draft pending medical review", () => {
    expect(layout.source).toBe("scanned");
    expect(layout.reviewStatus).toBe(PENDING_MEDICAL_REVIEW);
    expect(layout.name).toBe("SEARCH AND RESCUE PATIENT CARE REPORT");
    expect(isFormLayout(layout)).toBe(true);
  });

  it("finds sections in paper order", () => {
    expect(layout.sections.map((s) => s.label)).toEqual(["Section 1", "PATIENT", "INCIDENT", "PRIMARY SURVEY", "VITAL SIGNS", "TREATMENT", "NARRATIVE"]);
  });

  it("keeps labels from the paper and suggests bindings", () => {
    expect(keys("Section 1")).toEqual([["Incident #", "none"], ["Date", "none"]]);
    expect(keys("PATIENT")).toEqual([["Name", "patient.name"], ["Age", "patient.age"], ["Sex", "patient.sex"], ["Weight", "none"]]);
    expect(keys("INCIDENT")).toEqual([["Mechanism of Injury", "mechanism"], ["Time Found", "time_found"]]);
    expect(keys("PRIMARY SURVEY").map((k) => k[1])).toEqual(["survey.x", "survey.A", "survey.B", "survey.C", "survey.D", "survey.E"]);
    expect(keys("VITAL SIGNS")).toEqual([["Time", "none"], ["Pulse", "vital.pulse"], ["Resp", "vital.resp"], ["B/P", "vital.bp"], ["SpO2", "vital.spo2"], ["GCS", "vital.gcs"]]);
    expect(keys("TREATMENT")).toEqual([
      ["Tourniquet", "tourniquet"], ["Time on", "none"], ["Medications Given", "med"], ["Allergies", "allergies"], ["Chief Complaint", "patient_report"],
    ]);
    expect(keys("NARRATIVE")).toEqual([["Signature", "none"]]);
  });

  it("drops smudges, low-confidence lines and page numbers", () => {
    const all = layout.sections.flatMap((s) => s.fields.map((f) => f.label));
    expect(all.some((l) => /~|;;/.test(l))).toBe(false);
    expect(all).not.toContain("1");
  });

  it("an empty header becomes its own field", () => {
    const l = layoutFromOcrLines(
      [
        { text: "VITAL SIGNS", bbox: { x0: 0, y0: 0, x1: 100, y1: 18 }, confidence: 90 },
        { text: "NOTES", bbox: { x0: 0, y0: 40, x1: 100, y1: 58 }, confidence: 90 },
      ],
      "Form",
    );
    expect(l.sections.map((s) => [s.label, bindingKey(s.fields[0]!.bind)])).toEqual([["VITAL SIGNS", "vitals"], ["NOTES", "note"]]);
  });

  it("is deterministic: same paper, same id", () => {
    expect(layoutFromOcrLines(sarFormOcr(), "x").id).toBe(layoutFromOcrLines(sarFormOcr(), "x").id);
  });

  it("fills from a real chart", () => {
    const { log } = sample();
    const filled = fillForm(layout, projectChart(log.events));
    const f = (label: string) => filled.sections.flatMap((s) => s.fields).find((x) => x.label === label)!;
    expect(f("Pulse").values.map((v) => v.text)).toEqual(["104 /min"]);
    expect(f("Age").values.map((v) => v.text)).toEqual(["34"]);
    expect(f("Weight").unsupported).toBe(true);
    expect(f("Airway").values.map((v) => v.text)).toEqual(["clear, talking"]);
  });
});
