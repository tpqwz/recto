/** Word-list repairs for a text layer: hyphen choices, glued tokens, one-edit scraps. */

const PREFIXES = new Set(
  "self non pre anti well over under re co mid semi ill pro ex post inter trans sub super out up all cross neo pseudo bi tri fore counter".split(
    " ",
  ),
);
const STOP = new Set(
  "a an of to in is it or as be we he if on at by my no so do up the and for but not are was his her its you our she they them from with that this".split(
    " ",
  ),
);
const NEVER = new Set("antahkarana wesak arjuna buddha buddhas djwhal khul".split(" "));
const AFTER_I = new Set("nor am have shall will can must know was had".split(" "));
const COMMON = new Set(
  "man men god way day age sex law ray son end use let set may can did had has him her its own new old few now too nor mind life".split(" "),
);
const CONFUSABLE: Record<string, string> = {
  i: "l",
  l: "i",
  e: "c",
  c: "e",
  o: "e",
  a: "o",
  m: "n",
  n: "m",
  u: "v",
  v: "uy",
  y: "v",
  f: "t",
  t: "f",
  b: "h",
  h: "b",
};

export type WordList = { has: (word: string) => boolean };

let loading: Promise<WordList | null> | null = null;

export function loadLexicon(prefix = ""): Promise<WordList | null> {
  if (loading) return loading;
  loading = fetchLexicon(prefix).catch(() => null);
  return loading;
}

async function fetchLexicon(prefix: string): Promise<WordList | null> {
  const res = await fetch(`${prefix}/lexicon.txt.gz`);
  if (!res.ok) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  const text =
    buf[0] === 0x1f && buf[1] === 0x8b
      ? await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).text()
      : new TextDecoder().decode(buf);
  const words = new Set<string>();
  for (const word of text.split(/\s+/)) {
    if (word.length > 1 && word.length < 28) words.add(word);
  }
  if (words.size < 1000) return null;
  for (const word of STOP) words.add(word);
  return { has: (word) => words.has(word) };
}

function known(word: string, list: WordList) {
  return STOP.has(word) || list.has(word);
}

/** Enough of the line is English that an English word list may repair it. A line of Latin is not. */
export function readsEnglish(text: string, list: WordList) {
  const tokens = text.match(/\b[A-Za-z]{3,}\b/g) || [];
  if (tokens.length < 5) {
    const long = tokens.filter((token) => token.length >= 6);
    if (long.length < 2) return true;
    return long.some((token) => known(token.toLowerCase(), list));
  }
  let knownWords = 0;
  for (const token of tokens) if (known(token.toLowerCase(), list)) knownWords++;
  return knownWords / tokens.length >= 0.4;
}

export function mergeHyphen(prev: string, next: string, list: WordList, hyphens: { n: number }) {
  const match = next.match(/^([A-Za-z]+)([\s\S]*)$/);
  const lastMatch = prev.match(/([A-Za-z]+)-$/);
  if (!match || !lastMatch) return null;
  const suf = match[1];
  const rest = match[2];
  const last = lastMatch[1];
  const head = prev.slice(0, -last.length - 1);
  const concat = (last + suf).toLowerCase();
  if (list.has(concat) || NEVER.has(concat)) {
    hyphens.n++;
    return { head: head + last + suf, rest };
  }
  if (PREFIXES.has(last.toLowerCase()) && known(suf.toLowerCase(), list)) return { head: head + last + "-" + suf, rest };
  if (known(last.toLowerCase(), list) && known(suf.toLowerCase(), list) && last.length >= 3 && suf.length >= 4) {
    return { head: head + last + "-" + suf, rest };
  }
  return null;
}

function forceGlue(token: string, list: WordList) {
  const word = token.toLowerCase();
  if (NEVER.has(word) || list.has(word) || STOP.has(word)) return null;
  const lefts = ["and", "the", "was", "his", "her", "for", "but", "not", "are", "from", "with", "that", "this", "is", "of", "to", "in", "it", "or", "as", "be", "an", "on", "at", "by", "we", "he"];
  const rights = ["a", "an", "of", "to", "the", "and", "is"];
  for (const left of lefts) {
    if (!word.startsWith(left) || word.length <= left.length || word.length > 12) continue;
    const right = word.slice(left.length);
    if (rights.includes(right)) return [left, right];
  }
  return null;
}

