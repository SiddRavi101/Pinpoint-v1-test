/**
 * Deterministic voice rules: utterance text -> proposed chart entries.
 *
 * No model is involved. Each keyword ("pulse", "BP", "gave", "tourniquet"...)
 * opens a span that runs to the next keyword; a small parser reads its span.
 * Anything not understood is kept as the medic's narrative note, so no
 * spoken words are dropped. Nothing here writes to the chart: every result
 * is a Proposal that needs a tap.
 */
import type { DoseUnit, Entry, Limb, Proposal, Route } from "../types.js";
import type { Env } from "../env.js";
import { defaultEnv } from "../env.js";
import { originalQuote, tokenize, tokensInRange, type Tokenized } from "./tokens.js";
import { matchDrug } from "./fuzzy.js";
import { findAtClock, parseClock } from "./clock.js";

export const RULES_VERSION = "rules-0.1.0";

type AnchorType =
  | "spo2" | "pulse" | "bp" | "resp" | "gcs" | "med" | "tourniquet" | "nka" | "allergy"
  | "report" | "mechanism" | "found" | "demographics" | "name";

const ANCHORS: { type: AnchorType; re: RegExp }[] = [
  { type: "spo2", re: /\b(?:spo2|sp o2|o2 sats?|o2 saturation|oxygen sat(?:uration)?s?|sats?|saturation|pulse ox(?:imetry)?|pulse ox)\b/g },
  { type: "pulse", re: /\b(?:pulse|heart rate|hr)\b/g },
  { type: "bp", re: /\b(?:bp|blood pressure|b p)\b/g },
  { type: "resp", re: /\b(?:resps?|respirations?|respiratory rate|resp rate|rr|breathing rate|breathing)\b/g },
  { type: "gcs", re: /\b(?:gcs|glasgow(?: coma scale)?)\b/g },
  { type: "med", re: /\b(?:gave|given|administered|administer|pushed|dosed)\b/g },
  { type: "tourniquet", re: /\b(?:(?:applied|placed|put on|removed|released|took off)\s+(?:a\s+|the\s+)?)?(?:tourniquet|tq)\b/g },
  { type: "nka", re: /\b(?:nkda|nka|no known (?:drug )?allergies|no allergies|denies (?:any )?allergies)\b/g },
  { type: "allergy", re: /\b(?:allergic to|allergy to|allergies to|allergies(?: are| is| include)?|allergy)\b/g },
  { type: "report", re: /\b(?:(?:the\s+)?(?:patient|pt|subject|he|she|they)\s+)?(?:reports|reported|states|stated|says|said|complains of|complaining of|c\/o|denies|denied)\b/g },
  { type: "mechanism", re: /\b(?:mechanism of injury|mechanism|moi)\b(?:\s+(?:is|was|of))?|\b(?:ground level fall|fell from|fell down|fall from)\b/g },
  { type: "found", re: /\b(?:time found|patient found|found)\b(?:\s+at)?/g },
  { type: "demographics", re: /\b\d{1,3}\s*(?:year|yr)s?(?:\s+old)?\s+(?:male|female|man|woman|boy|girl|m|f)\b/g },
  { type: "name", re: /\b(?:patient(?:'s)? name is|patient name|name is|her name is|his name is)\b/g },
];

interface Anchor {
  type: AnchorType;
  start: number;
  end: number;
}

interface Parsed {
  entry: Entry;
  review: string[];
  candidates?: string[];
  at?: Date;
}

interface SpanResult {
  parsed: Parsed[];
  /** Characters of the span (from its start) that the parser used. */
  consumed: number;
}

const FILLER = new Set([
  "and", "then", "uh", "um", "er", "ok", "okay", "so", "also", "next", "now", "pinpoint", "the", "a", "an",
  "is", "was", "at", "of", "with", "to",
]);

const outOfRange = (label: string, v: number) => `Check the number: ${label} ${v} is outside the usual range`;

function findAnchors(text: string): Anchor[] {
  const all: Anchor[] = [];
  for (const { type, re } of ANCHORS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      all.push({ type, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
    }
  }
  all.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const kept: Anchor[] = [];
  for (const a of all) {
    const prev = kept[kept.length - 1];
    if (prev && a.start < prev.end) continue;
    // "mechanism fall from 10 feet": one mechanism, not two.
    if (prev && prev.type === "mechanism" && a.type === "mechanism") continue;
    kept.push(a);
  }
  return kept;
}

const NUM = String.raw`(\d{1,3}(?:\.\d+)?)`;
const LINK = String.raw`(?:\s+(?:is|of|was|at|rate|about|around|approximately))*`;

function parseVital(type: "pulse" | "resp" | "spo2", span: string, anchorLen: number): SpanResult {
  const rest = span.slice(anchorLen);
  const m = new RegExp(`^${LINK}\\s+${NUM}(?:\\s*%|\\s+percent)?`).exec(rest);
  if (!m) return { parsed: [], consumed: 0 };
  const v = Number(m[1]);
  const consumed = anchorLen + m[0].length;
  if (type === "pulse") {
    return { parsed: [{ entry: { type: "pulse", bpm: v }, review: v < 20 || v > 250 ? [outOfRange("pulse", v)] : [] }], consumed };
  }
  if (type === "resp") {
    return { parsed: [{ entry: { type: "resp", rate: v }, review: v < 4 || v > 60 ? [outOfRange("respirations", v)] : [] }], consumed };
  }
  return { parsed: [{ entry: { type: "spo2", percent: v }, review: v < 50 || v > 100 ? [outOfRange("SpO2", v)] : [] }], consumed };
}

function parseBp(span: string, anchorLen: number): SpanResult {
  const rest = span.slice(anchorLen);
  const full = new RegExp(`^${LINK}\\s+(\\d{2,3})\\s*(?:over|\\/|on)\\s*(\\d{2,3})\\b`).exec(rest);
  if (full) {
    const s = Number(full[1]);
    const d = Number(full[2]);
    const review: string[] = [];
    if (s < 50 || s > 260) review.push(outOfRange("systolic", s));
    if (d < 20 || d > 160) review.push(outOfRange("diastolic", d));
    if (d >= s) review.push("Check the numbers: the second BP number is not lower than the first");
    return { parsed: [{ entry: { type: "bp", systolic: s, diastolic: d }, review }], consumed: anchorLen + full[0].length };
  }
  const palp = new RegExp(`^${LINK}\\s+(\\d{2,3})\\s+(?:by\\s+)?(?:palp|palpation|palpated)\\b`).exec(rest);
  if (palp) {
    const s = Number(palp[1]);
    return {
      parsed: [{ entry: { type: "bp", systolic: s, diastolic: null }, review: s < 50 || s > 260 ? [outOfRange("systolic", s)] : [] }],
      consumed: anchorLen + palp[0].length,
    };
  }
  return { parsed: [], consumed: 0 };
}

function parseGcs(span: string, anchorLen: number): SpanResult {
  const rest = span.slice(anchorLen);
  const total = new RegExp(`^${LINK}\\s+(\\d{1,2})\\b`).exec(rest);
  const comp = /\b(?:e|eyes?|eye opening)\s*(\d)\s*,?\s*(?:v|verbal)\s*(\d)\s*,?\s*(?:m|motor)\s*(\d)\b/.exec(rest);
  if (!total && !comp) return { parsed: [], consumed: 0 };
  const e = comp ? Number(comp[1]) : undefined;
  const v = comp ? Number(comp[2]) : undefined;
  const m = comp ? Number(comp[3]) : undefined;
  const sum = e !== undefined && v !== undefined && m !== undefined ? e + v + m : undefined;
  const t = total ? Number(total[1]) : sum!;
  const review: string[] = [];
  if (t < 3 || t > 15) review.push(`Check the number: GCS ${t} is outside 3 to 15`);
  if (e !== undefined && (e < 1 || e > 4)) review.push(`Check the number: eye score ${e} is outside 1 to 4`);
  if (v !== undefined && (v < 1 || v > 5)) review.push(`Check the number: verbal score ${v} is outside 1 to 5`);
  if (m !== undefined && (m < 1 || m > 6)) review.push(`Check the number: motor score ${m} is outside 1 to 6`);
  if (sum !== undefined && total && sum !== t) review.push(`Check the numbers: E${e} V${v} M${m} adds to ${sum}, not ${t}`);
  const entry: Entry = comp ? { type: "gcs", total: t, e, v, m } : { type: "gcs", total: t };
  const ends = [total ? anchorLen + total[0].length : 0, comp ? anchorLen + (comp.index ?? 0) + comp[0].length : 0];
  return { parsed: [{ entry, review }], consumed: Math.max(...ends) };
}

const DOSE_RE = /(\d+(?:\.\d+)?)\s*(milligrams?|mgs?|micrograms?|mcg|mics|grams?|gm|g|milliliters?|mls?|cc|liters? per minute|liters?|lpm|l\/min|units?|puffs?|tablets?|tabs?|sprays?)\b/;
const DOSE_UNITS: [RegExp, DoseUnit][] = [
  [/^(?:milligrams?|mgs?)$/, "mg"],
  [/^(?:micrograms?|mcg|mics)$/, "mcg"],
  [/^(?:grams?|gm|g)$/, "g"],
  [/^(?:milliliters?|mls?|cc)$/, "mL"],
  [/^(?:liters? per minute|liters?|lpm|l\/min)$/, "L/min"],
  [/^units?$/, "units"],
  [/^puffs?$/, "puffs"],
  [/^(?:tablets?|tabs?)$/, "tabs"],
  [/^sprays?$/, "sprays"],
];
const ROUTES: [RegExp, Route][] = [
  [/\b(?:by mouth|orally|oral|po|p\.o)\b/, "PO"],
  [/\b(?:intramuscular(?:ly)?|im)\b/, "IM"],
  [/\b(?:intravenous(?:ly)?|iv)\b/, "IV"],
  [/\b(?:intranasal(?:ly)?|in the nose|nasally|nasal spray)\b/, "IN"],
  [/\b(?:sublingual(?:ly)?|sl|under the tongue)\b/, "SL"],
  [/\b(?:nebulized|nebulizer|neb)\b/, "NEB"],
  [/\b(?:inhaled|inhaler|mdi)\b/, "INH"],
  [/\b(?:topical(?:ly)?)\b/, "TOP"],
  [/\b(?:non ?rebreather|nrb)\b/, "NRB"],
  [/\b(?:nasal cannula|nc)\b/, "NC"],
  [/\b(?:bvm|bag valve mask)\b/, "BVM"],
];
const MED_STOP = new Set(["the", "a", "an", "of", "some", "patient", "pt", "him", "her", "them", "to", "for", "with", "x", "times", "dose", "doses", "via", "by", "and", "one", "1"]);

function parseMed(span: string, anchorLen: number, ref: Date): SpanResult {
  const body = span.slice(anchorLen);
  const used: [number, number][] = [];
  const offset = anchorLen;

  let at: Date | undefined;
  const clock = findAtClock(body, ref);
  if (clock) {
    at = clock.date;
    used.push([clock.start, clock.end]);
  }

  let dose: { amount: number; unit: DoseUnit } | undefined;
  const dm = DOSE_RE.exec(body);
  if (dm) {
    const unit = DOSE_UNITS.find(([re]) => re.test(dm[2]!))?.[1];
    if (unit) {
      dose = { amount: Number(dm[1]), unit };
      used.push([dm.index, dm.index + dm[0].length]);
    }
  }

  let route: Route | undefined;
  let routeRange: [number, number] | undefined;
  for (const [re, r] of ROUTES) {
    const m = re.exec(body);
    if (m && !used.some(([s, e]) => m.index >= s && m.index < e)) {
      route = r;
      routeRange = [m.index, m.index + m[0].length];
      break;
    }
  }

  // Candidate drug words: everything not used by time/dose, not filler.
  const words = [...body.matchAll(/\S+/g)].map((m) => ({ w: m[0], s: m.index ?? 0, e: (m.index ?? 0) + m[0].length }));
  const free = words.filter((x) => !used.some(([s, e]) => x.s >= s && x.s < e) && !MED_STOP.has(x.w) && !/^\d/.test(x.w));
  let best: { score: number; text: string; s: number; e: number; match: ReturnType<typeof matchDrug> } | undefined;
  for (let i = 0; i < free.length; i++) {
    for (let len = 1; len <= 3 && i + len <= free.length; len++) {
      const win = free.slice(i, i + len);
      // Windows must be contiguous in the original span.
      if (win.some((x, k) => k > 0 && words.indexOf(x) !== words.indexOf(win[k - 1]!) + 1)) break;
      const text = win.map((x) => x.w).join(" ");
      const match = matchDrug(text);
      if (!best || match.score > best.score + 1e-9 || (Math.abs(match.score - best.score) < 1e-9 && text.length > best.text.length)) {
        best = { score: match.score, text, s: win[0]!.s, e: win[win.length - 1]!.e, match };
      }
    }
  }

  // A route word inside the drug name ("oral glucose") is part of the name.
  if (routeRange && best && routeRange[0] >= best.s && routeRange[0] < best.e && best.match.status === "clear") {
    route = undefined;
    for (const [re, r] of ROUTES) {
      const rest = body.slice(0, best.s) + " ".repeat(best.e - best.s) + body.slice(best.e);
      const m = re.exec(rest);
      if (m) {
        route = r;
        routeRange = [m.index, m.index + m[0].length];
        break;
      }
    }
    if (!route) routeRange = undefined;
  }
  if (routeRange) used.push(routeRange);

  if (!best && !dose) return { parsed: [], consumed: 0 };

  const review: string[] = [];
  let drug: string | null = null;
  let spoken = best?.text ?? "";
  let candidates: string[] | undefined;
  if (!best) {
    review.push("Say or pick the drug name");
  } else if (best.match.status === "clear") {
    drug = best.match.drug;
  } else if (best.match.status === "unclear") {
    candidates = best.match.candidates;
    review.push(`Drug name unclear: "${spoken}". Pick the right one`);
  } else {
    review.push(`"${spoken}" is not on the drug list. Check the name`);
  }
  if (best) used.push([best.s, best.e]);

  const entry: Entry = { type: "med", drug, spoken, ...(dose ? { dose } : {}), ...(route ? { route } : {}) };
  const end = Math.max(...used.map(([, e]) => e));
  return { parsed: [{ entry, review, candidates, at }], consumed: offset + end };
}

function limbOf(text: string): { limb?: Limb; unclear: boolean; end: number } {
  const abbr = /\b(lle|rle|lue|rue)\b/.exec(text);
  if (abbr) {
    const map: Record<string, Limb> = { lle: "left leg", rle: "right leg", lue: "left arm", rue: "right arm" };
    return { limb: map[abbr[1]!], unclear: false, end: abbr.index + abbr[0].length };
  }
  const m = /\b(left|right|l|r)\s+(upper\s+|lower\s+)?(arm|forearm|leg|thigh|calf|extremity)\b/.exec(text);
  if (!m) return { unclear: false, end: 0 };
  const side = m[1] === "left" || m[1] === "l" ? "left" : "right";
  const part = m[3]!;
  let kind: "arm" | "leg" | null = null;
  if (part === "arm" || part === "forearm") kind = "arm";
  else if (part === "leg" || part === "thigh" || part === "calf") kind = "leg";
  else if (m[2]?.trim() === "upper") kind = "arm";
  else if (m[2]?.trim() === "lower") kind = "leg";
  if (!kind) return { unclear: true, end: m.index + m[0].length };
  return { limb: `${side} ${kind}` as Limb, unclear: false, end: m.index + m[0].length };
}

function parseTourniquet(span: string, ref: Date): SpanResult {
  const ends: number[] = [];
  const offRe = /\b(?:off|removed|released|took off|taken off)\b/;
  const onRe = /\b(?:on|applied|placed|put on|tightened)\b/;
  const off = offRe.exec(span);
  const on = onRe.exec(span);
  let action: "on" | "off" = "on";
  const review: string[] = [];
  if (off && (!on || off.index <= on.index)) {
    action = "off";
    ends.push(off.index + off[0].length);
  } else if (on) {
    ends.push(on.index + on[0].length);
  } else {
    review.push("Say whether the tourniquet went on or came off");
  }
  const limb = limbOf(span);
  if (limb.end) ends.push(limb.end);
  if (!limb.limb) review.push(limb.unclear ? "Which limb: arm or leg?" : "Which limb?");
  let at: Date | undefined;
  const clock = findAtClock(span, ref);
  if (clock) {
    at = clock.date;
    ends.push(clock.end);
  }
  const anchorEnd = /\b(?:tourniquet|tq)\b/.exec(span);
  if (anchorEnd) ends.push(anchorEnd.index + anchorEnd[0].length);
  return {
    parsed: [{ entry: { type: "tourniquet", action, ...(limb.limb ? { limb: limb.limb } : {}) }, review, at }],
    consumed: Math.max(...ends),
  };
}

function parseAllergy(span: string, anchorLen: number, tz: Tokenized, spanStart: number): SpanResult {
  // Use the original words so commas still separate items.
  const rest = originalQuote(tz, spanStart + anchorLen, spanStart + span.length, 1000).toLowerCase();
  const items = rest
    .split(/\s*(?:,|;|\band\b|\bor\b|\balso\b)\s*/)
    .map((s) => s.replace(/[.!?]+$/, "").replace(/^(?:the|a|an)\s+/, "").trim())
    .filter((s) => s.length > 0)
    .map((s) => s.split(/\s+/).slice(0, 4).join(" "));
  if (items.length === 0) return { parsed: [], consumed: 0 };
  return { parsed: items.map((substance) => ({ entry: { type: "allergy", substance }, review: [] })), consumed: span.length };
}

function parseFreeText(type: "patient_report" | "mechanism", span: string, anchorText: string, anchorLen: number): SpanResult {
  let rest = span.slice(anchorLen).trim().replace(/(?:\s+(?:and|then|also|so|um|uh))+$/, "");
  if (type === "patient_report" && /\bden(?:ies|ied)\b/.test(anchorText)) rest = `denies ${rest}`.trim();
  if (type === "mechanism" && !/^(?:mechanism|moi)/.test(anchorText)) rest = `${anchorText} ${rest}`.trim();
  if (!rest || rest === "denies") return { parsed: [], consumed: 0 };
  return { parsed: [{ entry: { type, text: rest } as Entry, review: [] }], consumed: span.length };
}

function parseFound(span: string, anchorLen: number, ref: Date): SpanResult {
  const rest = span.slice(anchorLen).trimStart();
  const lead = span.length - anchorLen - rest.length;
  const c = parseClock(rest, ref);
  if (!c) return { parsed: [], consumed: 0 };
  return { parsed: [{ entry: { type: "time_found", time: c.date.toISOString() }, review: [] }], consumed: anchorLen + lead + c.length };
}

function parseDemographics(span: string): SpanResult {
  const m = /^(\d{1,3})\s*(?:year|yr)s?(?:\s+old)?\s+(male|female|man|woman|boy|girl|m|f)\b/.exec(span);
  if (!m) return { parsed: [], consumed: 0 };
  const age = Number(m[1]);
  const sex = /^(?:male|man|boy|m)$/.test(m[2]!) ? "male" : "female";
  return { parsed: [{ entry: { type: "patient", age, sex }, review: age > 120 ? [outOfRange("age", age)] : [] }], consumed: m[0].length };
}

function parseName(span: string, anchorLen: number, tz: Tokenized, spanStart: number): SpanResult {
  const rest = span.slice(anchorLen);
  const m = /^\s+([a-z][a-z'-]*(?:\s+[a-z][a-z'-]*){0,2})/.exec(rest);
  if (!m) return { parsed: [], consumed: 0 };
  // Use the original casing from the utterance.
  const from = spanStart + anchorLen + (m[0].length - m[1]!.length);
  const to = spanStart + anchorLen + m[0].length;
  const name = originalQuote(tz, from, to, 3);
  return { parsed: [{ entry: { type: "patient", name }, review: [] }], consumed: anchorLen + m[0].length };
}

export interface ExtractResult {
  proposals: Proposal[];
  /** The utterance after number normalization, for debugging and the test set. */
  normalized: string;
}

/**
 * Turns one push-to-talk utterance into proposals. `spokenAt` is the time the
 * medic released the button (speech time), used as each entry's time.
 */
export function extract(utterance: string, spokenAt: Date, env: Env = defaultEnv): ExtractResult {
  const tz = tokenize(utterance);
  const text = tz.text;
  const anchors = findAnchors(text);
  const consumedRanges: [number, number][] = [];
  const proposals: Proposal[] = [];

  anchors.forEach((a, idx) => {
    const spanEnd = anchors[idx + 1]?.start ?? text.length;
    const span = text.slice(a.start, spanEnd).trimEnd();
    const anchorText = text.slice(a.start, a.end);
    const anchorLen = a.end - a.start;
    let r: SpanResult;
    switch (a.type) {
      case "pulse":
      case "resp":
      case "spo2":
        r = parseVital(a.type, span, anchorLen);
        break;
      case "bp":
        r = parseBp(span, anchorLen);
        break;
      case "gcs":
        r = parseGcs(span, anchorLen);
        break;
      case "med":
        r = parseMed(span, anchorLen, spokenAt);
        break;
      case "tourniquet":
        r = parseTourniquet(span, spokenAt);
        break;
      case "nka":
        r = { parsed: [{ entry: { type: "no_known_allergies" }, review: [] }], consumed: anchorLen };
        break;
      case "allergy":
        r = parseAllergy(span, anchorLen, tz, a.start);
        break;
      case "report":
        r = parseFreeText("patient_report", span, anchorText, anchorLen);
        break;
      case "mechanism":
        r = parseFreeText("mechanism", span, anchorText, anchorLen);
        break;
      case "found":
        r = parseFound(span, anchorLen, spokenAt);
        break;
      case "demographics":
        r = parseDemographics(span);
        break;
      case "name":
        r = parseName(span, anchorLen, tz, a.start);
        break;
    }
    if (r.parsed.length === 0) return;
    const end = a.start + r.consumed;
    consumedRanges.push([a.start, end]);
    const quote = originalQuote(tz, a.start, end);
    for (const p of r.parsed) {
      proposals.push({
        id: env.newId(),
        entry: p.entry,
        quote,
        at: (p.at ?? spokenAt).toISOString(),
        review: p.review,
        ...(p.candidates ? { candidates: p.candidates } : {}),
        ruleVersion: RULES_VERSION,
      });
    }
  });

  // Everything not used becomes the narrative note.
  const leftover = tz.tokens
    .map((_, i) => i)
    .filter((i) => {
      const o = tz.offsets[i]!;
      return !consumedRanges.some(([s, e]) => o >= s && o < e);
    });
  const meaningful = leftover.filter((i) => !FILLER.has(tz.tokens[i]!.norm));
  if (meaningful.length > 0) {
    // Keep the medic's words as said, trimming leading/trailing filler.
    const first = meaningful[0]!;
    const last = meaningful[meaningful.length - 1]!;
    const runs = leftover.filter((i) => i >= first && i <= last);
    const words = runs.map((i) => tz.original.slice(tz.tokens[i]!.origStart, tz.tokens[i]!.origEnd));
    const noteText = words.join(" ");
    proposals.push({
      id: env.newId(),
      entry: { type: "note", text: noteText },
      quote: words.length > 15 ? words.slice(0, 15).join(" ") + " …" : noteText,
      at: spokenAt.toISOString(),
      review: [],
      ruleVersion: RULES_VERSION,
    });
  }

  return { proposals, normalized: text };
}

export { tokensInRange };
