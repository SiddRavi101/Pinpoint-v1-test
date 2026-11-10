/**
 * Tokenizer with number-word normalization that keeps a map back to the
 * original words, so every card can show exactly what the medic said.
 */

export interface Token {
  /** Normalized form: lowercase, number words collapsed to digits. */
  norm: string;
  /** Character range in the original utterance. */
  origStart: number;
  origEnd: number;
}

export interface Tokenized {
  original: string;
  tokens: Token[];
  /** Tokens' norm joined by single spaces. */
  text: string;
  /** Start offset of each token in `text`. */
  offsets: number[];
}

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
};
const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

const isNumWord = (w: string) => w in UNITS || w in TEENS || w in TENS || w === "hundred";

/** Parses 0-99 from words like ["thirty", "five"], ["twelve"], ["seven"]. */
function parseSmall(words: string[]): number | null {
  if (words.length === 0) return null;
  const [a, b] = words;
  if (words.length === 1 && a !== undefined) {
    if (a in UNITS) return UNITS[a]!;
    if (a in TEENS) return TEENS[a]!;
    if (a in TENS) return TENS[a]!;
    return null;
  }
  if (words.length === 2 && a !== undefined && b !== undefined && a in TENS && b in UNITS && UNITS[b]! > 0) {
    return TENS[a]! + UNITS[b]!;
  }
  return null;
}

/** Parses an integer run of number words, including EMS-style "one thirty" = 130. */
export function parseNumberWords(words: string[]): number | null {
  if (words.length === 0) return null;
  const h = words.indexOf("hundred");
  if (h >= 0) {
    const head = words.slice(0, h).filter((w) => w !== "a");
    const hundreds = head.length === 0 ? 1 : parseSmall(head);
    if (hundreds === null || hundreds < 1 || hundreds > 9) return null;
    const rest = words.slice(h + 1).filter((w) => w !== "and");
    if (rest.length === 0) return hundreds * 100;
    const r = parseSmall(rest);
    return r === null ? null : hundreds * 100 + r;
  }
  const first = words[0]!;
  const second = words[1];
  // "one oh eight" = 108, "fourteen oh five" = 1405
  if (words.length === 3 && second === "oh" && words[2]! in UNITS) {
    if (first in UNITS && UNITS[first]! >= 1) return UNITS[first]! * 100 + UNITS[words[2]!]!;
    const left = parseSmall([first]);
    if (left !== null && left >= 10) return left * 100 + UNITS[words[2]!]!;
  }
  // "one twelve", "one thirty five", "two ten": hundreds spoken as a digit.
  if (words.length >= 2 && first in UNITS && UNITS[first]! >= 1 && second !== undefined && (second in TEENS || second in TENS)) {
    const r = parseSmall(words.slice(1));
    if (r !== null) return UNITS[first]! * 100 + r;
  }
  const small = parseSmall(words);
  if (small !== null) return small;
  // "fourteen twenty", "twenty two thirty": a clock time or two-part number.
  for (let i = 1; i < words.length; i++) {
    const left = parseSmall(words.slice(0, i));
    const right = parseSmall(words.slice(i));
    if (left !== null && right !== null && left >= 10 && right >= 10) return left * 100 + right;
  }
  return null;
}