function segmentToken(token: string, list: WordList) {
  if (!/^[A-Za-z]+$/.test(token)) return null;
  const lower = token.toLowerCase();
  if (list.has(lower) || STOP.has(lower) || NEVER.has(lower) || lower.length < 4 || lower.length > 28) return null;
  if (token === token.toUpperCase()) return null;
  const capital = /^[A-Z]/.test(token) && token.slice(1) === token.slice(1).toLowerCase();
  const stops = [...STOP].filter((word) => word.length >= 2).sort((a, b) => b.length - a.length);
  const cands: string[][] = [];
  const takeStops = (s: string, acc: string[]): string[] | null => {
    if (!s) return acc.length >= 2 ? acc : null;
    if (acc.length >= 4) return null;
    for (const word of stops) {
      if (!s.startsWith(word)) continue;
      const got = takeStops(s.slice(word.length), acc.concat(word));
      if (got) return got;
    }
    return null;
  };
  const onlyStops = takeStops(lower, []);
  if (onlyStops) cands.push(onlyStops);
  const part = (word: string) => {
    if (STOP.has(word)) return true;
    if (word.length < 3) return false;
    return list.has(word);
  };
  for (const word of stops) {
    if (!lower.startsWith(word) || lower.length === word.length) continue;
    const rest = lower.slice(word.length);
    if (part(rest)) cands.push([word, rest]);
  }
  for (let i = 2; i <= lower.length - 2; i++) {
    const a = lower.slice(0, i);
    const b = lower.slice(i);
    if (!part(a) || !part(b)) continue;
    if (STOP.has(a) || STOP.has(b) || (!capital && a.length >= 4 && b.length >= 4)) cands.push([a, b]);
  }
  for (let i = 2; i <= 4; i++) {
    const a = lower.slice(0, i);
    if (!STOP.has(a)) continue;
    for (let j = i + 2; j <= lower.length - 2; j++) {
      const b = lower.slice(i, j);
      const c = lower.slice(j);
      if (!part(b) || !part(c)) continue;
      const content = [b, c].filter((word) => !STOP.has(word));
      if (content.some((word) => word.length < 4 && !COMMON.has(word))) continue;
      cands.push([a, b, c]);
    }
  }
  if (token.startsWith("I") && AFTER_I.has(lower.slice(1))) cands.push(["I", lower.slice(1)]);
  if (!cands.length) return null;
  const score = (parts: string[]) => {
    const content = parts.filter((part) => part !== "I" && !STOP.has(part));
    let s = content.length ? 36 : 42;
    if (parts[0] === "I") s += 40;
    if (STOP.has(parts[0])) s += parts[0].length * 8;
    if (parts.length >= 2 && parts.every((word) => word === "I" || STOP.has(word))) s += 40;
    for (const part of content) {
      s += Math.min(part.length, 8) * 3 + part.length * part.length;
      if (COMMON.has(part)) s += 20;
      else if (part.length <= 3) s -= 36;
    }
    return s - parts.length;
  };
  let best: string[] | null = null;
  let bestScore = 49;
  const seen = new Set<string>();
  for (const parts of cands) {
    const key = parts.join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    const sc = score(parts);
    if (sc > bestScore) {
      bestScore = sc;
      best = parts;
    }
  }
  if (!best) return null;
  if (!capital) return best.join(" ");
  if (best[0] === "I") return `I ${best.slice(1).join(" ")}`;
  return best[0][0].toUpperCase() + best[0].slice(1) + (best.length > 1 ? ` ${best.slice(1).join(" ")}` : "");
}

function undoubled(token: string, list: WordList) {
  const lower = token.toLowerCase();
  if (lower.length < 6 || list.has(lower) || NEVER.has(lower)) return null;
  const hits = new Set<string>();
  for (let i = 1; i < lower.length; i++) {
    if (lower[i] !== lower[i - 1]) continue;
    const cand = lower.slice(0, i) + lower.slice(i + 1);
    if (list.has(cand)) hits.add(cand);
  }
  if (hits.size !== 1) return null;
  const fixed = [...hits][0];
  if (token === lower) return fixed;
  if (token[0] === token[0].toUpperCase() && token.slice(1) === lower.slice(1)) return fixed[0].toUpperCase() + fixed.slice(1);
  return null;
}

function isRomanNumeral(token: string) {
  return /^(?=[ivxlcdm]+$)m{0,4}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i.test(token);
}

/** Heading OCR, not a Latin line. Unknown tokens only, and a known word is left alone. */
const HEADING_ALT: Record<string, string> = { ...CONFUSABLE, e: "cr", k: "r", x: "n" };

