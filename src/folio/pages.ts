/** Printed page labels read from the header and footer before those lines are dropped. */

export type PageLine = { text: string; y: number; page: number; pageH: number };

export type PrintedPages = {
  /** File page index to the label on the paper. Null when that page has no number. */
  label: (filePage: number) => number | string | null;
};

const ROMAN =
  /^(?=[ivxlcdm]+$)m{0,4}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i;

const ROMAN_VALUE: [number, string][] = [
  [1000, "m"],
  [900, "cm"],
  [500, "d"],
  [400, "cd"],
  [100, "c"],
  [90, "xc"],
  [50, "l"],
  [40, "xl"],
  [10, "x"],
  [9, "ix"],
  [5, "v"],
  [4, "iv"],
  [1, "i"],
];

function romanValue(token: string): number | null {
  const s = token.toLowerCase();
  if (!ROMAN.test(s)) return null;
  let value = 0;
  let i = 0;
  while (i < s.length) {
    const pair = ROMAN_VALUE.find(([, glyph]) => s.startsWith(glyph, i));
    if (!pair) return null;
    value += pair[0];
    i += pair[1].length;
  }
  return value >= 1 && value <= 400 ? value : null;
}

function toRoman(n: number) {
  let s = "";
  let left = n;
  for (const [value, glyph] of ROMAN_VALUE) {
    while (left >= value) {
      s += glyph;
      left -= value;
    }
  }
  return s;
}

type Cand = { kind: "arabic" | "roman"; value: number; weight: number };

function classify(token: string, whole: boolean): Cand | null {
  if (/^\d{1,4}$/.test(token)) {
    const n = Number(token);
    if (n < 1 || n > 4000) return null;
    if (n >= 1500 && n <= 2099) return null;
    return { kind: "arabic", value: n, weight: 0 };
  }
  const roman = romanValue(token);
  if (!roman) return null;
  if (token.length === 1 && !whole) return null;
  return { kind: "roman", value: roman, weight: 0 };
}

function clean(token: string) {
  return token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
}

function candidates(text: string): Cand[] {
  const t = text.trim();
  if (!t || t.length > 72) return [];
  const found: Cand[] = [];
  const add = (token: string, weight: number, whole: boolean) => {
    const cand = classify(clean(token), whole);
    if (cand) found.push({ ...cand, weight });
  };
  const slash = t.match(/^\W*(\d{1,4})\s*(?:\/|of)\s*\d{1,4}\W*$/i);
  if (slash) add(slash[1], 3, true);
  const pageWord = t.match(/\b(?:page|p)\.?\s*([0-9]{1,4}|[ivxlcdm]{1,8})\b/i);
  if (pageWord) add(pageWord[1], 3, false);
  add(t, 3, true);
  const parts = t.split(/\s+/);
  if (parts.length > 1 && !slash && !pageWord) {
    add(parts[0], 1, false);
    add(parts[parts.length - 1], 1, false);
  }
  return found;
}

function winningOffset(obs: { file: number; value: number; weight: number }[]) {
  const score = new Map<number, number>();
  const pages = new Map<number, Set<number>>();
  for (const ob of obs) {
    const offset = ob.file - ob.value;
    score.set(offset, (score.get(offset) || 0) + ob.weight);
    const set = pages.get(offset) || new Set<number>();
    set.add(ob.file);
    pages.set(offset, set);
  }
  let bestOff = 0;
  let bestScore = 0;
  let second = 0;
  let votes = 0;
  for (const [off, sc] of score) {
    if (sc > bestScore) {
      second = bestScore;
      bestScore = sc;
      bestOff = off;
      votes = pages.get(off)?.size || 0;
    } else if (sc > second) second = sc;
  }
  const confident = votes >= 2 && bestScore > second;
  return confident ? { offset: bestOff, votes } : null;
}

function filePagesOf(lines: PageLine[]) {
  const pages = new Set<number>();
  for (const ln of lines) pages.add(ln.page);
  return [...pages].sort((a, b) => a - b);
}

