/**
 * Parses a spoken clock time at the start of `s` ("14:20", "1420 hours",
 * "2:20 pm", "220 pm", "at 9 05"). Returns the time on the same local day as
 * `ref`, plus how many characters were used.
 */
export function parseClock(s: string, ref: Date): { date: Date; length: number } | null {
  const patterns: RegExp[] = [
    /^(?:at\s+)?(\d{1,2}):(\d{2})(?:\s*(am|pm|a m|p m|hours))?\b/,
    /^(?:at\s+)?(\d{1,2})(\d{2})(?:\s*(am|pm|a m|p m|hours))?\b/,
    /^(?:at\s+)?(\d{1,2})\s+(\d{2})(?:\s*(am|pm|a m|p m|hours))?\b/,
    /^(?:at\s+)?(\d{1,2})()\s*(am|pm|a m|p m)\b/,
  ];
  for (const re of patterns) {
    const m = re.exec(s);
    if (!m) continue;
    let h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    const suffix = (m[3] ?? "").replace(/\s/g, "");
    if (suffix === "pm" && h < 12) h += 12;
    if (suffix === "am" && h === 12) h = 0;
    if (h > 23 || min > 59) continue;
    const d = new Date(ref);
    d.setHours(h, min, 0, 0);
    return { date: d, length: m[0].length };
  }
  return null;
}

/** Finds " at <clock>" anywhere in `s`. */
export function findAtClock(s: string, ref: Date): { date: Date; start: number; end: number } | null {
  const re = /\bat\s+\d/g;
  for (const m of s.matchAll(re)) {
    const start = m.index ?? 0;
    const c = parseClock(s.slice(start), ref);
    if (c) return { date: c.date, start, end: start + c.length };
  }
  return null;
}