function headingEdit(token: string, list: WordList) {
  const lower = token.toLowerCase();
  if (lower.length < 3 || lower.length > 24 || !/^[a-z]+$/.test(lower)) return null;
  if (isRomanNumeral(lower) || known(lower, list) || NEVER.has(lower)) return null;
  const hits = new Set<string>();
  for (let i = 0; i < lower.length; i++) {
    for (const alt of HEADING_ALT[lower[i]] || "") {
      const cand = lower.slice(0, i) + alt + lower.slice(i + 1);
      if (cand !== lower && known(cand, list)) hits.add(cand);
    }
  }
  if (hits.size !== 1) return null;
  const fixed = [...hits][0];
  // A three-letter name is one step from some other word. Only a function word is worth that.
  if (lower.length < 4 && !STOP.has(fixed)) return null;
  const titleCase = token[0] === token[0].toUpperCase() && token.slice(1) === lower.slice(1) && token !== token.toUpperCase();
  // "Tavi" and "Corab" are names. A long title-case token one OCR step from a single word is a scan.
  if (titleCase && !STOP.has(fixed) && lower.length < 6) return null;
  if (token === token.toLowerCase()) return fixed;
  if (token === token.toUpperCase()) return fixed.toUpperCase();
  if (token[0] === token[0].toUpperCase() && token.slice(1) === lower.slice(1)) return fixed[0].toUpperCase() + fixed.slice(1);
  return fixed;
}

export function repairHeading(text: string, list: WordList) {
  return text.replace(/[A-Za-z]+/g, (token) => headingEdit(token, list) || token);
}

/** One OCR step from a contents word toward the word printed in the chapter. Not the reverse. */
const STEP_ALT: Record<string, string> = { k: "r", r: "p", x: "n", e: "r", v: "y" };

export function headingStep(from: string, to: string) {
  const a = from.toLowerCase().replace(/[^a-z]/g, "");
  const b = to.toLowerCase().replace(/[^a-z]/g, "");
  if (!a || a.length !== b.length || a === b) return false;
  let diffs = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    diffs += 1;
    if (diffs > 1) return false;
    if (!(STEP_ALT[a[i]] || "").includes(b[i])) return false;
  }
  return diffs === 1;
}

/** The contents spelling and the heading differ only by letters a scan confuses, as c and e. */
export function confusableTwin(from: string, to: string) {
  const a = from.toLowerCase().replace(/[^a-z]/g, "");
  const b = to.toLowerCase().replace(/[^a-z]/g, "");
  if (a.length < 5 || a.length !== b.length || a === b) return false;
  let diffs = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    diffs += 1;
    if (!(CONFUSABLE[a[i]] || "").includes(b[i]) && !(CONFUSABLE[b[i]] || "").includes(a[i])) return false;
  }
  return diffs > 0;
}

function oneEdit(token: string, list: WordList) {
  const lower = token.toLowerCase();
  if (lower.length < 6 || lower.length > 24) return null;
  if (list.has(lower) || STOP.has(lower) || NEVER.has(lower)) return null;
  if (token !== token.toLowerCase() && !(token[0] === token[0].toUpperCase() && token.slice(1) === lower.slice(1))) return null;
  if (/ise$|ised$|ises$|ising$|isation$/.test(lower)) return null;
  const hits = new Set<string>();
  const consider = (cand: string) => {
    if (cand !== lower && list.has(cand)) hits.add(cand);
  };
  for (let i = 0; i < lower.length; i++) {
    for (const alt of CONFUSABLE[lower[i]] || "") consider(lower.slice(0, i) + alt + lower.slice(i + 1));
    if (i > 0 && lower[i] === lower[i - 1]) consider(lower.slice(0, i) + lower.slice(i + 1));
    if (i < lower.length - 1) consider(lower.slice(0, i) + lower[i + 1] + lower[i] + lower.slice(i + 2));
  }
  if (hits.size !== 1) return null;
  const fixed = [...hits][0];
  if (token === lower) return fixed;
  return fixed[0].toUpperCase() + fixed.slice(1);
}

export function repairText(s: string, list: WordList) {
  let t = s.replace(/\u00ad/g, "").replace(/[ \t]+/g, " ");
  t = t.replace(/([a-z])([A-Z])/g, "$1 $2");
  t = t.replace(/\s+([,.;:!?])/g, "$1");
  t = t.replace(/([.?!])([A-Za-z])/g, "$1 $2");
  t = t.replace(/\b(from|and|the|of|to|in|is|as|or|be)\.\s+([a-z])/g, "$1 $2");
  t = t
    .split(/(\s+)/)
    .map((tok) => {
      const match = tok.match(/^([^A-Za-z]*)([A-Za-z]+)([^A-Za-z]*)$/);
      if (!match) return tok;
      const core = match[2];
      const forced = forceGlue(core, list);
      const hyphenated = match[3].startsWith("-");
      let fixed = core;
      if (forced && !hyphenated) {
        fixed = /^[A-Z]/.test(core)
          ? forced[0][0].toUpperCase() + forced[0].slice(1) + " " + forced.slice(1).join(" ")
          : forced.join(" ");
      } else if (!hyphenated) fixed = undoubled(core, list) || segmentToken(core, list) || oneEdit(core, list) || core;
      return match[1] + fixed + match[3];
    })
    .join("");
  return t.replace(/[ \t]{2,}/g, " ").trim();
}
