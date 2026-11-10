/**
 * Test set: sccssar-style-v0.1 (REQ-010..016, HAZ-01, HAZ-02).
 * Each phrase states the entries the rules must propose. Run with TZ=UTC.
 */
import { describe, expect, it } from "vitest";
import data from "./fixtures/test-phrases.json";
import { extract, testEnv, type Proposal } from "../src/index.js";

interface Phrase {
  id: string;
  text: string;
  e: Record<string, unknown>[];
  clear?: boolean;
  noNote?: boolean;
  note?: string;
  review?: string[];
  at?: string;
}

const SPOKEN_AT = new Date("2026-12-16T19:05:00.000Z");

function partialMatch(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== "object") return actual === expected;
  if (typeof actual !== "object" || actual === null) return false;
  return Object.entries(expected as Record<string, unknown>).every(([k, v]) => partialMatch((actual as Record<string, unknown>)[k], v));
}

const hhmmUtc = (iso: string) => iso.slice(11, 16);

describe(`voice rules on ${data.set} (${data.phrases.length} phrases)`, () => {
  it("has about 100 phrases", () => {
    expect(data.phrases.length).toBeGreaterThanOrEqual(100);
  });

  for (const p of data.phrases as Phrase[]) {
    it(`${p.id}: "${p.text}"`, () => {
      const { proposals } = extract(p.text, SPOKEN_AT, testEnv());
      const nonNotes = proposals.filter((x) => x.entry.type !== "note");
      const notes = proposals.filter((x) => x.entry.type === "note");

      for (const exp of p.e) {
        const pool: Proposal[] = exp.type === "note" ? notes : nonNotes;
        const hit = pool.find((x) => partialMatch(x.entry, exp));
        expect(hit, `expected ${JSON.stringify(exp)} in ${JSON.stringify(proposals.map((x) => x.entry))}`).toBeDefined();
        if (p.at && hit) {
          if (exp.type === "time_found") expect(hhmmUtc((hit.entry as { time: string }).time)).toBe(p.at.slice(0, 5));
          else expect(hhmmUtc(hit.at)).toBe(p.at);
        }
      }
      if (p.clear) for (const x of nonNotes) expect(x.review, `${x.entry.type} should be clear`).toEqual([]);
      if (p.review) for (const t of p.review) expect(nonNotes.find((x) => x.entry.type === t)?.review.length ?? 0).toBeGreaterThan(0);
      if (p.noNote) expect(notes, `unexpected note: ${JSON.stringify(notes.map((n) => n.entry))}`).toHaveLength(0);
      if (p.note) expect(notes.map((n) => (n.entry as { text: string }).text.toLowerCase()).join(" ")).toContain(p.note.toLowerCase());
      for (const x of proposals) expect(x.quote.split(/\s+/).filter((w) => w !== "…").length).toBeLessThanOrEqual(15);
    });
  }
});

describe("HAZ-02: unclear drugs are never silently mapped", () => {
  it("sound-alike drugs off the list need a pick", () => {
    for (const word of ["naltrexone", "ephedrine", "hydroxyzine", "lorazepam"]) {
      const { proposals } = extract(`gave ${word} 2 milligrams`, SPOKEN_AT, testEnv());
      const med = proposals.find((x) => x.entry.type === "med");
      expect(med?.entry).toMatchObject({ drug: null });
      expect(med?.review.length).toBeGreaterThan(0);
    }
  });
});

describe("no spoken words are dropped", () => {
  it("unparsed words become the narrative note", () => {
    const { proposals } = extract("pulse 90 she looks pale and is shivering", SPOKEN_AT, testEnv());
    const note = proposals.find((x) => x.entry.type === "note");
    expect((note?.entry as { text: string }).text).toBe("she looks pale and is shivering");
  });
  it("quotes keep the original words, not normalized numbers", () => {
    const { proposals } = extract("pulse one twelve", SPOKEN_AT, testEnv());
    expect(proposals[0]!.quote).toBe("pulse one twelve");
  });
});