/** Page numbers that keep step with the file, even after they move from the footer to the header. */
function agreedArabic(obs: { file: number; value: number; weight: number }[]) {
  const byFile = new Map<number, { file: number; value: number; weight: number }[]>();
  for (const ob of obs) {
    const list = byFile.get(ob.file) || [];
    list.push(ob);
    byFile.set(ob.file, list);
  }
  const chosen: { file: number; value: number; weight: number }[] = [];
  for (const file of [...byFile.keys()].sort((a, b) => a - b)) {
    const options = byFile.get(file) || [];
    let best = options[0];
    let bestScore = -1;
    for (const ob of options) {
      let score = ob.weight;
      for (const other of obs) {
        if (other.file === file) continue;
        const fileGap = other.file - file;
        const valueGap = other.value - ob.value;
        if (fileGap === 0 || Math.abs(fileGap) > 12) continue;
        if (valueGap * fileGap > 0 && Math.abs(Math.abs(fileGap) - Math.abs(valueGap)) <= 2) score += other.weight;
      }
      if (score > bestScore) {
        bestScore = score;
        best = ob;
      }
    }
    if (bestScore >= best.weight + 2) chosen.push(best);
  }
  return chosen;
}

function paintArabic(labels: Map<number, number | string>, chosen: { file: number; value: number }[]) {
  const used = new Set([...labels.values()].map((label) => String(label)));
  const put = (file: number, value: number) => {
    if (value < 1 || labels.has(file)) return;
    const key = String(value);
    if (used.has(key)) return;
    used.add(key);
    labels.set(file, value);
  };
  for (let i = 0; i < chosen.length; i++) {
    const a = chosen[i];
    put(a.file, a.value);
    const b = chosen[i + 1];
    if (!b) continue;
    const fileGap = b.file - a.file;
    const valueGap = b.value - a.value;
    if (fileGap > 1 && fileGap < 12 && fileGap === valueGap) {
      for (let k = 1; k < fileGap; k++) put(a.file + k, a.value + k);
    }
  }
}

export function detectPrinted(lines: PageLine[]): PrintedPages {
  const files = filePagesOf(lines);
  const fallback: PrintedPages = { label: (filePage) => filePage };
  if (!files.length) return fallback;
  const arabicObs: { file: number; value: number; weight: number }[] = [];
  const romanObs: { file: number; value: number; weight: number }[] = [];
  const ownRoman = new Map<number, number>();
  for (const file of files) {
    const cands = lines
      .filter((ln) => ln.page === file && ln.text.length < 72 && (ln.y > ln.pageH - 72 || ln.y < 80))
      .flatMap((ln) => candidates(ln.text));
    const seen = new Set<string>();
    for (const cand of cands) {
      const key = `${cand.kind}:${cand.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (cand.kind === "arabic") arabicObs.push({ file, value: cand.value, weight: cand.weight });
      else {
        romanObs.push({ file, value: cand.value, weight: cand.weight });
        if (cand.weight >= 3) ownRoman.set(file, cand.value);
      }
    }
  }
  const arabic = winningOffset(arabicObs);
  const roman = winningOffset(romanObs);
  const labels = new Map<number, number | string>();
  const chosen = agreedArabic(arabicObs);
  if (chosen.length >= 4) {
    const first = chosen[0].file;
    const front = files.filter((file) => file < first);
    const frontRoman = winningOffset(romanObs.filter((ob) => front.includes(ob.file)));
    for (const file of front) {
      if (frontRoman) {
        const value = file - frontRoman.offset;
        if (value >= 1) labels.set(file, toRoman(value));
      } else {
        const value = ownRoman.get(file);
        if (value) labels.set(file, toRoman(value));
      }
    }
    paintArabic(labels, chosen);
  } else if (arabic) {
    const confirmed = arabicObs.filter((ob) => ob.file - ob.value === arabic.offset).map((ob) => ob.file);
    const first = Math.min(...confirmed);
    const last = Math.max(...confirmed);
    const front = files.filter((file) => file < first);
    const frontRoman = winningOffset(romanObs.filter((ob) => front.includes(ob.file)));
    for (const file of files) {
      if (file >= first && file <= last) {
        const printed = file - arabic.offset;
        if (printed >= 1) labels.set(file, printed);
        continue;
      }
      if (file > last) continue;
      if (frontRoman) {
        const value = file - frontRoman.offset;
        if (value >= 1) labels.set(file, toRoman(value));
      } else {
        const value = ownRoman.get(file);
        if (value) labels.set(file, toRoman(value));
      }
    }
  } else if (roman) {
    for (const file of files) {
      const value = file - roman.offset;
      if (value >= 1) labels.set(file, toRoman(value));
    }
  } else return fallback;

  const seen = new Set<string>();
  for (const label of labels.values()) {
    const key = String(label);
    if (seen.has(key)) return fallback;
    seen.add(key);
  }
  return { label: (filePage) => (labels.has(filePage) ? labels.get(filePage)! : null) };
}
