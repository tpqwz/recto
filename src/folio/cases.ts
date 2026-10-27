import type { Line } from "./assemble.ts";
import { scriptHits, type ReaderScript } from "./script.ts";

/**
 * Hard pages are not read as one stream of lines.
 * A two-column page is read down the left column, then the right.
 * Rows whose gaps share the same columns become a table.
 * Small type at the bottom of a page is set apart as a note.
 * A page that does not match is left alone.
 */
export function readablePicture(lines: Line[]) {
  const text = lines.map((line) => line.text).join(" ");
  const letters = text.match(/\p{L}/gu) || [];
  if (letters.length < 12) return false;
  const latinWords = text.match(/\b[A-Za-z]{3,}\b/g) || [];
  const other = letters.filter((letter) => !/\p{Script=Latin}/u.test(letter)).length;
  if (latinWords.length < 8 && other < 12) return false;
  const junk = (text.match(/[^\p{L}\p{M}\p{N}\s.,;:'"?!()\-—–।॥]/gu) || []).length;
  return junk <= letters.length * 0.45;
}

function overlaps(a: Line, b: Line) {
  const yOverlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (yOverlap < Math.min(a.h, b.h) * 0.4) return false;
  const xOverlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  return xOverlap > 0;
}

function preferLine(english: Line, other: Line, script: ReaderScript) {
  const hits = scriptHits(other.text, script);
  const words = (english.text.match(/[A-Za-z]{3,}/g) || []).length;
  if (hits >= 2 && words < 2) return other;
  if (words >= 2 && hits < 2) return english;
  return hits > words ? other : english;
}

/** Keep English lines and lines of another script from the same page. A line that both readers claimed keeps the clearer one. */
export function mergeScriptLines(english: Line[], other: Line[], script: ReaderScript) {
  const used = new Set<number>();
  const kept: Line[] = [];
  for (const line of english) {
    const match = other.findIndex((candidate, index) => !used.has(index) && overlaps(line, candidate));
    if (match < 0) {
      kept.push(line);
      continue;
    }
    used.add(match);
    kept.push(preferLine(line, other[match], script));
  }
  other.forEach((line, index) => {
    if (!used.has(index)) kept.push(line);
  });
  kept.sort((a, b) => b.y - a.y || a.x0 - b.x0);
  return kept;
}

function squash(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function wordScore(text: string) {
  const words = text.match(/\b[A-Za-z]{3,}\b/g) || [];
  const singles = text.match(/\b[A-Za-z]\b/g) || [];
  return words.join("").length - singles.length * 3;
}

/** A line whose letters are the same phrase twice. The clearer copy is kept. */
export function untwinLine(text: string) {
  const flat = squash(text);
  if (flat.length < 24 || flat.length % 2 !== 0) return text;
  const half = flat.slice(0, flat.length / 2);
  if (half !== flat.slice(flat.length / 2)) return text;
  let seen = "";
  for (let i = 0; i < text.length; i++) {
    seen = squash(text.slice(0, i + 1));
    if (seen.length > half.length) return text;
    if (seen !== half) continue;
    let end = i + 1;
    while (end < text.length && /[^A-Za-z0-9]/.test(text[end]) && squash(text.slice(end + 1)) === half) end += 1;
    const left = text.slice(0, end).trim();
    const right = text.slice(end).trim();
    if (squash(right) !== half) return text;
    return wordScore(left) >= wordScore(right) ? left : right;
  }
  return text;
}

function twinPair(a: Line, b: Line) {
  if (a.page !== b.page) return false;
  const left = squash(a.text);
  const right = squash(b.text);
  if (left.length < 8 || left !== right) return false;
  return Math.abs(a.y - b.y) <= Math.max(a.h, b.h, 8) * 2.4;
}

/**
 * Some files draw every line twice. The second copy is removed only when that
 * is the pattern of the page. One repeated line in a normal page stays.
 */
export function suppressTwins(lines: Line[]): { lines: Line[]; note: string } {
  const opened = lines.map((line) => {
    const text = untwinLine(line.text);
    return text === line.text ? line : { ...line, text, cells: undefined };
  });
  const byPage = new Map<number, Line[]>();
  for (const line of opened) {
    const list = byPage.get(line.page);
    if (list) list.push(line);
    else byPage.set(line.page, [line]);
  }
  let pages = 0;
  const out: Line[] = [];
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const list = byPage.get(page) || [];
    let pairs = 0;
    for (let i = 0; i < list.length - 1; i++) if (twinPair(list[i], list[i + 1])) pairs += 1;
    const twinned = pairs >= 3 && pairs >= list.length * 0.3;
    if (!twinned) {
      out.push(...list);
      continue;
    }
    pages += 1;
    for (let i = 0; i < list.length; i++) {
      const line = list[i];
      const prev = out[out.length - 1];
      if (prev && prev.page === page && twinPair(prev, line)) {
        if (wordScore(line.text) > wordScore(prev.text)) out[out.length - 1] = line;
        continue;
      }
      out.push(line);
    }
  }
  const note = pages
    ? pages === 1
      ? "A second copy of the text was removed on one page."
      : `A second copy of the text was removed on ${pages} pages.`
    : "";
  return { lines: out, note };
}

export function shapeLines(lines: Line[]): { lines: Line[]; note: string } {
  const byPage = new Map<number, Line[]>();
  for (const line of lines) {
    const list = byPage.get(line.page);
    if (list) list.push(line);
    else byPage.set(line.page, [line]);
  }
  const heights = lines.map((line) => line.h).filter((h) => h > 0).sort((a, b) => a - b);
  const bodyH = heights[Math.floor(heights.length / 2)] || 12;
  let columns = 0;
  let tables = 0;
  let notes = 0;
  const out: Line[] = [];
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const pageLines = byPage.get(page) || [];
    const split = splitNotes(pageLines, bodyH);
    const ordered = orderColumns(split.body);
    if (ordered !== split.body) columns += 1;
    const lifted = liftTables(ordered);
    tables += lifted.tables;
    out.push(...lifted.lines);
    if (split.notes.length) {
      notes += 1;
      out.push(...split.notes);
    }
  }
  const parts: string[] = [];
  if (columns) parts.push(columns === 1 ? "One page was read down each column." : `${columns} pages were read down each column.`);
  if (tables) parts.push(tables === 1 ? "One table was kept as a table." : `${tables} tables were kept as tables.`);
  if (notes) parts.push(notes === 1 ? "Notes on one page were set apart." : `Notes on ${notes} pages were set apart.`);
  return { lines: out, note: parts.join(" ") };
}

const NOTE_MARK = /^(?:\d{1,3}|[*†‡§]|[¹²³⁴⁵⁶⁷⁸⁹⁰])\s+\S/;

function splitNotes(pageLines: Line[], bodyH: number): { body: Line[]; notes: Line[] } {
  const pageH = pageLines[0]?.pageH || 792;
  const bottom = pageLines.filter((line) => line.y < pageH * 0.28 && line.h > 0 && line.h <= bodyH * 0.86);
  if (bottom.length < 1 || bottom.length > 8 || bottom.length > pageLines.length * 0.4) return { body: pageLines, notes: [] };
  const top = [...bottom].sort((a, b) => b.y - a.y)[0];
  if (!NOTE_MARK.test(top.text.trim())) return { body: pageLines, notes: [] };
  const marked = new Set(bottom);
  return {
    body: pageLines.filter((line) => !marked.has(line)),
    notes: pageLines.filter((line) => marked.has(line)).map((line) => ({ ...line, role: "note" as const })),
  };
}

function orderColumns(lines: Line[]): Line[] {
  const body = lines.filter((line) => line.text.replace(/\s/g, "").length > 8 && line.y > 48 && line.y < line.pageH - 60);
  if (body.length < 8) return lines;
  const leftEdge = Math.min(...body.map((line) => line.x0));
  const rightEdge = Math.max(...body.map((line) => line.x1));
  const span = rightEdge - leftEdge;
  if (span < 160) return lines;
  const widths = body.map((line) => line.x1 - line.x0).sort((a, b) => a - b);
  const midW = widths[Math.floor(widths.length / 2)];
  if (midW > span * 0.68) return lines;
  let gutter: number | null = null;
  let best = 0;
  for (let x = leftEdge + span * 0.35; x <= leftEdge + span * 0.65; x += 6) {
    let left = 0;
    let right = 0;
    let cross = 0;
    const leftLines: Line[] = [];
    const rightLines: Line[] = [];
    for (const line of body) {
      if (line.x1 < x - 4) {
        left += 1;
        leftLines.push(line);
      } else if (line.x0 > x + 4) {
        right += 1;
        rightLines.push(line);
      } else cross += 1;
    }
    if (left < 4 || right < 4 || cross > body.length * 0.15) continue;
    const leftW = median(leftLines.map((line) => line.x1 - line.x0));
    const rightW = median(rightLines.map((line) => line.x1 - line.x0));
    if (Math.min(leftW, rightW) / Math.max(leftW, rightW) < 0.55) continue;
    const leftY = ySpan(leftLines);
    const rightY = ySpan(rightLines);
    if (leftY < 80 || rightY < 80 || Math.min(leftY, rightY) / Math.max(leftY, rightY) < 0.45) continue;
    const score = left + right - cross * 5;
    if (score > best) {
      best = score;
      gutter = x;
    }
  }
  if (gutter == null) return lines;
  const cut = gutter;
  const spans = (line: Line) => line.x0 < cut - 8 && line.x1 > cut + 8 && line.x1 - line.x0 > span * 0.68;
  const sorted = [...lines].sort((a, b) => b.y - a.y || a.x0 - b.x0);
  const out: Line[] = [];
  let band: Line[] = [];
  const flush = () => {
    out.push(...band.filter((line) => (line.x0 + line.x1) / 2 < cut).sort((a, b) => b.y - a.y));
    out.push(...band.filter((line) => (line.x0 + line.x1) / 2 >= cut).sort((a, b) => b.y - a.y));
    band = [];
  };
  for (const line of sorted) {
    if (spans(line)) {
      flush();
      out.push(line);
    } else band.push(line);
  }
  flush();
  return out;
}

function liftTables(lines: Line[]): { lines: Line[]; tables: number } {
  const out: Line[] = [];
  let tables = 0;
  let index = 0;
  while (index < lines.length) {
    const row = lines[index];
    const run = tableRun(lines, index);
    if (!run) {
      out.push(row);
      index += 1;
      continue;
    }
    const [first, ...rest] = run;
    out.push({
      ...first,
      text: run.flatMap((line) => line.cells?.map((cell) => cell.text) || [line.text]).join(" "),
      cells: undefined,
      table: {
        headers: (first.cells || []).map((cell) => cell.text),
        rows: rest.map((line) => (line.cells || []).map((cell) => cell.text)),
      },
    });
    tables += 1;
    index += run.length;
  }
  return { lines: out, tables };
}

function tableRun(lines: Line[], start: number): Line[] | null {
  const first = lines[start];
  const model = first.cells?.map((cell) => cell.x0);
  if (!model || model.length < 2) return null;
  const run = [first];
  let index = start + 1;
  while (index < lines.length) {
    const line = lines[index];
    if (line.page !== first.page || line.role === "note") break;
    const edges = line.cells?.map((cell) => cell.x0);
    if (!edges || !aligned(model, edges)) break;
    run.push(line);
    index += 1;
  }
  if (run.length < 3) return null;
  const listed = run.filter(contentsRow).length;
  if (listed >= run.length * 0.5) return null;
  return run;
}

function contentsRow(line: Line) {
  const cells = line.cells?.map((cell) => cell.text.trim()).filter(Boolean);
  if (cells && cells.length === 2 && /^([0-9]{1,4}|[ivxlcdm]{1,8})$/i.test(cells[1]) && /[A-Za-z]/.test(cells[0])) return true;
  return /^(.{2,90}?)(?:\s*[.\u00b7…]{2,}\s*|\s{2,})([0-9]{1,4}|[ivxlcdm]{1,8})\s*$/i.test(line.text.trim());
}

function aligned(model: number[], edges: number[]) {
  if (Math.abs(model.length - edges.length) > 1) return false;
  return edges.every((edge) => model.some((at) => Math.abs(at - edge) <= 16));
}

function ySpan(lines: Line[]) {
  return Math.max(...lines.map((line) => line.y)) - Math.min(...lines.map((line) => line.y));
}

function median(nums: number[]) {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
