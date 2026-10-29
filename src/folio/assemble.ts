import { strToU8, zipSync } from "fflate";
import { detectPrinted, type PrintedPages } from "./pages.ts";
import { mergeHyphen, repairText, type WordList } from "./repair.ts";
import { shapeLines, suppressTwins, untwinLine } from "./cases.ts";

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
export type OutlineItem = { label: string; page: number | null; children: OutlineItem[] };
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

export function cluster(items: { str: string; transform: number[]; width?: number; height?: number }[]): { text: string; y: number; x0: number; x1: number; h: number; cells?: { text: string; x0: number; x1: number }[] }[] {
  const its = items
    .filter((it) => it.str && String(it.str).trim())
    .map((it) => ({
      str: String(it.str).replace(/\u00ad/g, ""),
      x: it.transform[4],
      y: it.transform[5],
      w: it.width || 0,
      h: it.height || Math.abs(it.transform[3]) || 8,
    }));
  its.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; items: typeof its }[] = [];
  for (const it of its) {
    let placed = false;
    for (let i = lines.length - 1; i >= 0 && lines.length - i <= 6; i--) {
      const ln = lines[i];
      if (Math.abs(ln.y - it.y) > 3.2) continue;
      if (ln.items.some((o) => Math.min(o.x + o.w, it.x + it.w) - Math.max(o.x, it.x) > 2)) continue;
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
  return lines
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
      return {
        text: text.replace(/[ \t]+/g, " ").trim(),
        y: ln.y,
        x0: ln.items[0].x,
        x1: last.x + last.w,
        h: Math.max(...ln.items.map((i) => i.h || 0)),
        cells: cells.length >= 2 ? cells : undefined,
      };
    })
    .filter((ln) => ln.text.replace(/[^A-Za-z0-9]/g, "").length > 0)
    .sort((a, b) => b.y - a.y || a.x0 - b.x0);
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
    const t = lexicon && !(group.length === 1 && headingKind(group[0].text)) ? repairText(buf, lexicon) : buf.replace(/[ \t]+/g, " ").trim();
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
      if (merged) {
        if (ln.page !== page && printed.label(ln.page) != null) {
          buf = merged.head.trim();
          flush();
          page = ln.page;
          mark(page);
          buf = (merged.rest || "").trim();
        } else {
          buf = `${merged.head}${merged.rest || ""}`.replace(/ +/g, " ").trim();
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

/** XI read as XL still sits between X and XII. A one-letter miss keeps the page order. */
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
    const title = dotted[1].replace(/[.\s]+$/g, "").trim();
    if (title.length > 1) return { title, token: dotted[2], trusted: /^(?:book|chapter|part)\b/i.test(title) };
  }
  const loose = /^(?:\d{1,3}[.)]\s+)?([A-Z].{1,140}?)\s+([0-9]{1,4})$/.exec(text);
  if (loose && !/[.?!]$/.test(loose[1])) return { title: loose[1].trim(), token: loose[2] };
  return null;
}

