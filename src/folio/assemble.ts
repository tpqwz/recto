import { strToU8, zipSync } from "fflate";
import { detectPrinted, type PrintedPages } from "./pages.ts";
import { headingStep, mergeHyphen, readsEnglish, repairHeading, repairText, type WordList } from "./repair.ts";
import { shapeLines, suppressTwins, untwinLine } from "./cases.ts";
import { lineScript, otherScriptText } from "./script.ts";

export type PageRun = { p: string };
export type Run = string | number | PageRun;
export type Block = {
  t: string;
  id?: string;
  s?: string;
  page?: number | string | null;
  /** File page in the retained original, when this block was read from one. */
  src?: number;
  kind?: string;
  runs?: Run[];
  n?: number;
  headers?: string[];
  rows?: string[][];
  section?: boolean;
};
export type TocNode = { id: string; label: string; page: number | string | null; children: TocNode[] };
export type Folio = {
  title: string;
  subtitle: string;
  author: string;
  stats: { hyphensRejoined: number; headersRemoved: number; chapters: number };
  toc: TocNode[];
  chapters: { id: string; title: string; page: number | string | null; blocks: Block[] }[];
  epubHref?: string;
  epubName?: string;
  warning?: string;
  rights?: string;
  origin?: { name: string; kind: "pdf" | "djvu" | "image" | "pages" | "text" };
  /** JPEG cover from the original file, base64 without a data-URL prefix. */
  cover?: string;
};
export type OutlineItem = { label: string; page: number | null; children: OutlineItem[]; printed?: number | string };
export type Line = {
  text: string;
  y: number;
  x0: number;
  x1: number;
  h: number;
  page: number;
  pageH: number;
  pageW: number;
  cells?: { text: string; x0: number; x1: number }[];
  table?: { headers: string[]; rows: string[][] };
  role?: "note";
};

export function runPage(run: Run): number | string | null {
  if (typeof run === "number") return run;
  if (typeof run === "object" && run && "p" in run) return run.p;
  return null;
}

function esc(s: string) {
  return s
    .replace(/&/g, "&" + "amp;")
    .replace(/</g, "&" + "lt;")
    .replace(/>/g, "&" + "gt;")
    .replace(/"/g, "&" + "quot;");
}

export function cluster(items: { str: string; transform: number[]; width?: number; height?: number; dir?: string }[]): { text: string; y: number; x0: number; x1: number; h: number; cells?: { text: string; x0: number; x1: number }[] }[] {
  const its = items
    .filter((it) => it.str && String(it.str).trim())
    .map((it) => ({
      str: tightenRtl(String(it.str).replace(/\u00ad/g, "")),
      x: it.transform[4],
      y: it.transform[5],
      w: it.width || 0,
      h: it.height || Math.abs(it.transform[3]) || 8,
      dir: it.dir,
    }));
  its.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; items: typeof its }[] = [];
  for (const it of its) {
    let placed = false;
    for (let i = lines.length - 1; i >= 0 && lines.length - i <= 6; i--) {
      const ln = lines[i];
      const dy = Math.abs(bodyY(ln.items) - it.y);
      // A scanned word often sits a few pixels off its baseline. A real next line is much farther.
      // A high mark must not drag that baseline, or the word under it starts a second line.
      if (dy > 4.8) continue;
      if (ln.items.some((o) => sameBandBlocks(o, it))) continue;
      if (dy > 3.2) {
        const x0 = Math.min(...ln.items.map((o) => o.x));
        const x1 = Math.max(...ln.items.map((o) => o.x + o.w));
        if (it.x + it.w < x0 - 14 || it.x > x1 + 14) continue;
        const lineH = ln.items.reduce((sum, o) => sum + (o.h || 0), 0) / ln.items.length;
        if (lineH > 0 && it.h < lineH * 0.55) continue;
      }
      ln.items.push(it);
      ln.y = ln.items.reduce((s, x) => s + x.y, 0) / ln.items.length;
      placed = true;
      break;
    }
    if (!placed) {
      const twin = lines.some(
        (ln) =>
          Math.abs(ln.y - it.y) <= 3.2 &&
          ln.items.some((o) => {
            const overlap = Math.min(o.x + o.w, it.x + it.w) - Math.max(o.x, it.x);
            return overlap > 2 && o.str.replace(/\s+/g, "") === it.str.replace(/\s+/g, "");
          }),
      );
      if (!twin) lines.push({ y: it.y, items: [it] });
    }
  }
  const open = lines.map((ln) => ({ y: ln.y, items: ln.items }));
  open.sort((a, b) => b.y - a.y);
  const skip = new Set<number>();
  const joined: { y: number; items: typeof its }[] = [];
  for (let i = 0; i < open.length; i++) {
    if (skip.has(i)) continue;
    let ln = open[i];
    for (let j = i + 1; j < open.length; j++) {
      if (skip.has(j)) continue;
      const other = open[j];
      if (bodyY(ln.items) - bodyY(other.items) > 4.8) break;
      if (!interleavedBaseline(ln.items, other.items)) continue;
      ln = {
        y: (ln.y * ln.items.length + other.y * other.items.length) / (ln.items.length + other.items.length),
        items: ln.items.concat(other.items),
      };
      skip.add(j);
    }
    joined.push(ln);
  }
  return joined
    .map((ln) => {
      ln.items.sort((a, b) => a.x - b.x);
      let text = "";
      let cellText = "";
      let cellX0 = ln.items[0].x;
      const cells: { text: string; x0: number; x1: number }[] = [];
      let prev: (typeof its)[number] | null = null;
      const pushCell = (x1: number) => {
        const piece = cellText.replace(/[ \t]+/g, " ").trim();
        if (piece) cells.push({ text: piece, x0: cellX0, x1 });
        cellText = "";
      };
      for (const it of ln.items) {
        let wide = false;
        if (prev) {
          const gap = it.x - (prev.x + prev.w);
          wide = gap > Math.max(14, Math.max(prev.h, it.h, 8) * 2.4);
          if (wide) {
            pushCell(prev.x + prev.w);
            cellX0 = it.x;
          }
          if (gap > Math.max(1.15, Math.max(prev.h, it.h, 8) * 0.12)) {
            text += " ";
            if (!wide && cellText) cellText += " ";
          }
        }
        text += it.str;
        cellText += it.str;
        prev = it;
      }
      if (prev) pushCell(prev.x + prev.w);
      const last = ln.items[ln.items.length - 1];
      const hs = ln.items.map((i) => i.h || 0).filter((h) => h > 0);
      const raw = text.replace(/[ \t]+/g, " ").trim();
      const reading = readRightToLeft(ln.items, raw);
      return {
        text: reading,
        y: ln.y,
        x0: ln.items[0].x,
        x1: last.x + last.w,
        h: hs.length ? median(hs) : 0,
        cells: reading === raw && cells.length >= 2 ? cells : undefined,
      };
    })
    .filter((ln) => (ln.text.match(/\p{L}|\p{N}/gu) || []).length > 0)
    .sort((a, b) => b.y - a.y || a.x0 - b.x0);
}

/** A mark extracted as its own letter is not a word break: "ל ֹא" is "לֹא". */
function tightenRtl(text: string) {
  if (!/\p{Script=Hebrew}|\p{Script=Arabic}/u.test(text)) return text;
  return text.replace(/ (?=\p{M})/gu, "");
}

/**
 * A right-to-left line is stored from the left. Put the words back in reading order.
 * Pieces of one word stay together. A line the file already stored left to right is left alone.
 */
function readRightToLeft(items: { str: string; x: number; w: number; h: number; dir?: string }[], raw: string) {
  const letters = raw.match(/\p{L}/gu) || [];
  if (letters.length < 8) return raw;
  let rtl = 0;
  for (const ch of letters) if (/\p{Script=Hebrew}|\p{Script=Arabic}/u.test(ch)) rtl += 1;
  if (rtl < 8 || rtl <= letters.length - rtl) return raw;
  const dirs = items.map((item) => item.dir).filter((dir): dir is string => !!dir);
  if (dirs.length && !dirs.some((dir) => dir === "rtl")) return raw;
  const spaced = (prev: { x: number; w: number; h: number }, it: { x: number; w: number; h: number }) =>
    it.x - (prev.x + prev.w) > Math.max(1.15, Math.max(prev.h, it.h, 8) * 0.12);
  const words: { text: string; rtl: boolean }[] = [];
  let buf = "";
  let bufRtl = false;
  const flush = () => {
    const text = buf.replace(/[ \t]+/g, " ").trim();
    if (text) words.push({ text, rtl: bufRtl });
    buf = "";
    bufRtl = false;
  };
  let prev: (typeof items)[number] | null = null;
  for (const it of items) {
    if (prev && spaced(prev, it)) flush();
    buf += it.str;
    if (/\p{Script=Hebrew}|\p{Script=Arabic}/u.test(it.str)) bufRtl = true;
    prev = it;
  }
  flush();
  const at: number[] = [];
  words.forEach((word, index) => {
    if (word.rtl) at.push(index);
  });
  if (at.length < 2) return raw;
  const next = words.slice();
  const flipped = [...at].reverse();
  at.forEach((index, place) => {
    next[index] = words[flipped[place]];
  });
  return next.map((word) => word.text).join(" ");
}

function bodyY(items: { str: string; y: number; h: number; w: number }[]) {
  const words = items.filter((item) => wordishGlyph(item));
  const used = words.length ? words : items;
  return used.reduce((sum, item) => sum + item.y, 0) / used.length;
}

function bandOverlap(a: { x: number; w: number }, b: { x: number; w: number }) {
  return Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
}

function wordishGlyph(g: { str: string; w: number }) {
  return (g.str.match(/[A-Za-z]/g) || []).length >= 2 && g.w > 6;
}

/** A quotation mark must not keep the word under it on a line of its own. */
function sameBandBlocks(a: { str: string; x: number; w: number }, b: { str: string; x: number; w: number }) {
  return bandOverlap(a, b) > 2 && wordishGlyph(a) && wordishGlyph(b);
}

/** Two pieces of one scanned line, split by a few pixels, with the words in each other's gaps. */
function interleavedBaseline(
  a: { str: string; x: number; w: number; h: number }[],
  b: { str: string; x: number; w: number; h: number }[],
) {
  const span = (items: { x: number; w: number }[]) => ({
    x0: Math.min(...items.map((o) => o.x)),
    x1: Math.max(...items.map((o) => o.x + o.w)),
  });
  const sa = span(a);
  const sb = span(b);
  const overlap = Math.min(sa.x1, sb.x1) - Math.max(sa.x0, sb.x0);
  const shorter = Math.min(sa.x1 - sa.x0, sb.x1 - sb.x0);
  if (overlap < 24 || overlap < shorter * 0.45) return false;
  const ha = median(a.map((o) => o.h).filter((h) => h > 0));
  const hb = median(b.map((o) => o.h).filter((h) => h > 0));
  if (Math.min(ha, hb) < Math.max(ha, hb) * 0.55) return false;
  const smaller = a.length <= b.length ? a : b;
  const larger = smaller === a ? b : a;
  if (smaller.some((it) => larger.some((o) => bandOverlap(o, it) > 2 && wordishGlyph(o) && wordishGlyph(it)))) return false;
  const longer = sa.x1 - sa.x0 >= sb.x1 - sb.x0 ? sa : sb;
  const inside = smaller.filter((it) => it.x >= longer.x0 - 8 && it.x <= longer.x1 + 8).length;
  return inside * 2 >= smaller.length;
}

function median(nums: number[]) {
  if (!nums.length) return 12;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function joinParagraph(group: Line[], hyphens: { n: number }, printed: PrintedPages, lexicon: WordList | null) {
  const runs: Run[] = [];
  let buf = "";
  let page = group[0].page;
  const flush = () => {
    const raw = mendCapsWords(buf.replace(/[ \t]+/g, " ").trim());
    const english = !lexicon || readsEnglish(raw, lexicon);
    const headingLine = group.every((line) => headingKind(line.text) || capsTitleLine(line.text));
    const t =
      lexicon && english && !headingLine && !otherScriptText(raw) ? repairText(raw, lexicon) : raw;
    if (t) runs.push(t);
    buf = "";
  };
  const mark = (file: number) => {
    const label = printed.label(file);
    if (label == null) return;
    const prev = runs.length ? runPage(runs[runs.length - 1]) : null;
    if (prev != null && String(prev) === String(label)) return;
    runs.push(typeof label === "number" ? label : { p: label });
  };
  for (const ln of group) {
    const piece = ln.text.trim();
    if (lexicon && /[A-Za-z]-$/.test(buf.trim()) && /^[a-z]/.test(piece)) {
      const merged = mergeHyphen(buf.trim(), piece, lexicon, hyphens);
      const split = piece.match(/^([a-z]+)([\s\S]*)$/);
      const englishSplit = !merged && !!split && readsEnglish(`${buf} ${piece}`, lexicon);
      if (englishSplit) hyphens.n++;
      const forced = englishSplit && split ? { head: buf.trim().replace(/-$/, "") + split[1], rest: split[2] } : merged;
      if (forced) {
        if (ln.page !== page && printed.label(ln.page) != null) {
          buf = forced.head.trim();
          flush();
          page = ln.page;
          mark(page);
          buf = (forced.rest || "").trim();
        } else {
          buf = `${forced.head}${forced.rest || ""}`.replace(/ +/g, " ").trim();
          page = ln.page;
        }
        continue;
      }
    }
    if (ln.page !== page) {
      if (printed.label(ln.page) == null) {
        buf = buf ? `${buf} ${piece}` : piece;
        page = ln.page;
        continue;
      }
      flush();
      page = ln.page;
      mark(page);
      buf = piece;
      continue;
    }
    if (!lexicon && /[A-Za-z]-$/.test(buf) && /^[a-z(]/.test(piece)) {
      buf = buf.replace(/-$/, "") + piece;
      hyphens.n++;
    } else buf = buf ? `${buf} ${piece}` : piece;
  }
  flush();
  return runs;
}

function normalizeOutline(items: OutlineItem[]) {
  const lifted = liftNestedChapters(items);
  const kept = lifted.filter((item) => item.label.trim() && (item.page || item.children.some((child) => child.page)));
  if (kept.length === 1 && kept[0].children.filter((child) => child.page).length >= 2) {
    return sortChapterItems(kept[0].children.filter((child) => child.page));
  }
  return sortChapterItems(kept.filter((item) => item.page));
}

/** Chapter bookmarks tucked under the last chapter are still chapters. */
function liftNestedChapters(items: OutlineItem[]): OutlineItem[] {
  const out: OutlineItem[] = [];
  for (const item of items) {
    const nested = item.children.filter((child) => chapterIndex(child.label));
    if (nested.length >= 4) {
      out.push(...liftNestedChapters(nested));
      out.push({ ...item, children: item.children.filter((child) => !chapterIndex(child.label)) });
    } else out.push(item);
  }
  return out;
}

function romanGlyph(n: number) {
  const values: [number, string][] = [
    [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
  ];
  let left = n;
  let out = "";
  for (const [value, glyph] of values) {
    while (left >= value) {
      out += glyph;
      left -= value;
    }
  }
  return left === 0 ? out : "";
}

function oneChange(a: string, b: string) {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) === 1;
}

/** "11." in a roman list is II when it has as many ones as the next number. "11" between 10 and 12 stays. */
function mendOnesRoman(hits: { title: string }[]) {
  const romanHeads = hits.filter((hit) => {
    const token = /^([ivxlcdm]{1,8})[.)]\s/i.exec(hit.title);
    return !!token && romanChapter(token[1]);
  }).length;
  if (romanHeads < 4) return;
  for (let i = 0; i < hits.length; i++) {
    const ones = /^(1{2,4})\s*[.)\u00b7·]\s+(\S.*)$/.exec(hits[i].title);
    if (!ones) continue;
    let prev = 0;
    for (let j = i - 1; j >= 0 && !prev; j--) {
      const token = /^([ivxlcdm]{1,8})[.)]\s/i.exec(hits[j].title);
      if (token) prev = romanChapter(token[1]) || 0;
    }
    if (!prev || ones[1].length !== prev + 1) continue;
    const glyph = romanGlyph(prev + 1);
    if (!glyph) continue;
    hits[i].title = `${glyph.toUpperCase()}. ${ones[2]}`;
  }
}
function alignRomanOutliers(items: OutlineItem[]) {
  const ordered = items
    .map((item) => ({ item, n: chapterIndex(item.label) }))
    .filter((entry): entry is { item: OutlineItem; n: number } => !!entry.n && !!entry.item.page)
    .sort((a, b) => (a.item.page || 0) - (b.item.page || 0));
  const fixes = new Map<OutlineItem, string>();
  for (let i = 1; i < ordered.length - 1; i++) {
    const prev = ordered[i - 1].n;
    const next = ordered[i + 1].n;
    const cur = ordered[i].n;
    const expect = prev + 1;
    if (cur === expect || next !== expect + 1) continue;
    const label = ordered[i].item.label;
    const token = /\b([ivxlcdm]{2,8})\b/i.exec(label);
    const want = romanGlyph(expect);
    if (!token || !want || !oneChange(token[1].toLowerCase(), want)) continue;
    const glyph = token[1] === token[1].toUpperCase() ? want.toUpperCase() : want;
    fixes.set(ordered[i].item, label.replace(token[1], glyph));
  }
  if (!fixes.size) return items;
  return items.map((item) => (fixes.has(item) ? { ...item, label: fixes.get(item) || item.label } : item));
}

