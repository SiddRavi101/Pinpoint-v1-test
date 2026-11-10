import { DRUGS } from "./drugs.js";

/** Optimal string alignment distance (Damerau-Levenshtein with adjacent swaps). */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[m]![n]!;
}

export function similarity(a: string, b: string): number {
  const x = a.replace(/\s+/g, "");
  const y = b.replace(/\s+/g, "");
  if (x.length === 0 && y.length === 0) return 1;
  return 1 - editDistance(x, y) / Math.max(x.length, y.length);
}

export interface DrugMatch {
  /** Canonical name, set only when the match is clear. */
  drug: string | null;
  score: number;
  candidates: string[];
  /** "clear" | "unclear" (close to more than one, or not close enough) | "unknown" */
  status: "clear" | "unclear" | "unknown";
}

/** A clear match needs a high score and a margin over the next-closest drug. */
export const CLEAR_SCORE = 0.85;
export const CLEAR_MARGIN = 0.08;
export const CANDIDATE_SCORE = 0.55;

export function matchDrug(spoken: string): DrugMatch {
  const s = spoken.toLowerCase().trim();
  const scored = DRUGS.map((d) => ({
    name: d.name,
    score: Math.max(similarity(s, d.name), ...d.aliases.map((a) => similarity(s, a))),
  })).sort((p, q) => q.score - p.score);
  const best = scored[0]!;
  const second = scored[1];
  const candidates = scored.filter((x) => x.score >= CANDIDATE_SCORE).slice(0, 3).map((x) => x.name);
  if (best.score >= CLEAR_SCORE && (!second || best.score - second.score >= CLEAR_MARGIN)) {
    return { drug: best.name, score: best.score, candidates: [best.name], status: "clear" };
  }
  if (best.score >= CANDIDATE_SCORE) return { drug: null, score: best.score, candidates, status: "unclear" };
  return { drug: null, score: best.score, candidates: [], status: "unknown" };
}