function contentsPair(cells: string[] | undefined): { title: string; token: string; trusted?: boolean } | null {
  if (!cells) return null;
  const usable = cells.length === 4 && cells[0] === cells[2] && cells[1] === cells[3] ? cells.slice(0, 2) : cells;
  if (usable.length !== 2 || !PAGE_TOKEN.test(usable[1]) || !/[A-Za-z]/.test(usable[0]) || usable[0].length > 90) return null;
  const title = usable[0].replace(/^[^A-Za-z0-9]+/, "").replace(/[.\s]+$/g, "").trim();
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

/** A printed contents list. A list in the front of the book wins over an index at the back. A title the word list does not recognize is a broken contents line, not a chapter. */
function contentsSentence(text: string) {
  const title = text.replace(/\s+/g, " ").trim();
  if (!title) return false;
  if (/^[a-z]/.test(title)) return true;
  if (/[;!?]/.test(title) || /[(){}[\]]/.test(title) || /,/.test(title)) return true;
  if (/[A-Za-z]{4,}\.\s+\S/.test(title)) return true;
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
  return /(?:^|\s)(?:[0-9]{1,4}|[ivxlcdm]{1,8})\s*$/i.test(text.trim());
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
  return title
    .replace(/([A-Za-z])- ([a-z])/g, "$1$2")
    .replace(/[\s.,·…«»\-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
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
  type Hit = { line: Line; title: string; page: number; file: number };
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
      entry.title = entry.title.replace(/^[^A-Za-z0-9]+/, "").replace(/\s+/g, " ").trim();
      if (entry.title.length < 2 || /©|®/.test(entry.title)) continue;
      if (contentsSentence(entry.title) && !/^(?:book|chapter|part)\b/i.test(entry.title)) continue;
      if (!entry.trusted && /^(?:book|chapter|part)\b/i.test(entry.title)) entry.trusted = true;
      if (!entry.trusted && capsTitle(entry.title)) entry.trusted = true;
      if (lexicon && !entry.trusted && !knownTitle(entry.title, lexicon)) continue;
      const page = fileForLabel(printed, entry.token, maxPage);
      if (page === line.page) continue;
      if (!page) {
        if (chapterIndex(entry.title)) hits.push({ line, title: spaceChapter(entry.title.slice(0, 180)), page: 0, file: line.page });
        continue;
      }
      hits.push({ line, title: spaceChapter(entry.title.slice(0, 180)), page, file: line.page });
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
  return {
    items: anchored.slice(0, 400).map((item) => ({ label: unglueSmall(item.title), page: item.page, children: [] })),
    drop,
  };
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
    const ch = pushChapter(chapters, item.label, printed.label(start), start);
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
  const title = text.replace(/\s+/g, " ").trim();
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
function chapterContents(hits: { line: Line; title: string; page: number; file: number }[]): typeof hits | null {
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

function chapterLabel(text: string) {
  const title = text.replace(/\s+/g, " ").trim();
  if (/^(?:chapter|book)\s*\d{1,4}\s*[:.]?\s*$/i.test(title)) return true;
  const roman = /^(?:chapter|book)\s+([ivxlcdm]{1,8})\s*[:.]?\s*$/i.exec(title);
  if (roman && romanChapter(roman[1])) return true;
  return /^(?:chapter|book)\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s*[:.]?\s*$/i.test(title);
}

function headingKind(text: string): "chapter" | "section" | "title" | null {
  const title = text.replace(/\s+/g, " ").trim().replace(/^[^A-Za-z0-9]+/, "");
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
      open(spaceChapter(subtitle ? `${softenHeading(text)}. ${subtitle}` : softenHeading(text)), p);
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
  let headers = 0;
  const kept: Line[] = [];
  for (const ln of source) {
    if (skipContents.has(ln) || numbered.drop.has(ln) || titled.drop.has(ln)) continue;
    const short = ln.text.length < 72;
    const folioLine = /\d/.test(ln.text) || ln.text.length < 40;
    const header = ln.y > ln.pageH - 54 && short && folioLine;
    const footer = ln.y < 36 && short && folioLine;
    if (header || footer) {
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
    if (prev && !/[A-Za-z]-$/.test(prev.text) && (gap > breakGap || (indented && (prevEnded || prevShort)) || (pageBreak && prevEnded))) flush();
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
    .filter((p) => p.table || p.runs.some((r) => typeof r === "string" && r.replace(/[^A-Za-z]/g, "").length > 1));
  if (!paras.length) throw new Error(options.emptyMessage);
  const chosen = trustOutline ? bookmark : numbered.items.length >= 2 ? numbered.items : titled.items;
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
  const reading = chosen.length >= 2 ? withOutline(paras, chosen, options.title, printed) : withHeadings(paras, options.title, bodyH, printed, lexicon);
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