function sortChapterItems(items: OutlineItem[]) {
  const aligned = alignRomanOutliers(items);
  const numbered = aligned.filter((item) => chapterIndex(item.label));
  if (numbered.length < 8) return aligned;
  const ordered = [...numbered].sort((a, b) => (chapterIndex(a.label) || 0) - (chapterIndex(b.label) || 0));
  const rest = aligned.filter((item) => !chapterIndex(item.label));
  const first = Math.min(...ordered.map((item) => item.page || Infinity));
  return [...rest.filter((item) => (item.page || Infinity) <= first), ...ordered, ...rest.filter((item) => (item.page || Infinity) > first)];
}

function outlineCoversStart(items: OutlineItem[]) {
  if (items.length < 2) return false;
  const nums = items.map((item) => chapterIndex(item.label)).filter((n): n is number => n != null);
  if (nums.length < 8) return true;
  return Math.min(...nums) <= 1;
}

const CONTENTS_HEAD = /^(?:the\s+)?(?:table\s+of\s+)?contents\b|^(?:list\s+of\s+)chapters\b/i;
const CONTENTS_ENTRY = /^(.{2,90}?)(?:(?:\s*[.\u00b7\u2026_]){2,}\s*|\s{2,})([0-9]{1,4}|[ivxlcdm]{1,8})\s*$/i;
const PAGE_TOKEN = /^([0-9]{1,4}|[ivxlcdm]{1,8})$/i;

/** A contents row: a title and a page, with or without dot leaders. A doubled row counts once. */
export function contentsEntry(line: { text: string; cells?: { text: string }[] }): { title: string; token: string; trusted?: boolean } | null {
  const cells = line.cells?.map((cell) => cell.text.replace(/\s+/g, " ").trim()).filter(Boolean);
  const pair = contentsPair(cells);
  if (pair) return pair;
  const text = untwinLine(line.text).replace(/\s+/g, " ").trim();
  if (!text || text.length > 180 || /©|®/.test(text)) return null;
  const romanItem = /^([IVXLCDM]{1,8})[.)]\s+(.+?)\s+([0-9]{1,4})\s*$/.exec(text);
  if (romanItem && romanChapter(romanItem[1])) {
    const title = tidyContentsTitle(romanItem[2]);
    if (title.length > 1) return { title: `${romanItem[1].toUpperCase()}. ${title}`, token: romanItem[3], trusted: true };
  }
  const romanOne = /^I[.)]\s+(.+?)\s+[il]\s*$/i.exec(text);
  if (romanOne) {
    const title = tidyContentsTitle(romanOne[1]);
    if (title.length > 1) return { title: `I. ${title}`, token: "1", trusted: true };
  }
  const numbered = /^(\d{1,3})\s*[.\u00b7]\s+([A-Za-z].{1,140}?)\s+([0-9]{1,4})$/.exec(text);
  if (numbered && !/[.?!]$/.test(numbered[2])) {
    const title = `${numbered[1]} · ${tidyContentsTitle(numbered[2])}`;
    return { title, token: numbered[3], trusted: true };
  }
  const preliminary = /^(\d{1,3})\s+([A-Z][^0-9©]{1,90}?)\s+([ivxlcdm]{1,8})$/i.exec(text);
  if (preliminary && preliminary[2].split(/\s+/).length <= 12 && !/[.?!]$/.test(preliminary[2])) {
    const name = tidyContentsTitle(preliminary[2]).replace(/\bB\s+C\s+E\b/g, "BCE").replace(/\bC\s+E\b/g, "CE");
    return { title: `${preliminary[1]} ${name}`, token: preliminary[3].toLowerCase(), trusted: true };
  }
  const front = /^([A-Z][A-Za-z'’.,\-]*(?:\s+[A-Za-z'’.,\-]+){0,7})\s+(?:page\s+)?([ivxlcdm]{1,8})$/.exec(text);
  if (front && !/[.?!]$/.test(front[1])) {
    const title = tidyContentsTitle(front[1]).replace(/\s+page$/i, "");
    return { title, token: front[2].toLowerCase(), trusted: true };
  }
  const dotted = CONTENTS_ENTRY.exec(text);
  if (dotted && /[A-Za-z]/.test(dotted[1])) {
    const title = tidyContentsTitle(dotted[1]);
    if (title.length > 1) return { title, token: dotted[2], trusted: /^(?:book|chapter|part)\b/i.test(title) };
  }
  const loose = /^(?:\d{1,3}[.)]\s+)?([A-Z].{1,140}?)\s+([0-9]{1,4})$/.exec(text);
  if (loose) {
    const title = tidyContentsTitle(loose[1]);
    if (title.length > 1 && !/[.?!]$/.test(title)) return { title, token: loose[2] };
  }
  return gluedPage(text);
}

/** "-87", "^1", ".122", and "lOI" are page numbers. A clean "12" is left to the parsers above. */
function gluedPage(text: string): { title: string; token: string; trusted?: boolean } | null {
  const parts = text.split(/\s+/);
  if (parts.length < 2) return null;
  const raw = parts[parts.length - 1];
  if (/^(?:\d{1,4}|[ivxlcdm]{1,8})$/i.test(raw)) return null;
  const token = pageToken(raw);
  if (!token) return null;
  const title = tidyContentsTitle(parts.slice(0, -1).join(" "));
  if (title.length < 2 || title.length > 90 || !/[A-Za-z]/.test(title)) return null;
  if (contentsSentence(title) && !/^(?:book|chapter|part)\b/i.test(title) && !contentsQuestion(title)) return null;
  return { title, token, trusted: /^(?:book|chapter|part|stave)\b/i.test(title) };
}

function contentsPair(cells: string[] | undefined): { title: string; token: string; trusted?: boolean } | null {
  if (!cells) return null;
  const usable = cells.length === 4 && cells[0] === cells[2] && cells[1] === cells[3] ? cells.slice(0, 2) : cells;
  if (usable.length !== 2 || !PAGE_TOKEN.test(usable[1]) || !/[A-Za-z]/.test(usable[0]) || usable[0].length > 90) return null;
  const title = tidyContentsTitle(usable[0].replace(/^[^A-Za-z0-9]+/, ""));
  if (title.length < 2 || /[.?!]$/.test(title)) return null;
  return { title, token: usable[1], trusted: /^(?:book|chapter|part)\b/i.test(title) };
}

/** Every title and page on a line. One line sometimes holds two columns, or the same entry twice. */
function allEntries(line: Line): { title: string; token: string; trusted?: boolean }[] {
  const paired = pairCells(line.cells);
  if (paired.length >= 2) return paired;
  const text = untwinLine(line.text).replace(/\s+/g, " ").trim();
  const dotted = text ? dottedEntries(text) : [];
  if (dotted.length >= 2) return dotted;
  const twoChapters = /\b(?:chapter|book)\s+\d+\b.*\b(?:chapter|book)\s+\d+\b/i.test(text);
  const one = contentsEntry(line);
  if (one && !twoChapters) return [one];
  if (dotted.length === 1 && !twoChapters) return dotted;
  if (!text || text.length > 600) return [];
  const found = splitNumberedLine(text);
  if (found.length === 1 && /^(?:chapter|book)\s*\d+\b/i.test(found[0].title)) return found;
  if (found.length < 2) return [];
  const chapters = found.filter((entry) => /^(?:chapter|book)\s+\d+\b/i.test(entry.title)).length;
  if (chapters >= 2) return found;
  const bare = text.replace(/[.\u00b7…_\s]/g, "").length;
  const covered = found.reduce((sum, entry) => sum + entry.title.replace(/\s/g, "").length + entry.token.length, 0);
  if (bare && covered < bare * 0.45) return [];
  return found;
}

/** A year inside a title is not the page, and neither is the number in "Chapter 12". */
function splitNumberedLine(text: string): { title: string; token: string }[] {
  const found: { title: string; token: string }[] = [];
  const pattern = /\b(\d{1,4}|[ivxlcdm]{1,8})\b/gi;
  let from = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const token = match[1];
    const raw = text.slice(from, match.index);
    const title = raw.replace(/[.\u00b7…_\s]+$/g, "").trim();
    if (/\b(?:chapter|book)\s*$/i.test(title)) continue;
    const digits = /^\d+$/.test(token) ? Number(token) : null;
    const rest = text.slice(match.index + token.length);
    if (digits != null && digits >= 1000 && (/\b(?:chapter|book)\s+\d+\b/i.test(rest) || /\b\d{1,4}\b/.test(rest))) continue;
    // A lone "I" is the pronoun, not page one. A real front-matter page is its own short line.
    if (/^[ivxlcdm]$/i.test(token)) continue;
    if (title.length < 3 || /[.?!]$/.test(title) || !/[A-Za-z]/.test(title)) {
      from = match.index + token.length;
      continue;
    }
    found.push({ title, token });
    from = match.index + token.length;
  }
  return found;
}

/** A contents row split into cells: title, page, title, page. */
function pairCells(cells: { text: string }[] | undefined): { title: string; token: string }[] {
  if (!cells || cells.length < 4) return [];
  const found: { title: string; token: string }[] = [];
  let title = "";
  for (const cell of cells) {
    const text = cell.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (PAGE_TOKEN.test(text) && title && /[A-Za-z]/.test(title) && title.length <= 90 && !/[.?!]$/.test(title)) {
      found.push({ title: title.replace(/[.\s]+$/g, "").trim(), token: text });
      title = "";
      continue;
    }
    if (PAGE_TOKEN.test(text)) continue;
    title = title ? `${title} ${text}` : text;
  }
  return found.length >= 2 ? found : [];
}

function dottedEntries(text: string): { title: string; token: string }[] {
  const found: { title: string; token: string }[] = [];
  const pattern = /([A-Za-z][^.]{2,80}?)\s*[.\u00b7…]{2,}\s*(\d{1,4}|[ivxlcdm]{1,8})\b/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const title = match[1].replace(/[.\s]+$/g, "").trim();
    if (title.length < 3 || /[.?!]$/.test(title)) continue;
    found.push({ title, token: match[2] });
  }
  return found;
}

function contentsPage(ordered: Line[]): Line | null {
  const byPage = new Map<number, Line[]>();
  for (const line of ordered) {
    if (line.page > 25) break;
    const list = byPage.get(line.page);
    if (list) list.push(line);
    else byPage.set(line.page, [line]);
  }
  for (const lines of byPage.values()) {
    const hits = lines.filter((line) => contentsEntry(line));
    if (hits.length >= 4) return hits[0];
  }
  return null;
}

function fileForLabel(printed: PrintedPages, token: string, maxPage: number) {
  const want = /^\d+$/.test(token) ? String(Number(token)) : token.toLowerCase();
  for (let file = 1; file <= maxPage; file++) {
    const label = printed.label(file);
    if (label != null && String(label).toLowerCase() === want) return file;
  }
  if (!/^\d+$/.test(token)) return null;
  const page = Number(token);
  const scores = new Map<number, number>();
  for (let file = 1; file <= maxPage; file++) {
    const label = printed.label(file);
    if (typeof label !== "number") continue;
    const offset = file - label;
    scores.set(offset, (scores.get(offset) || 0) + 1);
  }
  let bestOffset = 0;
  let best = 0;
  for (const [offset, count] of scores) {
    if (count > best) {
      best = count;
      bestOffset = offset;
    }
  }
  if (best < 2) return null;
  const file = page + bestOffset;
  if (file < 1 || file > maxPage) return null;
  return file;
}