const TOKEN_RE = /[A-Za-z0-9]+(?:[.:/'][A-Za-z0-9]+)*%?|%/g;

export function tokenize(original: string): Tokenized {
  const raw: Token[] = [];
  for (const m of original.matchAll(TOKEN_RE)) {
    const start = m.index ?? 0;
    raw.push({ norm: m[0].toLowerCase().replace(/'s$/, ""), origStart: start, origEnd: start + m[0].length });
  }

  // Collapse runs of number words into digit tokens.
  const tokens: Token[] = [];
  let i = 0;
  while (i < raw.length) {
    const t = raw[i]!;
    // Bare decimal: "point three" = 0.3
    if (t.norm === "point" && raw[i + 1] && raw[i + 1]!.norm in UNITS && !(raw[i - 1] && /^\d/.test(raw[i - 1]!.norm))) {
      let j = i + 1;
      let digits = "";
      while (raw[j] && raw[j]!.norm in UNITS) {
        digits += String(UNITS[raw[j]!.norm]);
        j++;
      }
      tokens.push({ norm: `0.${digits}`, origStart: t.origStart, origEnd: raw[j - 1]!.origEnd });
      i = j;
      continue;
    }
    // Digit followed by spoken decimal: "4 point 5"
    if (/^\d+$/.test(t.norm) && raw[i + 1]?.norm === "point" && raw[i + 2] && (raw[i + 2]!.norm in UNITS || /^\d$/.test(raw[i + 2]!.norm))) {
      let j = i + 2;
      let digits = "";
      while (raw[j] && (raw[j]!.norm in UNITS || /^\d$/.test(raw[j]!.norm))) {
        digits += raw[j]!.norm in UNITS ? String(UNITS[raw[j]!.norm]) : raw[j]!.norm;
        j++;
      }
      tokens.push({ norm: `${t.norm}.${digits}`, origStart: t.origStart, origEnd: raw[j - 1]!.origEnd });
      i = j;
      continue;
    }
    const startsRun =isNumWord(t.norm) || (t.norm === "a" && raw[i + 1]?.norm === "hundred");
    if (!startsRun) {
      tokens.push(t);
      i++;
      continue;
    }
    let j = i;
    const words: string[] = [];
    while (j < raw.length) {
      const w = raw[j]!.norm;
      const next = raw[j + 1]?.norm;
      const ohInside = w === "oh" && words.length > 0 && next !== undefined && next in UNITS;
      if (isNumWord(w) || ohInside || (w === "a" && next === "hundred") || (w === "and" && words.includes("hundred") && next !== undefined && isNumWord(next))) {
        words.push(w);
        j++;
      } else break;
    }
    // Optional decimal: "ninety eight point six".
    let decimal = "";
    if (raw[j]?.norm === "point" && raw[j + 1] && raw[j + 1]!.norm in UNITS) {
      j++;
      while (raw[j] && raw[j]!.norm in UNITS) {
        decimal += String(UNITS[raw[j]!.norm]);
        j++;
      }
    }
    const value = parseNumberWords(words);
    if (value === null) {
      // Not one number: convert each word on its own where possible.
      for (let k = i; k < i + words.length; k++) {
        const w = raw[k]!;
        const v = parseSmall([w.norm]);
        tokens.push({ ...w, norm: v === null ? w.norm : String(v) });
      }
      i += words.length;
      continue;
    }
    tokens.push({
      norm: decimal ? `${value}.${decimal}` : String(value),
      origStart: t.origStart,
      origEnd: raw[j - 1]!.origEnd,
    });
    i = j;
  }

  const offsets: number[] = [];
  let text = "";
  for (const tok of tokens) {
    if (text.length > 0) text += " ";
    offsets.push(text.length);
    text += tok.norm;
  }
  return { original, tokens, text, offsets };
}

/** Indexes of tokens whose start falls inside [start, end) of `text`. */
export function tokensInRange(tz: Tokenized, start: number, end: number): number[] {
  const out: number[] = [];
  tz.offsets.forEach((o, idx) => {
    if (o >= start && o < end) out.push(idx);
  });
  return out;
}

/** Original words for a normalized range, capped at `maxWords` words. */
export function originalQuote(tz: Tokenized, start: number, end: number, maxWords = 15): string {
  const idx = tokensInRange(tz, start, end);
  if (idx.length === 0) return "";
  const first = tz.tokens[idx[0]!]!;
  const last = tz.tokens[idx[idx.length - 1]!]!;
  const words = tz.original.slice(first.origStart, last.origEnd).split(/\s+/).filter(Boolean);
  return words.length > maxWords ? words.slice(0, maxWords).join(" ") + " …" : words.join(" ");
}