function contentsQuestion(title: string) {
  const romanHead = /^([ivxlcdm]{1,8})[.)]\s+\S/i.exec(title);
  return !!romanHead && !!romanChapter(romanHead[1]) && /\?\s*$/.test(title) && !/[,;:]/.test(title);
}
function contentsSentence(text: string) {
  const title = text.replace(/\s+/g, " ").trim();
  if (!title) return false;
  if (/^[a-z]/.test(title)) return true;
  if (/[;?]/.test(title) || /[(){}[\]]/.test(title) || /,/.test(title)) return true;
  if (/!/.test(title) && title.split(/\s+/).length > 6) return true;
  const sentencePeriod = /([A-Za-z]{4,})\.\s+\S/.exec(title);
  if (sentencePeriod && !romanChapter(sentencePeriod[1])) return true;
  const small = new Set(["a", "an", "the", "and", "or", "but", "nor", "of", "in", "on", "at", "to", "for", "by", "as", "from", "with", "into", "over", "upon", "if", "so", "not", "no", "yes"]);
  const cores = title.split(/\s+/).map((word) => word.replace(/[^A-Za-z'’]/g, "")).filter((word) => word.length >= 2);
  if (cores.length > 0 && cores.every((word) => small.has(word.toLowerCase()))) return true;
  const verse = cores.filter((word) => /^[a-z]/.test(word) && word.length >= 4 && !small.has(word.toLowerCase())).length;
  return verse >= 2;
}

/** A contents title set in capitals, so a name the word list does not know can still be a chapter. */
function capsTitle(title: string) {
  const letters = title.replace(/[^A-Za-z]/g, "");
  return letters.length >= 3 && !/[a-z]/.test(title) && title.split(/\s+/).length <= 16;
}

function endsWithPage(text: string) {
  const parts = text.trim().split(/\s+/);
  return !!pageToken(parts[parts.length - 1] || "");
}

/** A page number with a dot, hyphen, or caret glued in front, or with l and O read as 1 and 0. "74" stays 74. "IV," is not a page. */
function pageToken(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^\d{1,4}$/.test(trimmed)) return trimmed;
  if (/^[ivxlcdm]{1,8}$/i.test(trimmed) && romanChapter(trimmed)) return trimmed.toLowerCase();
  const prefixed = /^[^A-Za-z0-9]+(\d{1,4}|[0-9ilILoO]{1,4})$/.exec(trimmed);
  if (prefixed) {
    const body = prefixed[1];
    if (/^\d{1,4}$/.test(body)) return body;
    if (/[oO]/.test(body)) {
      const folded = body.replace(/[ilIL]/g, "1").replace(/[oO]/g, "0");
      if (/^[1-9]\d{0,3}$/.test(folded)) return folded;
    }
  }
  if (/[oO]/.test(trimmed) && /^[0-9ilILoO]{1,4}$/.test(trimmed)) {
    const folded = trimmed.replace(/[ilIL]/g, "1").replace(/[oO]/g, "0");
    if (/^[1-9]\d{0,3}$/.test(folded)) return folded;
  }
  return null;
}

/** Several titles on the same page are a list. A sentence with a page number is not. */
function denseContents<T extends { file: number }>(hits: T[]) {
  const counts = new Map<number, number>();
  for (const hit of hits) counts.set(hit.file, (counts.get(hit.file) || 0) + 1);
  const keep = new Set<number>();
  for (const page of counts.keys()) {
    let near = 0;
    for (let n = page - 1; n <= page + 1; n++) near += counts.get(n) || 0;
    if (near >= 3) keep.add(page);
  }
  return hits.filter((hit) => keep.has(hit.file));
}

/**
 * A contents title often breaks onto the next, more indented line, and only that
 * line carries the page. Those pieces are one entry. A new title is not.
 */
function stitchContents(lines: Line[]): { text: string; lines: Line[] }[] {
  const groups: { text: string; lines: Line[] }[] = [];
  for (const line of lines) {
    const text = line.text.replace(/\s+/g, " ").trim();
    if (!text || CONTENTS_HEAD.test(text) || !/[A-Za-z]{3}/.test(text)) continue;
    const prev = groups[groups.length - 1];
    const last = prev?.lines[prev.lines.length - 1];
    const same = !!last && last.page === line.page;
    const indented = !!prev && same && !endsWithPage(prev.text) && line.x0 >= last.x0 + 6;
    const tail =
      !!prev &&
      same &&
      !endsWithPage(prev.text) &&
      endsWithPage(text) &&
      text.split(/\s+/).length <= 6 &&
      line.x0 + 8 >= last.x0;
    const newChapter =
      /^(?:chapter|book)\s+(?:[ivxlcdm]+|\d+)\b/i.test(text) ||
      /^\d{1,3}\s*[.\u00b7]\s+[A-Za-z]/.test(text) ||
      /^[ivxlcdm]{1,8}[.)]\s+[A-Za-z]/i.test(text);
    const chapterHead = !!prev && /^(?:chapter|book)\s+(?:[ivxlcdm]+|\d+)\b(?:\s+page)?\s*$/i.test(prev.text.trim());
    const hanging = !!prev && (/[-–—]$/.test(prev.text.trim()) || (prev.text.split(/\s+/).length >= 5 && text.split(/\s+/).length <= 8));
    if (prev && same && !contentsSentence(prev.text) && !newChapter && (chapterHead || (!endsWithPage(prev.text) && (indented || tail || hanging)))) {
      if (chapterHead) prev.text = prev.text.replace(/\s+page$/i, "");
      prev.text = `${prev.text} ${text}`.replace(/\s+/g, " ").trim();
      prev.lines.push(line);
      continue;
    }
    groups.push({ text, lines: [line] });
  }
  return groups;
}

function romanChapter(token: string): number | null {
  const s = token.toLowerCase();
  if (!/^(?=[ivxlcdm]+$)m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/.test(s)) return null;
  const values: [number, string][] = [
    [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
  ];
  let value = 0;
  let i = 0;
  while (i < s.length) {
    const pair = values.find(([, glyph]) => s.startsWith(glyph, i));
    if (!pair) return null;
    value += pair[0];
    i += pair[1].length;
  }
  return value >= 1 && value <= 80 ? value : null;
}

function tidyContentsTitle(title: string) {
  let t = title
    .replace(/([A-Za-z])- ([a-z])/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
  // A tail of scan marks is not part of the title. A real bang or question is.
  t = t.replace(/(\p{L})([^\p{L}\p{N}]*)$/u, (full, letter: string, junk: string) => {
    const kept = junk.match(/^['’]*[!?]+['’"]*/);
    const rest = kept ? junk.slice(kept[0].length) : junk;
    if (rest && !/^[\s.'’"“”‘’«»·…•*\-–—^\\]+$/.test(rest)) return full;
    return letter + (kept ? kept[0] : "");
  });
  return t.replace(/[\s.,·…«»\-]+$/g, "").trim();
}

function untitledChapter(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  const match = /^(?:chapter|book)\s*(\d+)\b\s*(.*)$/i.exec(clean);
  if (!match || endsWithPage(clean)) return "";
  const rest = match[2].replace(/[.\s]+$/g, "").trim();
  return `Chapter ${match[1]}${rest ? ` ${rest}` : ""}`;
}

/** "Chapters" and "Chapter So" are a misread number when the neighbors are one apart. */
function repairChapterLabels(groups: { text: string }[]) {
  const nums = groups.map((group) => chapterIndex(group.text));
  for (let i = 0; i < groups.length; i++) {
    if (nums[i]) continue;
    if (!/^chapter/i.test(groups[i].text)) continue;
    const prev = [...nums.slice(0, i)].reverse().find((n) => n);
    const next = nums.slice(i + 1).find((n) => n);
    if (!prev || next !== prev + 2) continue;
    const fixed = prev + 1;
    if (/^chapter\s+[a-z]+\b/i.test(groups[i].text)) groups[i].text = groups[i].text.replace(/^chapter\s+[a-z]+\b/i, `Chapter ${fixed}`);
    else groups[i].text = groups[i].text.replace(/^chapters?\b/i, `Chapter ${fixed}`);
    nums[i] = fixed;
  }
}

function placeMissingPages(hits: { title: string; page: number }[]) {
  const known = hits.filter((hit) => hit.page > 0 && chapterIndex(hit.title));
  if (!known.length) return;
  let last = 0;
  for (const hit of hits) if (hit.page > last) last = hit.page;
  for (const hit of hits) {
    if (hit.page > 0) continue;
    const n = chapterIndex(hit.title);
    if (!n) {
      hit.page = ++last;
      continue;
    }
    const before = known.filter((item) => (chapterIndex(item.title) || 0) < n).sort((a, b) => (chapterIndex(a.title) || 0) - (chapterIndex(b.title) || 0));
    const after = known.filter((item) => (chapterIndex(item.title) || 0) > n).sort((a, b) => (chapterIndex(a.title) || 0) - (chapterIndex(b.title) || 0));
    const prev = before[before.length - 1];
    const next = after[0];
    if (prev && next && next.page > prev.page + 1) hit.page = Math.round((prev.page + next.page) / 2);
    else if (next && next.page > 1) hit.page = next.page - 1;
    else if (prev) hit.page = prev.page + 1;
    else hit.page = 1;
    known.push(hit);
  }
}

function attachGapTitles(hits: { title: string }[]) {
  const nums = hits.map((hit) => chapterIndex(hit.title));
  for (let i = 0; i < hits.length; i++) {
    if (nums[i]) continue;
    const prev = [...nums.slice(0, i)].reverse().find((n) => n);
    const next = nums.slice(i + 1).find((n) => n);
    if (!prev || next !== prev + 2) continue;
    if (hits[i].title.length > 90 || /[.?!]/.test(hits[i].title)) continue;
    if (/^c\W*h?apter\b/i.test(hits[i].title) && hits[i].title.length < 24) continue;
    hits[i].title = `Chapter ${prev + 1} ${hits[i].title}`;
    nums[i] = prev + 1;
  }
}

function contentsOutline(lines: Line[], printed: PrintedPages, lexicon: WordList | null): { items: OutlineItem[]; drop: Set<Line> } {
  const empty = { items: [] as OutlineItem[], drop: new Set<Line>() };
  const ordered = [...lines].sort((a, b) => a.page - b.page || b.y - a.y);
  const maxPage = ordered.reduce((n, line) => Math.max(n, line.page), 1);
  type Hit = { line: Line; title: string; page: number; file: number; printed?: number | string };
  const hits: Hit[] = [];
  const head = ordered.find((line) => line.page <= 40 && CONTENTS_HEAD.test(line.text.trim()));
  const span = head ? { start: head.page, end: head.page + 36 } : null;
  const inSpan = (line: Line) => !!span && line.page >= span.start && line.page <= span.end;
  const stitched = span ? stitchContents(ordered.filter(inSpan)) : [];
  const consider = (line: Line, raw: string, joined: boolean) => {
    const text = raw.replace(/\s+/g, " ").trim().replace(/^[^A-Za-z0-9]+/, "");
    const found = allEntries({ ...line, text });
    if (!found.length) {
      const titled = joined ? untitledChapter(text) : "";
      if (titled) hits.push({ line, title: spaceChapter(titled), page: 0, file: line.page });
      else if (/^(?:bibliography|index|glossary)\b/i.test(text) && text.length < 40) {
        hits.push({ line, title: text.replace(/\s+/g, " ").trim(), page: 0, file: line.page });
      } else {
        const roman = /^(?:chapter|book)\s+([ivxlcdm]+)\b\s*(.*)$/i.exec(text);
        const n = roman ? romanChapter(roman[1]) : null;
        if (n && text.length < 180) {
          const kept = text.replace(/\s*(?:[.\u00b7…_]+\s*)+\d+\s*$/g, "").replace(/\s+\d+\s*$/g, "").trim();
          const rest = tidyContentsTitle((roman?.[2] || "").replace(/\s+\S{1,4}$/g, ""));
          hits.push({ line, title: kept || `Chapter ${n}${rest ? ` ${rest}` : ""}`, page: 0, file: line.page });
        }
      }
      return;
    }
    for (const entry of found) {
      entry.title = tidyContentsTitle(entry.title.replace(/^[^A-Za-z0-9]+/, ""));
      if (entry.title.length < 2 || /©|®/.test(entry.title)) continue;
      if (contentsSentence(entry.title) && !/^(?:book|chapter|part)\b/i.test(entry.title) && !contentsQuestion(entry.title)) continue;
      if (!entry.trusted && /^(?:book|chapter|part)\b/i.test(entry.title)) entry.trusted = true;
      if (!entry.trusted) {
        const romanHead = /^([ivxlcdm]{1,8})[.)]\s+\S/i.exec(entry.title);
        if (romanHead && romanChapter(romanHead[1])) entry.trusted = true;
      }
      if (!entry.trusted && capsTitle(entry.title)) entry.trusted = true;
      if (lexicon && !entry.trusted && !knownTitle(entry.title, lexicon)) continue;
      const page = fileForLabel(printed, entry.token, maxPage);
      if (page === line.page) continue;
      if (!page) {
        if (chapterIndex(entry.title)) hits.push({ line, title: spaceChapter(entry.title.slice(0, 180)), page: 0, file: line.page });
        continue;
      }
      hits.push({
        line,
        title: spaceChapter(entry.title.slice(0, 180)),
        page,
        file: line.page,
        printed: /^\d+$/.test(entry.token) ? Number(entry.token) : entry.token.toLowerCase(),
      });
    }
  };
  repairChapterLabels(stitched);
  for (const group of stitched) consider(group.lines[0], group.text, group.lines.length > 1);
  if (!span) {
    for (const line of ordered) consider(line, line.text, false);
  }
  const crowded = denseContents(hits);
  hits.length = 0;
  hits.push(...crowded);
  mendOnesRoman(hits);
  alignRomanOutliers(hits.map((hit, index) => ({ label: hit.title, page: index + 1, children: [] }))).forEach((item, index) => {
    if (item.label !== hits[index].title) hits[index].title = item.label;
  });
  placeMissingPages(hits);
  attachGapTitles(hits);
  const orderedHits = orderContentsHits(hits);
  const numbered = chapterContents(orderedHits);
  const runs: Hit[][] = [];
  if (!numbered) {
  for (let i = 0; i < orderedHits.length; i++) {
    const run: Hit[] = [];
    let last = 0;
    for (let j = i; j < orderedHits.length && orderedHits[j].file <= orderedHits[i].file + 36; j++) {
      if (orderedHits[j].page < last) continue;
      if (run.some((item) => item.title === orderedHits[j].title)) continue;
      run.push(orderedHits[j]);
      last = orderedHits[j].page;
    }
    const pages = new Set(run.map((item) => item.page));
    if (run.length >= 3 && pages.size >= 2) runs.push(run);
  }
  if (!runs.length) return empty;
  }
  const front = runs.filter((run) => run[0].file <= Math.max(30, maxPage * 0.35));
  const pool = front.length ? front : runs;
  const best = numbered || pool.reduce((a, b) => (b.length > a.length ? b : a));
  const drop = new Set(best.map((item) => item.line));
  const files = new Set(best.map((item) => item.file));
  for (const line of ordered) {
    if (!files.has(line.page)) continue;
    const text = line.text.trim();
    if (CONTENTS_HEAD.test(text) || /^index$/i.test(text)) drop.add(line);
  }
  const anchored = best.filter((item) => item.page > 0);
  if (anchored.length < 3 || new Set(anchored.map((item) => item.page)).size < 2) return { items: [], drop };
  const items = anchored.slice(0, 400).map((item) => ({
    label: unglueSmall(mendHead(item.title)),
    page: item.page,
    children: [] as OutlineItem[],
    ...(item.printed != null ? { printed: item.printed } : {}),
  }));
  if (catalogContents(items, ordered)) return { items: [] as OutlineItem[], drop: new Set<Line>() };
  snapToHeading(items, ordered);
  return { items, drop };
}

/** A contents page that never opens its chapter. The heading further on is the start. */
function snapToHeading(items: OutlineItem[], lines: Line[]) {
  const pages = items.map((item) => item.page || 0).filter((page) => page > 0).sort((a, b) => a - b);
  const mark = (text: string, index: number) => {
    if (chapterIndex(text) !== index) return false;
    const title = text.replace(/\s+/g, " ").trim();
    if (title.length > 80) return false;
    return chapterMarkLine(title) || chapterLabel(title) || chapterish(title);
  };
  for (const item of items) {
    const index = chapterIndex(item.label);
    const page = item.page || 0;
    if (!index || !page || titleOpens(item.label, page, lines)) continue;
    if (lines.some((line) => line.page >= page - 1 && line.page <= page + 2 && mark(line.text, index))) continue;
    const next = pages.find((start) => start > page + 2) ?? page + 48;
    let found = 0;
    for (const line of lines) {
      if (line.page <= page + 2 || line.page >= next) continue;
      if (!mark(line.text, index)) continue;
      if (!found || line.page < found) found = line.page;
    }
    if (found) item.page = found;
  }
}

function oneWordTitle(label: string) {
  const words = label.replace(/['’".]+/g, "").trim().split(/\s+/).filter(Boolean);
  if (words.length !== 1 || words[0].length > 12 || !/^[A-Za-z]+$/.test(words[0])) return false;
  return !/^(?:preface|index|bibliography|notes|introduction|contents|glossary|appendix|prologue|epilogue|foreword)$/i.test(words[0]);
}

function titleOpens(label: string, page: number, lines: Line[]) {
  const want = [...new Set(label.toLowerCase().match(/[a-z]{4,}/g) || [])];
  const index = chapterIndex(label);
  const near = lines.filter((line) => line.page >= page - 1 && line.page <= page + 2 && line.text.length <= 160);
  if (index) {
    for (const line of near) if (chapterIndex(line.text) === index) return true;
  }
  if (!want.length) return false;
  for (const line of near) {
    const have = new Set(line.text.toLowerCase().match(/[a-z]{4,}/g) || []);
    let hit = 0;
    for (const word of want) if (have.has(word)) hit++;
    const enough = want.length === 1 ? hit === 1 && line.text.length <= 80 : hit >= Math.min(2, want.length) && hit * 2 >= want.length;
    if (enough) return true;
  }
  return false;
}

/** A one-word scrap from a publisher's list is not a chapter when the pages it names never open that way. */
function catalogContents(items: OutlineItem[], lines: Line[]) {
  if (!items.some((item) => oneWordTitle(item.label))) return false;
  let opened = 0;
  for (const item of items) if (item.page && titleOpens(item.label, item.page, lines)) opened++;
  return opened < 3 && opened * 2 < items.length;
}

function normTitle(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function titleLike(text: string) {
  const title = normTitle(text);
  if (title.length < 4 || title.length > 72) return false;
  if (/[.?!]["']?$/.test(title)) return false;
  if (!/[A-Za-z]{3}/.test(title)) return false;
  if (/^\d+$/.test(title)) return false;
  return (title.match(/ /g) || []).length <= 12;
}

/**
 * A contents list of titles, with no page numbers. A title counts only when the
 * same line begins a later page. A numbered contents list never comes here.
 */
function titleOutline(lines: Line[]): { items: OutlineItem[]; drop: Set<Line> } {
  const ordered = [...lines].sort((a, b) => a.page - b.page || b.y - a.y);
  const empty = { items: [] as OutlineItem[], drop: new Set<Line>() };
  const byPage = new Map<number, Line[]>();
  for (const line of ordered) {
    if (line.page > 20) break;
    const list = byPage.get(line.page);
    if (list) list.push(line);
    else byPage.set(line.page, [line]);
  }
  let best: Line[] = [];
  let bestPage = 0;
  for (const [page, list] of byPage) {
    const titles = list.filter((line) => titleLike(line.text));
    if (titles.length < 5 || titles.length < list.length * 0.45) continue;
    if (titles.length > best.length) {
      best = titles;
      bestPage = page;
    }
  }
  if (!best.length) return empty;
  const seen = new Set<string>();
  const titles: { key: string; label: string }[] = [];
  for (const line of best) {
    const label = normTitle(line.text);
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    titles.push({ key, label });
  }
  const items: OutlineItem[] = [];
  for (const title of titles) {
    const hit = ordered.find((line) => line.page > bestPage && normTitle(line.text).toLowerCase() === title.key);
    if (!hit) continue;
    const prev = items[items.length - 1];
    if (prev && hit.page < (prev.page || 0)) continue;
    items.push({ label: title.label.slice(0, 180), page: hit.page, children: [] });
  }
  const pages = new Set(items.map((item) => item.page));
  if (items.length < 4 || pages.size < 2 || items.length < titles.length * 0.5) return empty;
  return { items, drop: new Set(best) };
}

/** Lines of a printed contents list, so they are not left in the reading text. */
function printedContentsLines(lines: Line[]) {
  const ordered = [...lines].sort((a, b) => a.page - b.page || b.y - a.y);
  const head = ordered.find((ln) => ln.page <= 30 && CONTENTS_HEAD.test(ln.text.trim()));
  const start = head || contentsPage(ordered);
  if (!start) return new Set<Line>();
  const drop = new Set<Line>([start]);
  let kept = 0;
  let misses = 0;
  for (const ln of ordered) {
    if (ln.page < start.page || ln.page > start.page + 36) continue;
    if (ln === start || (ln.page === start.page && ln.y >= start.y)) continue;
    const text = ln.text.trim();
    if (!text) continue;
    if (CONTENTS_HEAD.test(text) || contentsEntry(ln)) {
      drop.add(ln);
      kept++;
      misses = 0;
      continue;
    }
    if (kept) misses++;
    if (kept >= 3 && misses >= 3) break;
  }
  return kept >= 3 ? drop : new Set<Line>();
}

function blockText(block: Block) {
  if ((block.t === "h1" || block.t === "h2") && block.s) return block.s;
  return (block.runs || [])
    .filter((run): run is string => typeof run === "string")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function isPrintedContents(text: string) {
  const line = text.replace(/\s+/g, " ").trim();
  return CONTENTS_HEAD.test(line) || !!contentsEntry({ text: line });
}

/** A linked contents page, as in the sample editions, in place of the printed list. */
function presentContents(chapters: Folio["chapters"]): Folio["chapters"] {
  const cleaned = chapters
    .map((chapter) => ({
      ...chapter,
      blocks: chapter.blocks.filter((block) => block.t === "h1" || block.t === "h2" || !isPrintedContents(blockText(block))),
    }))
    .filter((chapter) => {
      const body = chapter.blocks.some((block) => block.t !== "h1" && block.t !== "h2");
      if (chapter.title === "Front matter" || CONTENTS_HEAD.test(chapter.title)) return body;
      return chapter.blocks.length > 0;
    });
  if (cleaned.length < 2 || cleaned.some((chapter) => chapter.id === "contents")) return cleaned;
  const dotted = cleaned.filter((chapter) => /^\d{1,3}\s*·\s+\S/.test(chapter.title)).length >= 8;
  let n = 0;
  const entries: Block[] = [{ t: "h1", id: "contents", s: "Contents" }];
  for (const chapter of cleaned) {
    const front = chapter.title === "Front matter";
    if (!dotted && !front) n += 1;
    entries.push({ t: "toc-entry", id: chapter.id, n: dotted || front ? undefined : n, s: chapter.title, page: chapter.page });
    for (const block of chapter.blocks) {
      if (block.t !== "h2" || !block.id || !block.s || block.s === chapter.title) continue;
      entries.push({ t: "toc-entry", id: block.id, s: block.s, page: block.page, kind: "section" });
    }
  }
  return [{ id: "contents", title: "Contents", page: null, blocks: entries }, ...cleaned];
}

function slug(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "section"
  );
}

function chapterHtml(blocks: Block[], hrefFor?: (id: string) => string) {
  const parts: string[] = [];
  const seen = new Set<string>();
  const pages: string[] = [];
  const mark = (page?: number | string | null) => {
    if (page == null || page === "") return;
    const label = String(page);
    if (seen.has(label)) return;
    seen.add(label);
    pages.push(label);
    parts.push(
      `<span epub:type="pagebreak" id="page-${esc(label)}" role="doc-pagebreak" aria-label="${esc(label)}" title="${esc(label)}"></span>`,
    );
  };
  for (const b of blocks) {
    if (b.t === "h1" || b.t === "h2") {
      mark(b.page);
      parts.push(`<${b.t} id="${esc(b.id || "")}">${esc(b.s || "")}</${b.t}>`);
    } else if (b.t === "toc-entry") {
      const id = b.id || (b.n ? `c${String(b.n).padStart(2, "0")}` : "");
      const href = hrefFor ? hrefFor(id) : `#${id}`;
      const label = b.n ? `${b.n}. ${b.s || ""}` : b.s || "";
      const page = b.page != null && b.page !== "" ? ` <span>${esc(String(b.page))}</span>` : "";
      parts.push(`<p class="tocline${b.kind === "section" ? " section" : ""}"><a href="${esc(href)}">${esc(label)}</a>${page}</p>`);
    } else if (b.t === "table") {
      mark(b.page);
      const head = (b.headers || []).map((cell) => `<th>${esc(cell)}</th>`).join("");
      const body = (b.rows || []).map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`).join("");
      parts.push(`<table>${head ? `<thead><tr>${head}</tr></thead>` : ""}<tbody>${body}</tbody></table>`);
    } else if (b.t === "p") {
      mark(b.page);
      const inner = (b.runs || [])
        .map((run) => {
          const label = runPage(run);
          if (label == null) return esc(String(run));
          const key = String(label);
          if (seen.has(key)) return "";
          seen.add(key);
          pages.push(key);
          return `<span epub:type="pagebreak" id="page-${esc(key)}" role="doc-pagebreak" aria-label="${esc(key)}" title="${esc(key)}"></span>`;
        })
        .join("");
      parts.push(`<p${b.kind === "note" ? ' class="note"' : ""}>${inner}</p>`);
    }
  }
  return { html: parts.join("\n"), pages };
}

function epubBlob(folio: Folio, sourceName: string) {
  const zipped = epubArchive(folio, sourceName);
  const blob = new Blob([zipped], { type: "application/epub+zip" });
  if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") return URL.createObjectURL(blob);
  return "";
}

function decode64(data: string) {
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The EPUB bytes, including a cover image when the file had one. */
export function epubArchive(folio: Folio, sourceName: string) {
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
  };
  const put = (name: string, text: string) => {
    files[name] = strToU8(text);
  };
  const cover = folio.cover ? decode64(folio.cover) : null;
  if (cover) files["OEBPS/cover.jpg"] = cover;
  put(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );
  put(
    "OEBPS/style.css",
    `body{font-family:Georgia,Palatino,serif;line-height:1.5;margin:0;padding:0 6%;color:#1c1915}h1,h2{font-weight:normal}h1{text-align:center}p{margin:0 0 .2em;text-indent:1.15em}p.noindent{text-indent:0}p.tocline{text-indent:0;margin:0.35em 0}p.tocline a{color:inherit;text-decoration:none}p.section{padding-left:1.2em}img.cover{display:block;width:100%;height:auto}`,
  );
  const manifest: string[] = [];
  const spine: string[] = [];
  if (cover) {
    put(
      "OEBPS/cover.xhtml",
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en"><head><meta charset="utf-8"/><title>${esc(folio.title)}</title><link rel="stylesheet" href="style.css"/></head><body style="margin:0;padding:0"><img class="cover" src="cover.jpg" alt="${esc(folio.title)}"/></body></html>`,
    );
    manifest.push(`<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`);
    manifest.push(`<item id="cover-image" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>`);
    spine.push(`<itemref idref="cover"/>`);
  }
  const pageLinks: { label: string; href: string; front: boolean }[] = [];
  const usedPages = new Set<string>();
  const hrefFor = (id: string) => {
    const owner = folio.chapters.find(
      (ch) => ch.id === id || ch.blocks.some((block) => (block.t === "h1" || block.t === "h2") && block.id === id),
    );
    return owner ? `${owner.id}.xhtml#${id}` : `#${id}`;
  };
  folio.chapters.forEach((ch) => {
    const built = chapterHtml(ch.blocks, hrefFor);
    put(
      `OEBPS/text/${ch.id}.xhtml`,
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en"><head><meta charset="utf-8"/><title>${esc(ch.title)}</title><link rel="stylesheet" href="../style.css"/></head><body><section>
${built.html}
</section></body></html>`,
    );
    manifest.push(`<item id="${ch.id}" href="text/${ch.id}.xhtml" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="${ch.id}"/>`);
    for (const label of built.pages) {
      if (usedPages.has(label)) continue;
      usedPages.add(label);
      pageLinks.push({ label, href: `text/${ch.id}.xhtml#page-${label}`, front: !/^\d+$/.test(label) });
    }
  });
  const toc = folio.toc
    .map((t) => {
      const kids = t.children
        .map((c) => `<li><a href="text/${t.id}.xhtml#${esc(c.id)}">${esc(c.label)}</a></li>`)
        .join("");
      return `<li><a href="text/${t.id}.xhtml">${esc(t.label)}</a>${kids ? `<ol>${kids}</ol>` : ""}</li>`;
    })
    .join("");
  const pageList = pageLinks.map((p) => `<li><a href="${esc(p.href)}">${esc(p.label)}</a></li>`).join("");
  put(
    "OEBPS/nav.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en"><head><title>Contents</title></head><body>
<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${toc}</ol></nav>
<nav epub:type="page-list" hidden="hidden"><ol>${pageList}</ol></nav>
</body></html>`,
  );
  let order = 1;
  const navPoints = folio.toc
    .map((t) => {
      const self = order++;
      const kids = t.children
        .map((c) => {
          const o = order++;
          return `<navPoint id="nav-${esc(c.id)}" playOrder="${o}"><navLabel><text>${esc(c.label)}</text></navLabel><content src="text/${t.id}.xhtml#${esc(c.id)}"/></navPoint>`;
        })
        .join("");
      return `<navPoint id="nav-${esc(t.id)}" playOrder="${self}"><navLabel><text>${esc(t.label)}</text></navLabel><content src="text/${t.id}.xhtml"/>${kids}</navPoint>`;
    })
    .join("");
  const arabicPages = pageLinks.map((p) => Number(p.label)).filter((n) => Number.isInteger(n) && n > 0);
  const maxPage = arabicPages.length ? Math.max(...arabicPages) : 0;
  const pageTargets = pageLinks
    .map((p) => {
      const o = order++;
      const type = p.front ? "front" : "normal";
      return `<pageTarget id="pt-${esc(p.label)}" type="${type}" value="${esc(p.label)}" playOrder="${o}"><navLabel><text>${esc(p.label)}</text></navLabel><content src="${esc(p.href)}"/></pageTarget>`;
    })
    .join("");
  put(
    "OEBPS/toc.ncx",
    `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="urn:uuid:recto-opened"/>
<meta name="dtb:depth" content="2"/><meta name="dtb:totalPageCount" content="${pageLinks.length}"/><meta name="dtb:maxPageNumber" content="${maxPage}"/></head>
<docTitle><text>${esc(folio.title)}</text></docTitle>
<navMap>${navPoints}</navMap>
<pageList><navLabel><text>Pages</text></navLabel>${pageTargets}</pageList>
</ncx>`,
  );
  put(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="3.0" xml:lang="en" prefix="schema: http://schema.org/">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">urn:uuid:recto-${esc(folio.title).slice(0, 24)}</dc:identifier>
<dc:title>${esc(folio.title)}</dc:title>
${folio.author ? `<dc:creator>${esc(folio.author)}</dc:creator>` : ""}
<dc:language>en</dc:language>
<dc:source>${esc(sourceName)}</dc:source>
<dc:rights>Personal reading copy made in Recto from a file supplied by the reader.</dc:rights>
<meta property="dcterms:modified">2026-10-24T16:00:00Z</meta>
<meta property="pageBreakSource">${esc(sourceName)}</meta>
<meta property="schema:accessibilityFeature">pageBreakMarkers</meta>
<meta property="schema:accessibilityFeature">pageNavigation</meta>
${cover ? `<meta name="cover" content="cover-image"/>` : ""}
</metadata><manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="css" href="style.css" media-type="text/css"/>
${manifest.join("\n")}
</manifest><spine toc="ncx">${spine.join("")}<itemref idref="nav" linear="no"/></spine>${cover ? `<guide><reference type="cover" title="Cover" href="cover.xhtml"/></guide>` : ""}</package>`,
  );
  return zipSync(files, { level: 6 });
}

type Para = { group: Line[]; runs: Run[]; h: number; table?: { headers: string[]; rows: string[][] }; kind?: "note" };

function bodyBlock(p: Para, printed: PrintedPages): Block {
  const page = printed.label(p.group[0].page);
  const src = p.group[0].page;
  if (p.table) return { t: "table", headers: p.table.headers, rows: p.table.rows, page, src };
  return { t: "p", runs: p.runs, page, src, kind: p.kind };
}

function pushChapter(chapters: Folio["chapters"], label: string, page: number | string | null, src?: number) {
  const id = `c${String(chapters.length + 1).padStart(2, "0")}`;
  const chapter = { id, title: label, page, blocks: [{ t: "h1", id, s: label, page, src }] as Block[] };
  chapters.push(chapter);
  return chapter;
}

function tocOf(chapters: Folio["chapters"]): TocNode[] {
  return chapters.map((c) => ({
    id: c.id,
    label: c.title,
    page: c.page,
    children: c.blocks
      .filter((b) => b.t === "h2" && b.id && b.s)
      .map((b) => ({ id: b.id || "", label: b.s || "", page: b.page ?? null, children: [] })),
  }));
}

function withOutline(paras: Para[], outline: OutlineItem[], title: string, printed: PrintedPages) {
  const chapters: Folio["chapters"] = [];
  const starts = outline.map((item) => item.page || 0).filter((page) => page > 0).sort((a, b) => a - b);
  const first = starts[0] || 1;
  const front = paras.filter((p) => p.group[0].page < first);
  if (front.length) {
    const ch = pushChapter(chapters, "Front matter", printed.label(front[0].group[0].page), front[0].group[0].page);
    for (const p of front) ch.blocks.push(bodyBlock(p, printed));
  }
  outline.forEach((item) => {
    const start = item.page || 1;
    const end = starts.find((page) => page > start) ?? Infinity;
    const shown = printed.label(start);
    const ch = pushChapter(chapters, item.label, shown != null ? shown : (item.printed ?? null), start);
    const seen = new Set<string>();
    const children = item.children.filter((c) => c.page && c.page >= start && c.page < end && c.page !== start);
    for (const p of paras) {
      const page = p.group[0].page;
      if (page < start || page >= end) continue;
      for (const child of children) {
        if (child.page !== page || seen.has(child.label)) continue;
        seen.add(child.label);
        const id = `${ch.id}-${slug(child.label)}`;
        ch.blocks.push({ t: "h2", id, s: child.label, page: printed.label(page), src: page, section: true });
      }
      const said = p.runs
        .filter((run): run is string => typeof run === "string")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (said.toLowerCase() === ch.title.toLowerCase()) continue;
      ch.blocks.push(bodyBlock(p, printed));
    }
  });
  if (!chapters.length) pushChapter(chapters, title, printed.label(paras[0]?.group[0].page ?? 1), paras[0]?.group[0].page);
  return chapters;
}

function knownTitle(title: string, lexicon: WordList) {
  const words = (title.match(/[A-Za-z'’]+/g) || []).filter((word) => word.replace(/[^A-Za-z]/g, "").length >= 3);
  if (!words.length) return false;
  let dictionary = 0;
  let names = 0;
  for (const word of words) {
    const lower = word.toLowerCase();
    const ok = lexicon.has(lower) || (lower.length > 4 && lower.endsWith("s") && lexicon.has(lower.slice(0, -1)));
    if (ok) {
      dictionary++;
      continue;
    }
    if (/^[A-Z][a-z'’-]+$/.test(word)) {
      names++;
      continue;
    }
    if (lower.length >= 8) return false;
  }
  const known = dictionary + Math.min(names, Math.max(dictionary, names));
  if (dictionary === 0 && names >= 2 && names === words.length) return true;
  return dictionary >= 1 && known * 4 >= words.length * 3;
}

function spaceChapter(text: string) {
  return text.replace(/\b(chapter|book)\s*(\d+)\b/gi, (_full, word: string, n: string) => {
    const head = word[0].toUpperCase() + word.slice(1).toLowerCase();
    return `${head} ${n}`;
  });
}

/** Left column, then right, so a two-column contents list keeps its page order. */
function orderContentsHits<T extends { line: Line; file: number }>(hits: T[]): T[] {
  const byFile = new Map<number, T[]>();
  for (const hit of hits) {
    const list = byFile.get(hit.file) || [];
    list.push(hit);
    byFile.set(hit.file, list);
  }
  const out: T[] = [];
  for (const file of [...byFile.keys()].sort((a, b) => a - b)) {
    const list = byFile.get(file) || [];
    const xs = list.map((hit) => hit.line.x0).sort((a, b) => a - b);
    const spread = xs.length ? xs[xs.length - 1] - xs[0] : 0;
    const byRow = (a: T, b: T) => b.line.y - a.line.y || a.line.x0 - b.line.x0;
    if (spread < 100 || list.length < 6) {
      out.push(...list.sort(byRow));
      continue;
    }
    const mid = xs[Math.floor(xs.length / 2)];
    const left = list.filter((hit) => hit.line.x0 < mid).sort(byRow);
    const right = list.filter((hit) => hit.line.x0 >= mid).sort(byRow);
    if (left.length < 3 || right.length < 3) out.push(...list.sort(byRow));
    else out.push(...left, ...right);
  }
  return out;
}

function chapterIndex(text: string) {
  const title = mendHead(text);
  const arabic = /^(?:chapter|book)\s*(\d{1,4})\b/i.exec(title);
  if (arabic) return Number(arabic[1]);
  const roman = /^(?:chapter|book)\s+([ivxlcdm]+)\b/i.exec(title);
  if (roman) return romanChapter(roman[1]);
  const dottedRoman = /^([ivxlcdm]{1,8})[.)]\s+\S/i.exec(title);
  if (dottedRoman) return romanChapter(dottedRoman[1]);
  const dotted = /^(\d{1,3})\s*·\s+\S/.exec(title);
  return dotted ? Number(dotted[1]) : null;
}

/**
 * A two-column contents list is not one rising page count.
 * Read across the row and the right-hand page is higher, so the longest
 * rising stretch can be the middle of the book. Chapter numbers keep the whole list.
 */
function chapterContents<T extends { line: Line; title: string; page: number; file: number }>(hits: T[]): T[] | null {
  const aligned = alignRomanOutliers(hits.map((hit) => ({ label: hit.title, page: hit.page, children: [] })));
  const named = hits.map((hit, index) => (aligned[index].label === hit.title ? hit : { ...hit, title: aligned[index].label }));
  type Hit = (typeof hits)[number];
  const tagged = named.filter((hit) => chapterIndex(hit.title));
  if (tagged.length < 8) return null;
  const earliest = Math.min(...tagged.map((hit) => hit.file));
  const pool = named.filter((hit) => hit.file >= earliest && hit.file <= earliest + 20);
  if (pool.filter((hit) => chapterIndex(hit.title)).length < 8) return null;
  const groups = new Map<number, Hit[]>();
  const leading: Hit[] = [];
  const closing: Hit[] = [];
  for (const hit of pool) {
    const n = chapterIndex(hit.title);
    if (n) {
      const title = hit.title.replace(/\s+(?:chapter|book)\s+\d+\b[\s\S]*$/i, "").trim();
      const clean = title === hit.title ? hit : { ...hit, title };
      if (!groups.has(n)) groups.set(n, [clean]);
      continue;
    }
    if (groups.size) {
      if (/^(?:bibliography|index|glossary|notes|appendix)\b/i.test(hit.title)) closing.push(hit);
      continue;
    }
    if (leading.some((item) => item.title === hit.title)) continue;
    if (hit.title.length > 80 || /[.?!]/.test(hit.title) || hit.title.split(/\s+/).length > 12) continue;
    leading.push(hit);
  }
  const numbers = [...groups.keys()].sort((a, b) => a - b);
  if (numbers.length < 8) return null;
  const out: Hit[] = [];
  const firstPage = groups.get(numbers[0])![0].page;
  for (const hit of leading) if (hit.page <= firstPage) out.push(hit);
  for (const n of numbers) out.push(...groups.get(n)!);
  out.push(...closing);
  return out;
}

/** A printed list that stops while the book keeps opening later chapters. */
function contentsIncomplete(items: OutlineItem[], lines: Line[], drop: Set<Line>) {
  if (items.length < 4) return false;
  const listed = new Set<number>();
  for (const item of items) {
    const n = chapterIndex(item.label);
    if (n) listed.add(n);
  }
  const body = new Set<number>();
  for (const line of lines) {
    if (drop.has(line)) continue;
    const text = line.text.replace(/\s+/g, " ").trim();
    if (/[.\u00b7…]{4,}/.test(text) || text.length > 90) continue;
    const n = chapterIndex(text);
    if (n) body.add(n);
  }
  if (body.size < 8) return false;
  const listedMax = listed.size ? Math.max(...listed) : 0;
  const extras = [...body].filter((n) => !listed.has(n)).sort((a, b) => a - b);
  const plausible: number[] = [];
  for (const n of extras) {
    const near = [...listed, ...plausible].some((m) => Math.abs(m - n) <= 2);
    if (near) plausible.push(n);
  }
  const bodyMax = plausible.length ? Math.max(...plausible) : 0;
  return plausible.length >= 8 || (plausible.length >= 3 && bodyMax >= listedMax + 8);
}

const SECTION_LABEL = /^(?:[A-Z]|[ivxlcdm]{1,5})\.\s+\S/;

function mendHead(text: string) {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^chapte(?:k|ft)\b/i, "CHAPTER")
    .replace(/\bIIL\b/g, "III")
    .replace(/\bVIL\b/g, "VII")
    .replace(/\b(book|chapter)\s+Ill\b/gi, "$1 III")
    .replace(/\b(book|chapter)\s+Il\b/gi, "$1 II")
    .replace(/\bchapter\s+(\d+)\s+([ivxlcdm]+)\b/i, (full, n: string, roman: string) => {
      const value = romanChapter(roman);
      return value === Number(n) ? `${roman.toUpperCase()}.` : full;
    });
}

function chapterLabel(text: string) {
  const title = mendHead(text);
  if (/^(?:chapter|book)\s*\d{1,4}\s*[:.]?\s*$/i.test(title)) return true;
  const roman = /^(?:chapter|book)\s+([ivxlcdm]{1,8})\s*[:.]?\s*$/i.exec(title);
  if (roman && romanChapter(roman[1])) return true;
  return /^(?:chapter|book)\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s*[:.]?\s*$/i.test(title);
}

function headingKind(text: string): "chapter" | "section" | "title" | null {
  const title = mendHead(text).replace(/^[^A-Za-z0-9]+/, "");
  if (chapterLabel(title)) return "chapter";
  if (/^(?:stave|act|scene|part|appendix)\s+(?:[a-z]+|\d{1,3}|[ivxlcdm]{1,8})\s*[:.]?\s*$/i.test(title)) return "chapter";
  if (title.length < 2 || title.length > 90 || /[.!]["']?$/.test(title) || CONTENTS_HEAD.test(title)) return null;
  if (chapterLabel(title)) return "chapter";
  if (/^part\s+(?:[ivxlcdm]{1,6}|\d{1,2})\s*[:.]?\s*$/i.test(title)) return "chapter";
  if (/^appendix\s+(?:\d{1,2}|[ivxlcdm]{1,6})\s*[:.]?\s*$/i.test(title)) return "chapter";
  const act = /^act\s+(\d{1,2}|[ivxlcdm]{1,6})\s*[:.]?\s*$/i.exec(title);
  if (act && (/^\d+$/.test(act[1]) || romanChapter(act[1]))) return "chapter";
  if (/^(?:chapter|book)\s+\S/i.test(title)) {
    const rest = title.replace(/^(?:chapter|book)\s*\d{1,4}\b\s*[-–—:.]?\s*/i, "").trim();
    if (rest && rest !== title && !/[.?!]["']?$/.test(rest)) {
      const words = rest.split(/\s+/);
      const small = new Set(["a", "an", "and", "but", "or", "nor", "of", "the", "in", "on", "at", "to", "for", "by", "as", "from", "with", "into", "over", "upon"]);
      const titled =
        words.length <= 14 &&
        words.every((word, index) => (index > 0 && small.has(word.toLowerCase())) || /^[A-Z0-9][A-Za-z0-9'’.,:?/\u2013\u2014-]*$/.test(word));
      if (titled || (words.length <= 14 && allCapsLine(rest))) return "chapter";
    }
    return null;
  }
  if (SECTION_LABEL.test(title) && !/^[A-Z]\.\s*[A-Z]\./.test(title)) return "section";
  const words = title.split(/\s+/);
  if (words.length > 14) return null;
  const small = new Set(["a", "an", "and", "but", "or", "nor", "of", "the", "in", "on", "at", "to", "for", "by", "as", "from", "with", "into", "over", "upon"]);
  const titled = words.every((word, index) => (index > 0 && small.has(word.toLowerCase())) || /^[A-Z0-9][A-Za-z0-9'’.,:?/\u2013\u2014-]*$/.test(word));
  return titled ? "title" : null;
}

function allCapsLine(text: string) {
  return /[A-Z]/.test(text) && !/[a-z]/.test(text);
}

function headingWords(text: string) {
  return text.split(/\s+/).filter((word) => /[A-Za-z]{2}/.test(word)).length;
}

function unglueSmall(text: string) {
  return text.replace(/\b(of|and|the|in|to|for|with)(the|and|of|a)\b/gi, "$1 $2");
}

function softenHeading(text: string) {
  const title = unglueSmall(text.replace(/\s+/g, " ").trim().replace(/^[^A-Za-z0-9]+/, "").replace(/\bLHE\b/g, "THE"));
  const section = SECTION_LABEL.test(title);
  if (/[a-z]/.test(title) && !section) return title;
  const small = new Set(["a", "an", "and", "of", "the", "in", "on", "to", "for", "by"]);
  const roman = /^(?:i{1,3}|iv|vi{0,3}|ix|x|xi{0,3}|xiv|xv|xvi{0,3}|xix|xx)$/i;
  return title
    .toLowerCase()
    .split(" ")
    .map((word, index, all) => {
      if (roman.test(word)) return word.toUpperCase();
      const afterColon = index > 0 && /:$/.test(all[index - 1]);
      if (!section && index > 0 && !afterColon && small.has(word)) return word;
      return word.replace(/(^|[-'])([a-z])/g, (_full, boundary: string, letter: string) =>
        boundary === "'" && letter === "s" ? "'s" : `${boundary}${letter.toUpperCase()}`,
      );
    })
    .join(" ");
}

/** Stacked heading lines. A small word that merely continues the previous line stays small, except A, An, and The. */
function softenStack(lines: string[]) {
  const small = new Set(["of", "and", "to", "for", "in", "on", "by", "as", "from", "with", "or"]);
  return lines
    .map((raw, index) => {
      const text = softenHeading(raw);
      if (index === 0) return text;
      return text.replace(/^[A-Za-z'’]+/, (word) => (small.has(word.toLowerCase()) ? word.toLowerCase() : word));
    })
    .join(" ");
}

function centeredLine(line: Line) {
  const width = line.x1 - line.x0;
  if (width < 4 || line.pageW < 40) return false;
  const mid = (line.x0 + line.x1) / 2;
  return Math.abs(mid - line.pageW / 2) < Math.min(36, line.pageW * 0.1) && width < line.pageW * 0.82;
}

function romanMarker(text: string) {
  const token = text.replace(/\s+/g, " ").trim().replace(/\.$/, "");
  if (!token || token.length > 5) return null;
  if (/^[ivxlcdm]+$/i.test(token)) return token.toLowerCase();
  if (/^i[uv]+$/i.test(token)) return token.toLowerCase().replace(/u/g, "i");
  return null;
}

function ornamentText(text: string) {
  return /^[\d.]{1,3}$/.test(text.trim());
}

function sentenceLike(text: string) {
  const title = text.replace(/\s+/g, " ").trim();
  if (/[.?!]/.test(title)) return true;
  if (/^[a-z]/.test(title)) return true;
  if (/,/.test(title) && /[a-z]/.test(title)) return true;
  const words = title.split(/\s+/);
  const lower = words.filter((word) => /^[a-z]/.test(word)).length;
  if (words.length >= 8 && lower >= 3) return true;
  return lower >= 4;
}

/** A display line that is a broken word, a scan mark, or the tail of a sentence. */
function brokenHeading(text: string) {
  const title = text.replace(/\s+/g, " ").trim();
  if (/[^A-Za-z0-9\s'’.,:;"“”!?—–\-/]/.test(title)) return true;
  if (/[A-Za-z]-$/.test(title)) return true;
  if (/^(?:the|a|an)\s+(?:of|and)\b/i.test(title)) return true;
  return /\b(?:the|a|an|of|and|to|for|in|on|with|or|from|by)\s*$/i.test(title);
}

function contentWords(text: string) {
  return (text.match(/[A-Za-z'’]{3,}/g) || []).length;
}

/** A repeated running head, not a one-off sentence that happens to sit high on the page. */
function nearEdge(ln: Line) {
  const top = Math.min(72, Math.max(48, ln.pageH * 0.11));
  const bottom = Math.min(42, Math.max(28, ln.pageH * 0.08));
  return ln.y > ln.pageH - top || ln.y < bottom;
}

function bareFolioNumber(text: string) {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t || t.length > 14) return false;
  return /^(?:[-–—.\s\[\]()]*)(?:\d{1,4}|[ivxlcdm]{1,6})(?:[-–—.\s\[\]()]*)$/i.test(t);
}

function furnitureKey(text: string) {
  let t = text.replace(/\s+/g, " ").trim();
  t = t.replace(/^[^A-Za-z0-9]+/, "");
  t = t.replace(/^[\[(]?(?:\d{1,4}|[ivxlcdm]{1,6})[\])]?\s+/i, "");
  t = t.replace(/[^A-Za-z0-9]+$/g, "");
  t = t.replace(/\s+[\[(]?(?:\d{1,4}|[ivxlcdm]{1,6})[\])]?$/i, "");
  return t.replace(/[^A-Za-z0-9]+$/g, "").trim().toLowerCase();
}

function headTokens(key: string) {
  const parts = key.split(/\s+/).filter(Boolean);
  while (parts.length > 2 && parts[parts.length - 1].length === 1) parts.pop();
  return parts;
}

/** "the tarts" is the tail of "who stole the tarts". "book iv" is not "book vi". */
function headsMatch(a: string, b: string) {
  const left = headTokens(a);
  const right = headTokens(b);
  if (left.length < 2 || right.length < 2) return false;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  if (shorter.length === longer.length) return shorter.join(" ") === longer.join(" ");
  const small = shorter.join(" ");
  const big = longer.join(" ");
  return big.startsWith(`${small} `) || big.endsWith(` ${small}`);
}

function repeatedFurniture(lines: Line[]) {
  const pages = new Map<string, Set<number>>();
  for (const ln of lines) {
    if (!nearEdge(ln)) continue;
    const text = ln.text.replace(/\s+/g, " ").trim();
    if (text.length >= 72 || bareFolioNumber(text)) continue;
    const key = furnitureKey(text);
    if (key.length < 2) continue;
    const seen = pages.get(key) || new Set<number>();
    seen.add(ln.page);
    pages.set(key, seen);
  }
  const keys = [...pages.keys()];
  const parent = new Map(keys.map((key) => [key, key]));
  const find = (key: string): string => {
    const up = parent.get(key) || key;
    if (up === key) return key;
    const root = find(up);
    parent.set(key, root);
    return root;
  };
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      if (headsMatch(keys[i], keys[j])) parent.set(find(keys[i]), find(keys[j]));
    }
  }
  const clusterPages = new Map<string, Set<number>>();
  for (const key of keys) {
    const root = find(key);
    const set = clusterPages.get(root) || new Set<number>();
    for (const page of pages.get(key) || []) set.add(page);
    clusterPages.set(root, set);
  }
  const repeated = new Set<string>();
  for (const key of keys) if ((clusterPages.get(find(key))?.size || 0) >= 3) repeated.add(key);
  return { repeated, pages };
}

/** A one-off sentence at the edge is not a running head, even when its words overlap one. */
function spokenOnce(text: string, key: string, pages: Map<string, Set<number>>) {
  if ((pages.get(key)?.size || 0) !== 1) return false;
  if (!/[a-z]/.test(text)) return false;
  return /[.?!]["']?\s*$/.test(text);
}

/** A smaller line under only part of the line above it. A full-width gloss is not this. */
function underPart(above: Line, below: Line) {
  if (above.h <= 0 || below.h <= 0 || below.h >= above.h * 0.92) return false;
  const wide = above.x1 - above.x0;
  const narrow = below.x1 - below.x0;
  if (wide < 40 || narrow < 8 || narrow > wide * 0.72) return false;
  const overlap = Math.min(above.x1, below.x1) - Math.max(above.x0, below.x0);
  return overlap >= narrow * 0.6;
}

/**
 * A contents entry with no usable page is not a page number we may invent.
 * The same heading in the body still opens a chapter, at the file page where it sits.
 */
function addBodyChapters(outline: OutlineItem[], paras: Para[]): OutlineItem[] {
  const listed = new Set<number>();
  for (const item of outline) {
    const n = chapterIndex(item.label);
    if (n) listed.add(n);
  }
  if (listed.size < 2) return outline;
  const first = Math.min(...outline.map((item) => item.page || Infinity));
  const have = new Set(listed);
  const extra: OutlineItem[] = [];
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    if (p.table || p.kind === "note" || p.group.length !== 1) continue;
    const page = p.group[0].page;
    if (!(page >= first)) continue;
    const text = mendHead(p.group[0].text);
    const n = chapterIndex(text);
    if (!n || have.has(n)) continue;
    const kind = headingKind(text);
    if (kind !== "chapter" && kind !== "section") continue;
    if (kind === "section") {
      if (!/^[ivxlcdm]{1,8}[.)]\s+\S/i.test(text)) continue;
      const rest = text.replace(/^[ivxlcdm]{1,8}[.)]\s+/i, "");
      if (/^\d/.test(rest) || /[;]/.test(text)) continue;
      if (sentenceLike(text) && !/^[IVXLCDM]{1,8}[.)]\s+[A-Z0-9]/.test(text)) continue;
      const lower = (rest.match(/[a-z]/g) || []).length;
      const upper = (rest.match(/[A-Z]/g) || []).length;
      if (lower > upper) continue;
    }
    const nums = [...have];
    const max = Math.max(...nums);
    const min = Math.min(...nums);
    if (n > max + 1 || n < min - 1) continue;
    if (!nums.some((m) => Math.abs(m - n) <= 2)) continue;
    let label = spaceChapter(softenHeading(text));
    const next = paras[i + 1];
    if (next && !next.table && next.group.length === 1 && next.group[0].page === page && !chapterIndex(next.group[0].text)) {
      const follow = next.group[0].text.replace(/\s+/g, " ").trim();
      const caps = follow.length >= 3 && follow.length <= 60 && !/[a-z]/.test(follow) && follow.split(/\s+/).length <= 8;
      if (caps) label = `${label.replace(/\.+$/, "")}. ${softenHeading(follow)}`;
    }
    have.add(n);
    extra.push({ label, page, children: [] });
  }
  if (!extra.length) return outline;
  return [...outline, ...extra].sort((a, b) => (a.page || 0) - (b.page || 0) || (chapterIndex(a.label) || 0) - (chapterIndex(b.label) || 0));
}

/** The same book, opened again from a running head, is not a second chapter. */
function uniqueChapters(items: OutlineItem[]) {
  const seen = new Set<number>();
  const out: OutlineItem[] = [];
  for (const item of items) {
    const n = chapterIndex(item.label);
    if (n && seen.has(n)) continue;
    if (n) seen.add(n);
    out.push(item);
  }
  return out;
}

function splitMark(label: string) {
  const chapter = /^(?:chapter|book)\s+(?:[ivxlcdm]+|\d+)\b\s*[.)\u00b7:]?/i.exec(label);
  if (chapter) return { mark: chapter[0].replace(/\s+/g, " ").trim(), title: label.slice(chapter[0].length).trim() };
  const roman = /^([ivxlcdm]{1,8})\s*[.)\u00b7]/i.exec(label);
  if (roman && romanChapter(roman[1])) return { mark: roman[0].replace(/\s+/g, " ").trim(), title: label.slice(roman[0].length).trim() };
  return { mark: "", title: label.trim() };
}

/** "CHAPTER II" and the scanned "CHAPTEft" / "CHAPTEK". Not a word that merely begins the same way. */
function chapterish(text: string) {
  return /^(?:book|chapter|chapte[a-z]{1,2})\b/i.test(text.trim());
}

/** A chapter mark is its own line. "Book the passage" is not. */
function chapterMarkLine(text: string) {
  return /^(?:book|chapter|chapte[a-z]{1,2})\b\s*[0-9ivxlcdmlyuj]/i.test(text.trim());
}

function displayLine(text: string, line: Line) {
  if (chapterLabel(text) || chapterish(text) || bareFolioNumber(text)) return false;
  if (text.length < 4 || text.length > 70 || nearEdge(line)) return false;
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length < 3) return false;
  if ((letters.match(/[A-Z]/g) || []).length / letters.length < 0.7) return false;
  if (/^[a-z]/.test(text)) return false;
  return (text.match(/\b[a-z]{3,}\b/g) || []).length < 3;
}

function subtitleOn(paras: Para[], page: number) {
  for (const p of paras) {
    if (p.table || p.kind === "note" || p.group[0].page !== page) continue;
    const lines = p.group.map((line) => line.text.replace(/\s+/g, " ").trim());
    const first = lines[0];
    if (!displayLine(first, p.group[0])) continue;
    if (lines.length === 1) return mendCapsWords(first);
    const rest = lines.slice(1).join(" ");
    if (allCapsLine(first) && allCapsLine(rest)) {
      const full = mendCapsWords(`${first} ${rest}`.replace(/\s+/g, " ").trim());
      if (full.length <= 80 && displayLine(full, p.group[0])) return full;
    }
    if (/[a-z]{3}/.test(rest)) return first;
  }
  return "";
}

/** The display line on the chapter's page, or on the heading a sheet or two later. */
function displaySubtitle(paras: Para[], page: number, index: number | null) {
  const here = subtitleOn(paras, page);
  if (here || !index) return here;
  for (const p of paras) {
    const file = p.group[0].page;
    if (file <= page || file > page + 16) continue;
    const text = p.group[0].text.replace(/\s+/g, " ").trim();
    if (chapterIndex(text) !== index) continue;
    if (!chapterLabel(text) && !chapterish(text)) continue;
    return subtitleOn(paras, file);
  }
  return "";
}

const TITLE_WORD = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;
const SMALL_KNOWN = new Set("the and for but not are was his her its you our she they them from with that this".split(" "));

function titleWords(text: string) {
  return text.match(TITLE_WORD) || [];
}

function knownPiece(word: string, list: WordList) {
  const parts = word.toLowerCase().split(/[^a-z]+/).filter((part) => part.length >= 3);
  return parts.every((part) => list.has(part) || SMALL_KNOWN.has(part));
}

function fullyKnown(text: string, list: WordList) {
  const words = titleWords(text).filter((word) => word.replace(/[^A-Za-z]/g, "").length >= 3);
  return words.length > 0 && words.every((word) => knownPiece(word, list));
}

function blendTitle(contents: string, body: string, list: WordList) {
  const repaired = repairHeading(contents, list);
  const bodyFixed = repairHeading(body, list);
  const c = titleWords(repaired);
  const b = titleWords(bodyFixed);
  if (!c.length) return repaired;
  if (c.length !== b.length) return fullyKnown(bodyFixed, list) && !fullyKnown(repaired, list) ? bodyFixed : repaired;
  return c
    .map((word, index) => {
      const other = b[index];
      if (word.toLowerCase() === other.toLowerCase()) return word;
      if (!headingStep(word, other) || !knownPiece(other, list)) return word;
      if (word === word.toUpperCase()) return other.toUpperCase();
      if (word[0] === word[0].toUpperCase()) return other[0].toUpperCase() + other.slice(1).toLowerCase();
      return other.toLowerCase();
    })
    .join(" ");
}

function dressTitle(text: string) {
  const small = new Set(["a", "an", "and", "of", "the", "in", "on", "to", "for", "by", "as", "from", "is", "that", "with", "was"]);
  const roman = /^(?:i{1,3}|iv|vi{0,3}|ix|x|xi{0,3}|xii|xiii|xiv|xv|xvi{0,3}|xix|xx)$/;
  let index = 0;
  return text.replace(/\s+/g, " ").trim().replace(TITLE_WORD, (word) => {
    const at = index++;
    const lower = word.toLowerCase();
    if (roman.test(lower) && word === word.toUpperCase()) return word.toUpperCase();
    if (at > 0 && small.has(lower)) return lower;
    return lower.replace(/(^|[-'])([a-z])/g, (_full, boundary: string, letter: string) =>
      boundary === "'" && letter === "s" ? "'s" : `${boundary}${letter.toUpperCase()}`,
    );
  });
}

/** "pig AND PEPPER" and "THE queen's CROQUET-GROUND" are one heading wearing two cases. */
function raggedCase(text: string) {
  const words = text.match(TITLE_WORD) || [];
  let upper = 0;
  let lower = 0;
  for (const word of words) {
    if (word.length < 2) continue;
    if (word === word.toUpperCase() && /[A-Z]/.test(word)) upper++;
    else if (word === word.toLowerCase() && /[a-z]/.test(word)) lower++;
  }
  return upper > 0 && lower > 0;
}

function headingTokens(text: string, list: WordList) {
  return titleWords(repairHeading(text, list)).flatMap((word) =>
    word.toLowerCase().split(/[^a-z]+/).filter((part) => part.length >= 2),
  );
}

/** A contents word and the word on the opening line. An unknown scan may be one letter off a known word. */
function nearWord(from: string, to: string, list: WordList) {
  if (from === to) return true;
  if ((from === `${to}s` || to === `${from}s`) && Math.min(from.length, to.length) >= 4) return true;
  if (from.length < 3 || from.length !== to.length) return false;
  if (headingStep(from, to) || headingStep(to, from)) return true;
  if (!list.has(to)) return false;
  let diffs = 0;
  for (let i = 0; i < from.length; i++) if (from[i] !== to[i] && ++diffs > 1) return false;
  return diffs === 1;
}

function sharesHeading(display: string, title: string, list: WordList) {
  const a = headingTokens(display, list);
  const b = headingTokens(title, list);
  if (!a.length || a.length !== b.length) return false;
  return a.every((word, i) => nearWord(word, b[i], list));
}

function polishChapters(items: OutlineItem[], paras: Para[], lexicon: WordList) {
  return items.map((item) => {
    if (!item.page) return item;
    const { mark, title } = splitMark(item.label);
    if (!title) return item;
    const body = displaySubtitle(paras, item.page, chapterIndex(item.label));
    const next = body ? blendTitle(title, body, lexicon) : repairHeading(title, lexicon);
    const same = next.replace(/\s+/g, " ").trim().toLowerCase() === title.replace(/\s+/g, " ").trim().toLowerCase();
    const confirmed = !!body && (allCapsLine(title) || allCapsLine(body)) && sharesHeading(body, next, lexicon);
    if (same && !raggedCase(next) && !confirmed) return item;
    const label = `${mark} ${dressTitle(next)}`.replace(/\s+/g, " ").trim();
    return label === item.label ? item : { ...item, label };
  });
}

function paraText(p: Para) {
  return p.runs
    .filter((run): run is string => typeof run === "string")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function setParaText(p: Para, text: string) {
  let used = false;
  const runs: Run[] = [];
  for (const run of p.runs) {
    if (typeof run !== "string") {
      runs.push(run);
      continue;
    }
    if (used) continue;
    used = true;
    runs.push(text);
  }
  if (!used) runs.push(text);
  p.runs = runs;
}

function toRoman(n: number) {
  const values: [number, string][] = [
    [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
  ];
  let left = n;
  let s = "";
  for (const [value, glyph] of values) {
    while (left >= value) {
      s += glyph;
      left -= value;
    }
  }
  return s;
}

function foldRoman(token: string) {
  return token.toLowerCase().replace(/l/g, "i").replace(/y/g, "v").replace(/u/g, "i").replace(/j/g, "i");
}

/** "CHAPTER lY." is IV, and so is "CHAPTER l Y." after a lower-upper split. A clean "BOOK IV" stays. */
function straightenChapter(text: string, index: number | null) {
  if (!index) return null;
  const trimmed = text.replace(/\s+/g, " ").trim();
  const orig = /^(chapte\w*|book)\b\s*([\s\S]+)$/i.exec(trimmed);
  if (!orig) return null;
  const cleaned = mendHead(trimmed).replace(/^chapte[a-z]+/i, "CHAPTER");
  const m = /^(chapter|book)\b\s*([\s\S]+)$/i.exec(cleaned);
  if (!m) return null;
  const parts = m[2].trim().split(/\s+/);
  const bits: string[] = [];
  let consumed = 0;
  for (; consumed < parts.length; consumed++) {
    const bit = parts[consumed].replace(/\.+$/g, "");
    if (!bit || bit.length > 8) break;
    if (!/^[ivxlcdmlyuj]+$/i.test(bit) && !/^\d{1,3}$/.test(bit)) break;
    bits.push(bit);
    if (bits.join("").length > 8) return null;
    if (/\.$/.test(parts[consumed])) {
      consumed++;
      break;
    }
  }
  if (!bits.length) return null;
  const token = bits.join("");
  const tail = parts.slice(consumed).join(" ");
  if (/[a-z]{3}/.test(tail)) return null;
  if (/^\d{1,3}$/.test(token) && Number(token) !== index) return null;
  const rawN = /^\d{1,3}$/.test(token) ? Number(token) : romanChapter(token);
  const folded = foldRoman(token);
  const foldedN = romanChapter(folded);
  let shown: string | null = null;
  if (/^\d{1,3}$/.test(token)) shown = token;
  else if (rawN === index) shown = token.toUpperCase();
  else if (foldedN === index) shown = folded.toUpperCase();
  else return null;
  const origBits = orig[2].trim().split(/\s+/).slice(0, bits.length).map((bit) => bit.replace(/\.+$/g, "")).join("");
  const headFixed = !/^(?:chapter|book)$/i.test(orig[1]);
  const tokenFixed = origBits.toLowerCase() !== shown.toLowerCase();
  if (!headFixed && !tokenFixed) return null;
  const word = /^book/i.test(m[1]) ? "BOOK" : "CHAPTER";
  const next = `${word} ${shown}.${tail ? ` ${tail}` : ""}`.replace(/\s+\./g, ".").replace(/\s+/g, " ").trim();
  return next === trimmed ? null : next;
}

function openingFile(paras: Para[], page: number, index: number | null) {
  const marks = paras.filter((p) => {
    const file = p.group[0].page;
    if (file < page || file > page + 16) return false;
    return chapterish(paraText(p));
  });
  const first = marks[0];
  if (!first || first.group[0].page === page) return page;
  const text = paraText(first);
  if ((index && chapterIndex(text) === index) || !chapterIndex(text)) return first.group[0].page;
  return page;
}

/** The opening line in the text is the same heading as the contents, not the scan that contents already corrected. */
function retouchOpenings(paras: Para[], items: OutlineItem[], lexicon: WordList) {
  for (const item of items) {
    if (!item.page) continue;
    const index = chapterIndex(item.label);
    const { title } = splitMark(item.label);
    const page = openingFile(paras, item.page, index);
    for (const p of paras) {
      if (p.table || p.kind === "note" || p.group.length !== 1 || p.group[0].page !== page) continue;
      const raw = paraText(p);
      if (!chapterish(raw)) continue;
      const fixed = straightenChapter(raw, index);
      if (fixed) setParaText(p, fixed);
    }
    if (!title) continue;
    const sub = subtitleOn(paras, page);
    if (!sub || !sharesHeading(sub, title, lexicon)) continue;
    const dressed = dressTitle(title);
    for (const p of paras) {
      if (p.table || p.kind === "note" || p.group[0].page !== page) continue;
      if (paraText(p) !== sub) continue;
      setParaText(p, dressed);
    }
  }
}

function glossSized(a: Line, b: Line) {
  if (a.h <= 0 || b.h <= 0) return false;
  if (a.text.trim().length <= 8 || b.text.trim().length <= 8) return false;
  return Math.min(a.h, b.h) < Math.max(a.h, b.h) * 0.82;
}

function interlinearPages(lines: Line[]) {
  const byPage = new Map<number, Line[]>();
  for (const line of lines) {
    if (line.table || line.role === "note") continue;
    const list = byPage.get(line.page) || [];
    list.push(line);
    byPage.set(line.page, list);
  }
  const pages = new Set<number>();
  for (const [page, list] of byPage) {
    const gaps: number[] = [];
    let flips = 0;
    let prevTall = 0;
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1];
      const b = list[i];
      if (!glossSized(a, b)) continue;
      const gap = a.y - b.y;
      if (gap < 0 || gap >= Math.max(a.h, b.h) * 2.2) continue;
      const tall = a.h >= b.h ? 1 : -1;
      if (prevTall && tall !== prevTall) flips += 1;
      prevTall = tall;
      gaps.push(gap);
    }
    if (gaps.length < 6 || flips < 4) continue;
    gaps.sort((a, b) => a - b);
    const tuck = gaps[Math.floor(gaps.length / 4)];
    const h = median(list.map((line) => line.h).filter((n) => n > 0));
    if (tuck < h * 1.25) pages.add(page);
  }
  return pages;
}

/** Sanskrit, a short full-width crib, then English. The middle band is the gloss. */
function cribPages(lines: Line[]) {
  const byPage = new Map<number, Line[]>();
  for (const line of lines) {
    if (line.table || line.role === "note") continue;
    const list = byPage.get(line.page) || [];
    list.push(line);
    byPage.set(line.page, list);
  }
  const pages = new Set<number>();
  for (const [page, list] of byPage) {
    const ordered = [...list].sort((a, b) => b.y - a.y || a.x0 - b.x0);
    let triples = 0;
    for (let i = 2; i < ordered.length; i++) {
      const a = ordered[i - 2];
      const b = ordered[i - 1];
      const c = ordered[i];
      if (a.h <= 0 || b.h <= 0 || c.h <= 0) continue;
      const shoulder = Math.max(a.h, c.h);
      const low = Math.min(a.h, c.h);
      if (low < shoulder * 0.85) continue;
      if (b.h >= low * 0.92 || b.h < low * 0.62) continue;
      const gap1 = a.y - b.y;
      const gap2 = b.y - c.y;
      if (gap1 < 0 || gap2 < 0 || gap1 > shoulder * 2.4 || gap2 > shoulder * 2.4) continue;
      triples += 1;
    }
    if (triples >= 4) pages.add(page);
  }
  return pages;
}

/** "OP" in a line of capitals is "OF". "OP." is a citation, and a mixed line is left alone. */
function mendCapsWords(text: string) {
  if (/[a-z]/.test(text)) return text;
  return text.replace(/\bOP\b(?!\.)/g, "OF");
}

/** One line of a title set in capitals. A stave, a chapter mark, or a finished sentence is not a wrap. */
function capsTitleLine(text: string) {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t || t.length > 60 || /[.?!]["']?$/.test(t)) return false;
  if (chapterMarkLine(t) || /^(?:stave|act|scene|part)\b/i.test(t)) return false;
  if (t.split(/\s+/).length > 8) return false;
  return allCapsLine(t);
}

/** The short centered line under a capital title is the rest of that title, not a new paragraph. */
function titleWrap(prev: Line, ln: Line) {
  if (prev.page !== ln.page) return false;
  if (!capsTitleLine(prev.text) || !capsTitleLine(ln.text)) return false;
  const gap = prev.y - ln.y;
  const h = Math.max(prev.h, ln.h);
  if (!(gap >= 0 && gap <= h * 1.85)) return false;
  if (Math.min(prev.h, ln.h) < h * 0.75) return false;
  const prevW = prev.x1 - prev.x0;
  const nextW = ln.x1 - ln.x0;
  return nextW > 0 && nextW <= prevW * 0.85;
}

function setApart(line: Line, bodyH: number) {
  const text = line.text.replace(/\s+/g, " ").trim();
  if (!text || text.length > 90) return false;
  if (centeredLine(line) && (ornamentText(text) || romanMarker(text))) return true;
  if (headingKind(text)) return true;
  if (/^(?:and|or|of|with|from)\b/i.test(text) && text.split(/\s+/).length <= 6 && line.h > bodyH * 1.08 && text.length < 42) return true;
  if (line.h > bodyH * 1.28 && text.length < 80 && !/[.?!]$/.test(text) && !sentenceLike(text)) return true;
  return false;
}

/** A contents page whose titles the word list does not recognize. Dot leaders often leave that kind of scrap. */
function contentsDamaged(lines: Line[], lexicon: WordList) {
  const byPage = new Map<number, { n: number; ok: number }>();
  let head = 0;
  for (const line of lines) {
    if (line.page > 40) continue;
    if (!head && CONTENTS_HEAD.test(line.text.trim()) && line.page <= 40) head = line.page;
  }
  if (!head) return false;
  for (const line of lines) {
    if (line.page < head || line.page > head + 36) continue;
    const found = allEntries(line);
    if (!found.length) continue;
    const stat = byPage.get(line.page) || { n: 0, ok: 0 };
    for (const entry of found) {
      stat.n++;
      if (knownTitle(entry.title, lexicon)) stat.ok++;
    }
    byPage.set(line.page, stat);
  }
  return [...byPage.values()].some((stat) => stat.n >= 8 && stat.ok * 2 < stat.n);
}

/** Pages of a printed contents list, including lines the dot leaders made unreadable. */
function scrapContents(lines: Line[]) {
  const byPage = new Map<number, Line[]>();
  for (const line of lines) {
    const list = byPage.get(line.page);
    if (list) list.push(line);
    else byPage.set(line.page, [line]);
  }
  let head = 0;
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    if (page > 40) break;
    const list = byPage.get(page) || [];
    if (!list.some((line) => CONTENTS_HEAD.test(line.text.trim()))) continue;
    let entries = 0;
    for (let n = page; n <= page + 2; n++) entries += (byPage.get(n) || []).filter((line) => contentsEntry(line)).length;
    if (entries >= 4) {
      head = page;
      break;
    }
  }
  const drop = new Set<Line>();
  if (!head) return drop;
  for (let page = head; page <= head + 14; page++) {
    const list = byPage.get(page) || [];
    if (!list.length) continue;
    if (list.some((line) => chapterLabel(line.text))) break;
    const long = list.filter((line) => line.text.trim().length > 80 && /[a-z]{3}/.test(line.text)).length;
    if (page !== head && long >= 3) break;
    const entries = list.filter((line) => contentsEntry(line) || CONTENTS_HEAD.test(line.text.trim())).length;
    const like = page === head || (long <= 2 && list.length >= 6 && (entries >= 1 || list.length >= 12));
    if (!like) break;
    for (const line of list) drop.add(line);
  }
  return drop;
}

function withHeadings(paras: Para[], title: string, bodyH: number, printed: PrintedPages, lexicon: WordList | null) {
  const textOf = (p: Para) => p.runs.filter((r): r is string => typeof r === "string").join(" ").replace(/\s+/g, " ").trim();
  const continuesInProse = (index: number) => {
    const next = paras[index + 1];
    if (!next || next.table || next.kind === "note") return false;
    return /^[a-z]/.test(textOf(next));
  };
  const gaps: number[] = [];
  for (let i = 1; i < paras.length; i++) {
    const prev = paras[i - 1];
    const here = paras[i];
    if (prev.group[0].page !== here.group[0].page || prev.table || here.table) continue;
    const gap = prev.group[prev.group.length - 1].y - here.group[0].y;
    if (gap > 0 && gap < bodyH * 4) gaps.push(gap);
  }
  const lead = median(gaps) || bodyH * 1.2;
  const front = new Set(["introduction", "acknowledgments", "acknowledgement", "preface", "foreword", "prologue", "epilogue", "bibliography", "index", "glossary", "notes"]);
  const noiseHeading = (value: string, h: number) => {
    if (/\bsee\b/i.test(value) && value.split(/\s+/).length <= 12) return true;
    if (/^\d{2,4}\s/.test(value)) return true;
    if (/[A-Za-z]-$/.test(value) && h < bodyH * 1.2) return true;
    return /^\d{1,3}\.\s+[A-Z]/.test(value) && h < bodyH * 1.2 && value.length > 32;
  };
  const display = (p: Para, index: number) => {
    if (p.table || p.kind === "note") return false;
    const text = textOf(p);
    if (/^\s*[.\u00b7\u2022]/.test(text)) return false;
    const kind = headingKind(text);
    if (noiseHeading(text, p.h)) return false;
    if (/^[A-Z]\.\s*[A-Z]\./.test(text) || /^[A-Z]\.\s+[A-Z][a-z]+(?:\s+[A-Z][a-z.]+){0,3}$/.test(text)) return false;
    if (kind === "chapter" || kind === "section") return true;
    if (kind !== "title" || p.group.length !== 1) return false;
    if (brokenHeading(text) || continuesInProse(index)) return false;
    if (lexicon && !knownTitle(text, lexicon)) return false;
    const line = p.group[0];
    if (/^[A-Z]\.\s*[A-Z]\./.test(text) || /\bq\.\s*\d|\ba\.\s*\d|\bobj\./i.test(text)) return false;
    if (front.has(text.toLowerCase()) && centeredLine(line)) return true;
    if (contentWords(text) < 2) return false;
    const titleCase = /[a-z]/.test(text);
    const smallCaps = p.h > 0 && p.h < bodyH * 0.85;
    const large = p.h > bodyH * 1.28;
    const standing = p.h > bodyH * 1.15 && p.h < bodyH * 2.8;
    const words = text.split(/\s+/).length;
    if (titleCase && words === 1 && text.length < 4) return false;
    if (titleCase && p.h < bodyH * 0.95 && !front.has(text.toLowerCase())) return false;
    if (/\s\.\s/.test(text) || (p.h < bodyH * 1.25 && /\d[A-Za-z]|[A-Za-z]\d/.test(text))) return false;
    if (titleCase && (centeredLine(line) || large || standing)) return true;
    if (!titleCase && centeredLine(line) && smallCaps) {
      if (words < 2 && !front.has(text.toLowerCase())) return false;
      const taller = (q?: Para) => !!q && !q.table && q.h > p.h * 1.2;
      return taller(paras[index - 1]) || taller(paras[index + 1]);
    }
    return false;
  };
  const hangs = (value: string) => /(?:[:;,]\s*|['’]s\s*|\b(?:of|and|the|a|an|to|for|in|on|with|or|from|by)\s*)$/i.test(value);
  const continuesHeading = (head: Para, next: Para) => {
    if (next.table || next.kind === "note" || next.group.length !== 1 || head.group.length !== 1) return false;
    if (next.group[0].page !== head.group[0].page) return false;
    const above = textOf(head);
    const below = textOf(next);
    if (/^\s*[.\u00b7\u2022]/.test(below)) return false;
    if (/[.!]["']?$/.test(above) || /[.!]["']?$/.test(below)) return false;
    if (headingKind(below) === "chapter" || SECTION_LABEL.test(below)) return false;
    if (front.has(below.replace(/[:.]+$/g, "").trim().toLowerCase())) return false;
    const kind = headingKind(below);
    const caps = allCapsLine(below) && below.length < 60;
    const shortTail = /^(?:and|or|of|the|a|an|to|for|with|from)\b/i.test(below) && below.split(/\s+/).length <= 6;
    const question = /\?\s*$/.test(above);
    if (kind !== "title" && kind !== "section" && !caps && !((hangs(above) || shortTail || question) && below.length < 80)) return false;
    const dh = Math.abs(next.h - head.h);
    if (dh > 2 && dh > head.h * 0.15) return false;
    if (next.h < bodyH * 1.05) return false;
    if (Math.abs(head.group[0].x0 - next.group[0].x0) > 14) return false;
    const gap = head.group[head.group.length - 1].y - next.group[0].y;
    if (gap <= 0 || gap > Math.max(head.h, next.h) * 2.1) return false;
    const width = next.group[0].x1 - next.group[0].x0;
    const headWidth = head.group[0].x1 - head.group[0].x0;
    if (!question && width > next.group[0].pageW * 0.72) return false;
    return hangs(above) || question || shortTail || width < headWidth * 0.72;
  };
  const takeTail = (index: number) => {
    const extra: number[] = [];
    let anchor = paras[index];
    for (let j = index + 1; j < paras.length; j++) {
      const next = paras[j];
      if (!continuesHeading(anchor, next)) break;
      extra.push(j);
      anchor = {
        ...anchor,
        h: next.h,
        group: [{ ...anchor.group[0], y: next.group[next.group.length - 1].y }],
      };
    }
    return extra;
  };
  const chapters: Folio["chapters"] = [];
  const skip = new Set<number>();
  const openedChapter = new Set<number>();
  const labeled = paras.some((p) => headingKind(textOf(p)) === "chapter");
  const anyChapter = labeled || paras.some((p, index) => display(p, index) && p.h > bodyH * 1.28);
  /** A display line followed by another title page, or by a list of books, is not the start of a chapter. */
  const opensChapter = (index: number) => {
    const page = paras[index].group[0].page;
    let lists = 0;
    let prose = false;
    for (let j = index + 1; j < paras.length && j < index + 24; j++) {
      const next = paras[j];
      const say = textOf(next);
      if (next.table && next.group[0].page === page) return false;
      if (!say) continue;
      const displayLine = next.h > bodyH * 1.5 && say.length < 80 && !!headingKind(say) && !sentenceLike(say);
      if (displayLine && !prose && next.group[0].page !== page) return false;
      if (say.length < 48 && say.split(/\s+/).length <= 8 && /\s[.\u00b7]{1,3}\s|\bcents\b/i.test(say)) lists++;
      else if (/[.?!]/.test(say) && /[a-z]{3}/.test(say) && say.split(/\s+/).length >= 6) prose = true;
      if (lists >= 4) return false;
    }
    return prose;
  };
  let current: Folio["chapters"][number] | null = null;
  let sealed = false;
  const open = (label: string, p: Para) => {
    current = pushChapter(chapters, label, printed.label(p.group[0].page), p.group[0].page);
  };
  const section = (label: string, p: Para) => {
    if (!current) open(anyChapter ? "Front matter" : title, p);
    const id = `${current!.id}-${slug(label)}`;
    current!.blocks.push({ t: "h2", id, s: label, page: printed.label(p.group[0].page), src: p.group[0].page, section: true });
  };
  paras.forEach((p, i) => {
    if (skip.has(i)) return;
    const text = textOf(p);
    const line = p.group[0];
    if (centeredLine(line) && ornamentText(text)) return;
    const mark = centeredLine(line) ? romanMarker(text) : null;
    if (mark && p.group.length === 1) {
      const next = paras[i + 1];
      if (next && headingKind(textOf(next)) === "title" && next.group[0].page === line.page) {
        skip.add(i + 1);
        section(`${mark}. ${softenHeading(textOf(next))}`, next);
      }
      return;
    }
    if (headingKind(text) === "chapter") {
      const index = chapterIndex(text);
      if (index && openedChapter.has(index)) {
        if (!current) open(anyChapter ? "Front matter" : title, p);
        current!.blocks.push(bodyBlock(p, printed));
        return;
      }
      if (index) openedChapter.add(index);
      const follow: number[] = [];
      for (let j = i + 1; j < paras.length; j++) {
        const next = paras[j];
        if (next.group[0].page !== line.page || next.table || next.kind === "note") break;
        const nextText = textOf(next);
        if (/^[A-Z]\.\s*[A-Z]\./.test(nextText) || /\bq\.\s*\d|\ba\.\s*\d/i.test(nextText)) break;
        if (centeredLine(next.group[0]) && (ornamentText(nextText) || romanMarker(nextText))) {
          follow.push(j);
          continue;
        }
        const kind = headingKind(nextText);
        const caps = allCapsLine(nextText) && nextText.length <= 48 && centeredLine(next.group[0]) && !/[.?!]$/.test(nextText);
        if (caps && next.h < line.h * 0.75 && next.h < bodyH * 1.35) break;
        if (kind === "chapter") break;
        if (kind === "section" || kind === "title" || caps) {
          follow.push(j);
          continue;
        }
        break;
      }
      const titleAt = new Set<number>();
      for (const j of follow) {
        const piece = textOf(paras[j]);
        if (ornamentText(piece) || romanMarker(piece)) continue;
        const caps = allCapsLine(piece) && piece.length <= 48 && centeredLine(paras[j].group[0]);
        if ((headingKind(piece) === "title" && allCapsLine(piece)) || caps) {
          titleAt.add(j);
          continue;
        }
        break;
      }
      let appendixAt: number | null = null;
      if (/^appendix\b/i.test(text)) {
        for (const j of follow) {
          if (titleAt.has(j)) continue;
          const piece = textOf(paras[j]);
          if (ornamentText(piece) || romanMarker(piece)) continue;
          if (headingKind(piece) === "title" && paras[j].h > bodyH * 1.12) appendixAt = j;
          break;
        }
      }
      const titleLines = [...titleAt];
      if (appendixAt != null) titleLines.push(appendixAt);
      const subtitle = titleLines.length ? softenStack(titleLines.map((j) => textOf(paras[j]))) : "";
      open(spaceChapter(subtitle ? `${softenHeading(mendHead(text))}. ${subtitle}` : softenHeading(mendHead(text))), p);
      for (const j of titleLines) skip.add(j);
      let pending = "";
      for (const j of follow) {
        if (titleLines.includes(j) || skip.has(j)) continue;
        skip.add(j);
        const piece = textOf(paras[j]);
        const marker = romanMarker(piece);
        if (marker && paras[j].group.length === 1) {
          pending = marker;
          continue;
        }
        if (ornamentText(piece)) continue;
        const extra = takeTail(j);
        for (const k of extra) skip.add(k);
        const whole = [piece, ...extra.map((k) => textOf(paras[k]))].join(" ");
        const label = pending && headingKind(piece) === "title" ? `${pending}. ${softenHeading(whole)}` : softenHeading(whole);
        pending = "";
        section(label, paras[j]);
      }
      skip.add(i);
      return;
    }
    const large =
      !labeled &&
      p.group.length === 1 &&
      p.h > bodyH * 1.5 &&
      text.length > 2 &&
      text.length < 80 &&
      !/[,:;]$/.test(text) &&
      !sentenceLike(text) &&
      !brokenHeading(text) &&
      (headingKind(text) === "chapter" || contentWords(text) >= 2);
    if (large && !continuesInProse(i) && opensChapter(i) && headingKind(text) !== "section" && (!lexicon || headingKind(text) === "chapter" || knownTitle(text, lexicon))) {
      open(softenHeading(text), p);
      return;
    }
    if (display(p, i) && headingKind(text) !== "chapter") {
      const bare = text.replace(/[:.]+$/g, "").trim().toLowerCase();
      const back = /^(?:glossary|notes|index|bibliography)$/.test(bare);
      if (sealed && !back) {
        if (!current) open(anyChapter ? "Front matter" : title, p);
        current!.blocks.push(bodyBlock(p, printed));
        return;
      }
      const inFront = !current || current.title === "Front matter";
      if (inFront && !front.has(bare) && headingKind(text) !== "section" && !/^appendix\b/i.test(text)) {
        if (!current) open(anyChapter ? "Front matter" : title, p);
        current!.blocks.push(bodyBlock(p, printed));
        return;
      }
      if (back) sealed = true;
      const extra = takeTail(i);
      for (const j of extra) skip.add(j);
      section(softenHeading([text, ...extra.map((j) => textOf(paras[j]))].join(" ")), p);
      return;
    }
    if (!current) open(anyChapter ? "Front matter" : title, p);
    current!.blocks.push(bodyBlock(p, printed));
  });
  if (!chapters.length) pushChapter(chapters, title, 1);
  for (const chapter of chapters) {
    const crowded = new Map<string, Block[]>();
    for (const block of chapter.blocks) {
      if (block.t !== "h2" || !block.s || SECTION_LABEL.test(block.s)) continue;
      const key = String(block.src ?? "");
      const list = crowded.get(key) || [];
      list.push(block);
      crowded.set(key, list);
    }
    const drop = new Set<Block>();
    for (const list of crowded.values()) if (list.length > 4) for (const block of list) drop.add(block);
    if (drop.size) chapter.blocks = chapter.blocks.filter((block) => !drop.has(block));
  }
  return chapters;
}

export function assembleFolio(
  rawLines: Line[],
  options: {
    title: string;
    subtitle: string;
    author?: string;
    sourceName: string;
    outline?: OutlineItem[];
    emptyMessage: string;
    lexicon?: WordList | null;
    cover?: string;
    skipEpub?: boolean;
    onStatus?: (s: string) => void;
  },
): Folio {
  const untwinned = suppressTwins(rawLines);
  const source = untwinned.lines;
  const printed = detectPrinted(source);
  const lexicon = options.lexicon || null;
  const bookmark = normalizeOutline(options.outline || []);
  const trustOutline = outlineCoversStart(bookmark);
  const numbered = trustOutline ? { items: [] as OutlineItem[], drop: new Set<Line>() } : contentsOutline(source, printed, lexicon);
  let damaged = "";
  if (lexicon && contentsDamaged(source, lexicon)) {
    const span = scrapContents(source);
    const heads = source.filter((line) => !span.has(line) && chapterLabel(line.text)).length;
    if (heads >= 3) {
      numbered.items = [];
      for (const line of span) numbered.drop.add(line);
      damaged = "The printed contents could not be read, so the chapters follow the headings.";
    }
  }
  if (numbered.items.length >= 4 && contentsIncomplete(numbered.items, source, numbered.drop)) {
    const pages = new Set<number>();
    for (const line of numbered.drop) pages.add(line.page);
    for (const line of source) if (pages.has(line.page)) numbered.drop.add(line);
    numbered.items = [];
    damaged = "The printed contents missed later chapters, so the chapters follow the headings.";
  }
  const titled = trustOutline || numbered.items.length >= 2 ? { items: [] as OutlineItem[], drop: new Set<Line>() } : titleOutline(source);
  const skipContents = printedContentsLines(source);
  const furniture = repeatedFurniture(source);
  let headers = 0;
  const kept: Line[] = [];
  for (const ln of source) {
    if (skipContents.has(ln) || numbered.drop.has(ln) || titled.drop.has(ln)) continue;
    const text = ln.text.replace(/\s+/g, " ").trim();
    const edge = nearEdge(ln) && text.length < 72;
    const key = furnitureKey(text);
    if (edge && (bareFolioNumber(text) || (furniture.repeated.has(key) && !spokenOnce(text, key, furniture.pages)))) {
      headers++;
      continue;
    }
    kept.push(ln);
  }
  if (!kept.length) throw new Error(options.emptyMessage);
  const shaped = shapeLines(kept);
  if (untwinned.note) options.onStatus?.(untwinned.note);
  if (shaped.note) options.onStatus?.(shaped.note);
  const bodyH = median(shaped.lines.map((ln) => ln.h));
  const margin = median(shaped.lines.filter((ln) => ln.x1 - ln.x0 > 80).map((ln) => Math.round(ln.x0 / 2) * 2));
  const leads: number[] = [];
  for (let i = 1; i < shaped.lines.length; i++) {
    const prev = shaped.lines[i - 1];
    const ln = shaped.lines[i];
    if (prev.page !== ln.page || prev.table || ln.table || prev.role === "note" || ln.role === "note") continue;
    const gap = prev.y - ln.y;
    if (gap > 0 && gap < bodyH * 4) leads.push(gap);
  }
  const lead = median(leads) || bodyH * 1.2;
  const breakGap = Math.max(lead * 1.45, lead + 4);
  const interlinear = interlinearPages(shaped.lines);
  const crib = cribPages(shaped.lines);
  const groups: Line[][] = [];
  let buf: Line[] = [];
  const flush = () => {
    if (buf.length) groups.push(buf);
    buf = [];
  };
  for (const ln of shaped.lines) {
    if (ln.table || ln.role === "note") {
      flush();
      groups.push([ln]);
      continue;
    }
    if (setApart(ln, bodyH)) {
      const last = !buf.length ? groups[groups.length - 1] : null;
      const prev = last && last.length > 0 && last.length <= 3 ? last[last.length - 1] : null;
      if (prev && last && titleWrap(prev, ln)) {
        const joined = `${last.map((line) => line.text).join(" ")} ${ln.text}`.trim();
        if (joined.length <= 80) {
          last.push(ln);
          continue;
        }
      }
      flush();
      groups.push([ln]);
      continue;
    }
    const prev = buf[buf.length - 1];
    const pageBreak = !!prev && prev.page !== ln.page;
    const gap = prev && !pageBreak ? prev.y - ln.y : 0;
    const prevEnded = !!prev && /[.?!]["']?$/.test(prev.text.trim()) && prev.x1 < prev.pageW * 0.78;
    const prevShort = !!prev && prev.x1 < prev.pageW * 0.8;
    const indented = ln.x0 > margin + 8;
    let left = prev ? lineScript(prev.text) : "";
    if (pageBreak && !left) {
      for (let i = buf.length - 1; i >= 0 && i >= buf.length - 4 && !left; i--) left = lineScript(buf[i].text);
    }
    const right = lineScript(ln.text);
    const scriptBreak = !!left && !!right && left !== right;
    const hyphen = !!prev && /[A-Za-z]-$/.test(prev.text);
    const sized = !!prev && !pageBreak && glossSized(prev, ln);
    const glossBreak = sized && gap >= 0 && gap < Math.max(prev.h, ln.h) * 2.2 && (gap < Math.min(prev.h, ln.h) * 1.05 || interlinear.has(ln.page));
    const partial = !!prev && !pageBreak && !hyphen && (underPart(prev, ln) || underPart(ln, prev));
    const narrowWrap = !!prev && ln.x1 - ln.x0 < (prev.x1 - prev.x0) * 0.75 && ln.h < prev.h * 1.45;
    const prevNarrow = !!prev && prev.x1 - prev.x0 < (ln.x1 - ln.x0) * 0.75;
    const heightRatio = prev && prev.h > 0 && ln.h > 0 ? Math.min(prev.h, ln.h) / Math.max(prev.h, ln.h) : 1;
    const inBand = heightRatio > 0.62 && heightRatio < 0.92;
    const cribSplit = !!prev && !pageBreak && crib.has(ln.page) && !narrowWrap && (inBand || prevNarrow);
    const markBreak = chapterMarkLine(ln.text) || (!!prev && chapterMarkLine(prev.text));
    if (prev && (scriptBreak || glossBreak || partial || cribSplit || markBreak || (!hyphen && (gap > breakGap || (indented && (prevEnded || prevShort)) || (pageBreak && prevEnded))))) flush();
    buf.push(ln);
  }
  flush();
  const hyphens = { n: 0 };
  const paras = groups
    .map((group) => {
      if (group[0].table) return { group, runs: [] as Run[], h: group[0].h, table: group[0].table };
      return {
        group,
        runs: joinParagraph(group, hyphens, printed, lexicon),
        h: group[0].h,
        kind: group[0].role === "note" ? ("note" as const) : undefined,
      };
    })
    .filter((p) => p.table || p.runs.some((r) => typeof r === "string" && (r.match(/\p{L}/gu) || []).length > 1));
  if (!paras.length) throw new Error(options.emptyMessage);
  const chosen = trustOutline ? bookmark : numbered.items.length >= 2 ? numbered.items : titled.items;
  const added = chosen.length >= 2 ? addBodyChapters(chosen, paras) : chosen;
  const unique = added.length >= 2 ? uniqueChapters(added) : added;
  const merged = lexicon && unique.length >= 2 ? polishChapters(unique, paras, lexicon) : unique;
  if (lexicon && merged.length >= 2) retouchOpenings(paras, merged, lexicon);
  options.onStatus?.(
    trustOutline
      ? `Contents from the file's own list, ${bookmark.length} chapters`
      : numbered.items.length >= 2
        ? `Contents from the titles and page numbers, ${numbered.items.length} chapters`
        : titled.items.length >= 2
          ? `Contents from the headings, ${titled.items.length} chapters`
          : damaged || "No contents list. The chapters follow the headings.",
  );
  if (hyphens.n) options.onStatus?.(`Rejoined ${hyphens.n} ${hyphens.n === 1 ? "word" : "words"} split across a line`);
  if (headers) options.onStatus?.(`Left out ${headers} running ${headers === 1 ? "head" : "heads"}`);
  const reading = merged.length >= 2 ? withOutline(paras, merged, options.title, printed) : withHeadings(paras, options.title, bodyH, printed, lexicon);
  const chapters = presentContents(reading);
  const folio: Folio = {
    title: options.title,
    subtitle: options.subtitle,
    author: options.author || "",
    stats: { hyphensRejoined: hyphens.n, headersRemoved: headers, chapters: chapters.filter((chapter) => chapter.id !== "contents").length },
    toc: tocOf(chapters),
    chapters,
  };
  if (untwinned.note || shaped.note) folio.warning = [untwinned.note, shaped.note].filter(Boolean).join(" ");
  options.onStatus?.(`${folio.stats.chapters} ${folio.stats.chapters === 1 ? "chapter" : "chapters"}`);
  if (options.cover) folio.cover = options.cover;
  if (!options.skipEpub) {
    options.onStatus?.("Making the EPUB");
    folio.epubHref = epubBlob(folio, options.sourceName);
    folio.epubName = `${options.title.replace(/[^\w.-]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "folio"}.epub`;
  }
  return folio;
}

const WORDS_A_PAGE = 320;

/** A book that already has paragraphs, rather than a picture of a page. */
export function folioFromPieces(
  pieces: { level: 0 | 1 | 2; text: string }[],
  meta: { title: string; subtitle: string; author?: string; sourceName: string },
): Folio {
  const chapters: Folio["chapters"] = [];
  let current: Folio["chapters"][number] | null = null;
  let page = 1;
  let words = 0;
  for (const piece of pieces) {
    const text = piece.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (piece.level === 1) {
      current = pushChapter(chapters, text, page);
      continue;
    }
    if (!current) current = pushChapter(chapters, meta.title, page);
    if (piece.level === 2) {
      current.blocks.push({ t: "h2", id: `${current.id}-s${current.blocks.length}`, s: text, page, section: true });
      continue;
    }
    current.blocks.push({ t: "p", runs: [piece.text], page });
    words += text.split(" ").length;
    if (words >= WORDS_A_PAGE) {
      page += 1;
      words = 0;
    }
  }
  if (!chapters.length) throw new Error("No text could be read from that file.");
  const presented = presentContents(chapters);
  const folio: Folio = {
    title: meta.title,
    subtitle: meta.subtitle,
    author: meta.author || "",
    stats: { hyphensRejoined: 0, headersRemoved: 0, chapters: presented.filter((chapter) => chapter.id !== "contents").length },
    toc: tocOf(presented),
    chapters: presented,
  };
  folio.epubHref = epubBlob(folio, meta.sourceName);
  folio.epubName = `${meta.title.replace(/[^\w.-]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "folio"}.epub`;
  return folio;
}

/** Rebuild the downloadable EPUB after a passage has been edited. */
export function republish(folio: Folio): Folio {
  if (typeof document === "undefined") return folio;
  if (folio.epubHref?.startsWith("blob:") && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(folio.epubHref);
  const next: Folio = { ...folio };
  next.epubHref = epubBlob(next, next.epubName || next.title);
  if (!next.epubName) {
    next.epubName = `${next.title.replace(/[^\w.-]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "folio"}.epub`;
  }
  return next;
}
