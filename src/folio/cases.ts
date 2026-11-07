import type { Line } from "./assemble.ts";
import { looksScrappy, lineScript, otherScriptText, scriptHits, type ReaderScript } from "./script.ts";

/**
 * Hard pages are not read as one stream of lines.
 * A two-column page is read down the left column, then the right.
 * Rows whose gaps share the same columns become a table.
 * Small type at the bottom of a page is set apart as a note.
 * A footnote in the same type, at the foot of a column, is set apart too.
 * A page of talk, with a short last line after each speech, is not a poem.
 * A typed letter has several long lines on one margin. The address and the signature may sit elsewhere.
 * A timetable is read across the row, not down the columns.
 * A speaker's name, even in capitals, starts that speech.
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

/**
 * A page of one language stays that language.
 * A page that prints both keeps both, where they were printed. The second script fills the gap; it is not laid over a line that already reads as English.
 * A page of scraps gives way to the script that actually reads it.
 */
export function keepPageLanguage(english: Line[], other: Line[], script: ReaderScript): { lines: Line[]; script: ReaderScript } {
  const textOf = (lines: Line[]) => lines.map((line) => line.text).join(" ");
  const enOk = english.some((line) => line.text.trim()) && !looksScrappy(textOf(english));
  if (!otherReads(other, script)) return { lines: english, script: "en" };
  if (!enOk) return { lines: other, script };
  const solid = english.filter(isSolidEnglish);
  const base = solid.length >= 2 ? solid : english;
  const extra = genuineLines(other, script).filter((line) => !base.some((kept) => overlaps(kept, line)));
  const letters = extra.reduce((n, line) => n + scriptHits(line.text, script), 0);
  if (extra.length < 2 || letters < 24) return { lines: english, script: "en" };
  const merged = [...base, ...extra].sort((a, b) => b.y - a.y || a.x0 - b.x0);
  return { lines: merged, script };
}

function wordCount(text: string) {
  return (text.match(/[A-Za-z]{3,}/g) || []).length;
}

function isSolidEnglish(line: Line) {
  return wordCount(line.text) >= 3;
}

/** The English read has a real passage and another passage that is not English. Two stray marks do not count. */
export function pageLooksMixed(lines: Line[]) {
  let wordish = 0;
  let odd = 0;
  for (const line of lines) {
    const text = line.text.trim();
    if (text.length < 2) continue;
    const words = wordCount(text);
    const letters = text.match(/\p{L}/gu) || [];
    let nonLatin = 0;
    for (const ch of letters) if (!/\p{Script=Latin}/u.test(ch)) nonLatin += 1;
    if (nonLatin >= 4 || (words < 2 && letters.length >= 4)) odd += 1;
    else if (words >= 2) wordish += 1;
  }
  return wordish >= 2 && odd >= 2 && odd * 2 >= wordish;
}

function genuineLines(lines: Line[], script: ReaderScript) {
  if (script === "latin") return lines.filter((line) => wordCount(line.text) >= 3);
  return lines.filter((line) => scriptHits(line.text, script) >= 4 && lineScript(line.text) === script);
}

function otherReads(lines: Line[], script: ReaderScript) {
  const text = lines.map((line) => line.text).join(" ");
  if (script === "latin") return lines.some((line) => line.text.trim()) && !looksScrappy(text);
  return genuineLines(lines, script).length > 0 && scriptHits(text, script) >= 8;
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

function junkChar(ch: string) {
  return /[\\^|~<>{}#@=+`]/.test(ch);
}

/** A token from a drawing. A misspelled word that merely contains a caret stays. A flight number stays too. */
function scrubToken(token: string) {
  if (/^#\d{1,6}$/.test(token)) return token;
  const chars = [...token];
  let junk = 0;
  let letters = 0;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const slash = ch === "/" && !(/\d/.test(chars[i - 1] || "") && /\d/.test(chars[i + 1] || ""));
    if (junkChar(ch) || slash) junk += 1;
    else if (/\p{L}/u.test(ch)) letters += 1;
  }
  if (!junk) return token;
  if (junkChar(chars[0] || "") && letters < 8) return "";
  if (junk >= 2 && junk > letters) return "";
  return token;
}

function scrubPictureText(text: string) {
  return text
    .split(/(\s+)/)
    .map((part) => (/^\s+$/.test(part) ? part : scrubToken(part)))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function pictureShard(text: string) {
  const words = text.match(/[A-Za-z]{4,}/g) || [];
  const letters = (text.match(/\p{L}/gu) || []).length;
  const junk = (text.match(/[\\^|~<>[\]{}#@=+`/]/g) || []).length;
  const brackets = (text.match(/[\[\]]/g) || []).length;
  if (!junk) return false;
  if (junk === brackets && words.length >= 1) return false;
  if (otherScriptText(text) && junk <= letters * 0.2) return false;
  if (words.length >= 2 && letters >= 12 && junk <= letters * 0.15) return false;
  if (words.length >= 1 && letters >= 8 && junk <= 2) return false;
  return junk >= 2 || letters < 8;
}

function wordish(text: string) {
  const words = text.match(/[A-Za-z]{3,}/g) || [];
  return words.length >= 1 && (text.match(/\p{L}/gu) || []).length >= 4;
}

/**
 * Letters read off a drawing sit in the space beside a short line.
 * The sentence itself continues in that hole. The side text does not.
 */
function quietPicture(lines: Line[]): { lines: Line[]; dropped: boolean } {
  let dropped = false;
  const kept: Line[] = [];
  for (const line of lines) {
    if (line.plate) {
      kept.push(line);
      continue;
    }
    const text = scrubPictureText(line.text);
    if (!text || pictureShard(text)) {
      dropped = true;
      continue;
    }
    if (text !== line.text) dropped = true;
    kept.push(text === line.text ? line : { ...line, text });
  }
  const trimmed = kept.map((line) => {
    const cells = line.cells;
    if (!cells || cells.length < 2) return line;
    let splitAt = -1;
    for (let i = 0; i < cells.length - 1; i++) {
      if (cells[i + 1].x0 - cells[i].x1 > Math.max(48, line.h * 3.5)) {
        splitAt = i;
        break;
      }
    }
    if (splitAt < 0) return line;
    const left = cells[splitAt];
    const right = cells[splitAt + 1];
    const below = [...kept]
      .filter((other) => other !== line && other.y < line.y)
      .sort((a, b) => b.y - a.y)
      .find((other) => line.y - other.y < Math.max(line.h, other.h, 8) * 1.8);
    if (!below || !wordish(below.text)) return line;
    if (below.x0 < line.x0 + 12 || below.x0 > left.x1 + 30) return line;
    if (right.x0 < below.x0 + 8) return line;
    const leftText = scrubPictureText(cells.slice(0, splitAt + 1).map((cell) => cell.text).join(" "));
    const rightText = cells.slice(splitAt + 1).map((cell) => cell.text).join(" ");
    const leftLetters = (leftText.match(/\p{L}/gu) || []).length;
    const rightLetters = (rightText.match(/\p{L}/gu) || []).length;
    if (!leftText || !leftLetters || rightLetters > leftLetters * 1.8) return line;
    dropped = true;
    return { ...line, text: leftText, x1: left.x1, cells: cells.slice(0, splitAt + 1) };
  });
  return { lines: trimmed.filter((line) => line.plate || line.text.trim()), dropped };
}

/** "1. Why is the critical point so important?" and "Q. What remains?" A contents title is not written that way. */
export function questionLine(text: string) {
  const title = text.replace(/\s+/g, " ").trim();
  if (/^(?:Q|A)\.\s+\S/.test(title)) return true;
  if (!/^\d{1,3}[.)]\s+\S/.test(title)) return false;
  const rest = title.replace(/^\d{1,3}[.)]\s+/, "");
  const words = rest.split(/\s+/).map((word) => word.replace(/[^A-Za-z'’]/g, "")).filter((word) => word.length >= 2);
  const small = new Set(["a", "an", "the", "and", "or", "but", "nor", "of", "in", "on", "at", "to", "for", "by", "as", "from", "with", "into", "over", "upon", "if", "so", "not", "no", "yes", "than", "that", "this", "these", "those"]);
  const content = words.filter((word) => word.length >= 4 && !small.has(word.toLowerCase()));
  const lower = content.filter((word) => /^[a-z]/.test(word));
  const upper = content.filter((word) => /^[A-Z]/.test(word));
  // A title keeps its capitals. A question is written in ordinary words.
  if (lower.length >= 2 && lower.length > upper.length) return true;
  return /\?\s*$/.test(title) && lower.length >= 1;
}
/** A new line in a play or a transcript: "Nora. There is", "HELMER. Don't", "DR PAULING; Well", "Helmer (in his room). Is". */
export function speechOpen(text: string) {
  const title = text.replace(/\s+/g, " ").trim();
  const cue = /^([A-Z][\p{L}'’.-]{0,18}(?:\s+[A-Z][\p{L}'’.-]{0,18}){0,2})(?:\s*[\[(][^)\]]{0,40}[\])])?\s*[.:;!]\s+\S/u.exec(title);
  if (!cue) return false;
  const name = cue[1].replace(/[.\s]+$/g, "");
  if (/^(?:Mr|Mrs|Ms|Dr|St|Prof|No|Vol|pp|cf)$/i.test(name)) return false;
  if (/[a-z]/.test(name)) return true;
  if (/^(?:act|scene|book|part|canto|chapter|stave|appendix|lecture|note|page)$/i.test(name)) return false;
  if (/^(?:M{0,3})(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/i.test(name.replace(/[\s.]+/g, ""))) return false;
  return (name.match(/\p{L}/gu) || []).length >= 3;
}

/** "DR. THOMAS CHALMERS" or "NOT FOR WOMEN ONLY" is a label, not the next line of the paragraph. */
export function labelOpen(text: string) {
  const title = text.replace(/\s+/g, " ").trim();
  if (title.length < 4 || title.length > 42 || /[a-z]/.test(title) || /[.!?]/.test(title)) return false;
  const words = title.split(/\s+/).filter((word) => /\p{L}{2,}/u.test(word));
  return words.length >= 2 && words.length <= 6;
}

/** "c. F. R. Charles F. Richardson" starts a contributor, not a new section. */
export function contributorOpen(text: string) {
  const title = text.replace(/\s+/g, " ").trim();
  if (/^(?:Mr|Mrs|Ms|Dr|St|Prof|No|Vol|pp|cf|Fig)\b/i.test(title)) return false;
  return /^(?:[A-Za-z]{1,3}\.\s*){2,}(?:[*•]\s*)?[A-Z][\p{L}'’-]{3,}/u.test(title);
}

/** "ABOUKIR, a village" or "ABOUT, EDMOND ... , the Spanish" starts an entry. */
export function entryOpen(text: string) {
  const title = text.replace(/\s+/g, " ").trim();
  if (/^(?:yes|and|but|the|for|nor|not)\b/i.test(title)) return false;
  if (/^[A-Z],\s+\p{Ll}/u.test(title)) return true;
  return /^[A-Z][A-Z'’-]{2,}\b/u.test(title) && /,\s+\p{Ll}/u.test(title);
}

const NOTE_MARK = /^(?:\d{1,3}|[*†‡§]|[¹²³⁴⁵⁶⁷⁸⁹⁰])\s+\S/;

/** "6 See Jastrow" or "* The mortality" opens a footnote. "1. The opening" does not. */
export function noteOpen(text: string) {
  return NOTE_MARK.test(text.replace(/\s+/g, " ").trim());
}

function stageOpen(text: string) {
  return /^\[/.test(text.replace(/\s+/g, " ").trim());
}

function playPage(lines: Line[]) {
  const cues = lines.filter((line) => speechOpen(line.text) || stageOpen(line.text)).length;
  return cues >= 4 && cues >= lines.length * 0.18;
}

/** Consecutive prose lines set to one right edge. A list above them is not a poem. */
function justifiedRun(lines: Line[]) {
  let run = 1;
  let best = 1;
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const line = lines[i];
    const wide = line.x1 - line.x0 > 140 && prev.x1 - prev.x0 > 140;
    if (wide && Math.abs(line.x1 - prev.x1) < 8) {
      run += 1;
      if (run > best) best = run;
    } else run = 1;
  }
  return best;
}

/** Prose set to a measure: the wraps share a left edge and a right edge, and the short lines are the ends of sentences. A poem's short lines are not that tail. */
function flushTails(reading: Line[]) {
  if (reading.length < 12) return false;
  const lefts = reading.map((line) => line.x0).sort((a, b) => a - b);
  const left = lefts[Math.floor(lefts.length * 0.2)];
  const edges = reading.map((line) => line.x1).sort((a, b) => a - b);
  const wall = edges[Math.floor(edges.length * 0.7)];
  const flush = reading.filter((line) => Math.abs(line.x0 - left) <= 7);
  if (flush.length < reading.length * 0.45) return false;
  const full = flush.filter((line) => Math.abs(line.x1 - wall) <= 8);
  const tails = flush.filter((line) => line.x1 < wall - 18);
  if (full.length < 6 || tails.length < 3) return false;
  const ended = tails.filter((line) => /[.!?]['"”’]?\s*$/.test(line.text.trim()) || /['"“”]\s*$/.test(line.text.trim()));
  return ended.length >= tails.length * 0.55;
}

/** A typed page: several long lines share one margin. A poem on a small page is not this wide, and a letterhead need not share that margin. */
function typescriptPage(reading: Line[]) {
  if (reading.length < 8) return false;
  const prose = reading.filter((line) => line.x1 - line.x0 >= 240 && (line.text.match(/\p{L}{2,}/gu) || []).length >= 6);
  if (prose.length < 4) return false;
  let best: Line[] = [];
  for (const edge of prose) {
    const band = prose.filter((line) => Math.abs(line.x0 - edge.x0) <= 12);
    if (band.length > best.length) best = band;
  }
  if (best.length < 4) return false;
  const continued = best.filter((line) => {
    const text = line.text.trim();
    return /^\p{Ll}/u.test(text) || /^\d/.test(text) || /[.!?]["'”’]?\s+\p{L}/u.test(text);
  }).length;
  return continued >= 2;
}

/** "Leave 11:40 a.m." beside "Arrive 1:38 p.m." is a timetable, not two columns of prose. */
function schedulePage(lines: Line[]) {
  const body = lines.filter((line) => line.text.replace(/\s+/g, " ").trim().length > 2);
  if (body.length < 8) return false;
  const times = body.filter((line) => /\b\d{1,2}:\d{2}\b/.test(line.text)).length;
  return times >= 4 && times >= body.length * 0.18;
}

/** A poem set to the full measure: a stanza number, and the wrapped lines indented and starting small. */
function tightVerse(lines: Line[]) {
  const body = lines.filter((line) => line.text.replace(/\s+/g, " ").trim().length >= 2);
  if (body.length < 12) return false;
  const marked = body.some((line) => {
    const text = line.text.replace(/\s+/g, " ").trim();
    if (/^[IVXLCDM]{2,8}$/.test(text) && line.x1 - line.x0 < 90) return true;
    return /^(?:[IVXLC]{1,6}|\d{1,3})\.\s*\d{1,3}\./.test(text);
  });
  if (!marked) return false;
  const xs = body.map((line) => line.x0).sort((a, b) => a - b);
  const left = xs[Math.floor(xs.length * 0.2)];
  const indent = xs[Math.floor(xs.length * 0.7)];
  if (indent - left < 12 || indent - left > 48) return false;
  const hung = body.filter((line) => line.x0 <= left + 6);
  const wrapped = body.filter((line) => line.x0 >= indent - 4);
  if (hung.length < 4 || wrapped.length < 4) return false;
  const lower = wrapped.filter((line) => /^\p{Ll}/u.test(line.text.trim())).length;
  return lower >= wrapped.length * 0.6;
}

function versePage(lines: Line[]) {
  const body = lines.filter((line) => {
    if (line.plate || line.role === "note" || line.table) return false;
    const text = line.text.replace(/\s+/g, " ").trim();
    if (text.length < 2) return false;
    if (/^(?:\d{1,4}|[ivxlcdm]{1,6})$/i.test(text)) return false;
    return true;
  });
  if (body.length < 12) return false;
  if (playPage(body)) return false;
  if (tightVerse(body)) return true;
  if (body.filter((line) => questionLine(line.text)).length >= 3) return false;
  if (justifiedRun(body) >= 8) return false;
  const heights = body.map((line) => line.h).filter((h) => h > 0).sort((a, b) => a - b);
  const bodyH = heights[Math.floor(heights.length / 2)] || 12;
  const reading = body.filter((line) => line.h > bodyH * 0.75 && line.h < bodyH * 1.35);
  if (reading.length < 12) return false;
  const widths = reading.map((line) => line.x1 - line.x0).filter((width) => width > 24).sort((a, b) => a - b);
  if (widths.length < 12) return false;
  const hi = widths[Math.floor(widths.length * 0.8)];
  if (hi < 70) return false;
  const pageW = reading[0].pageW || 1;
  const reach = reading.filter((line) => line.x1 > pageW * 0.7).length;
  if (reach > reading.length * 0.9) return false;
  const listed = reading.filter((line) => /(?:\.\s*){3,}|·{2,}/.test(line.text)).length;
  if (listed > reading.length * 0.35) return false;
  if (flushTails(reading)) return false;
  if (typescriptPage(reading)) return false;
  const short = widths.filter((width) => width < hi * 0.78).length;
  if (short >= widths.length * 0.28) return true;
  // A poem in a narrow measure is nearly as wide as prose, but the right edge is ragged.
  const edges = reading.map((line) => line.x1).sort((a, b) => a - b);
  const edge = edges[Math.floor(edges.length / 2)] || 0;
  const shared = edges.filter((x) => Math.abs(x - edge) < 8).length;
  if (shared > edges.length * 0.78) return false;
  const spread = edges[edges.length - 1] - edges[Math.floor(edges.length * 0.2)];
  if (spread < 28 || edge > pageW * 0.93) return false;
  return true;
}

function openGutter(lines: Line[]) {
  const seams = lines.flatMap((line) => line.seams || []);
  if (seams.length < 6) return lines;
  let bestX = 0;
  let bestN = 0;
  const tried = new Set<number>();
  for (const seam of seams) {
    const x = Math.round((seam.x0 + seam.x1) / 2);
    if (tried.has(x)) continue;
    tried.add(x);
    let n = 0;
    for (const line of lines) {
      if ((line.seams || []).some((other) => other.x0 - 1 <= x && other.x1 + 1 >= x)) n += 1;
    }
    if (n > bestN) {
      bestN = n;
      bestX = x;
    }
  }
  if (bestN < 6) return lines;
  // Twelve lines on one gutter are a column, even when the rest of the page already sits on one side.
  if (bestN < lines.length * 0.3 && bestN < 12) return lines;
  const out: Line[] = [];
  for (const line of lines) {
    const seam = [...(line.seams || [])]
      .filter((other) => other.x0 - 2 <= bestX && other.x1 + 2 >= bestX)
      .sort((a, b) => a.x1 - a.x0 - (b.x1 - b.x0))[0];
    if (!seam?.left || !seam.right) {
      out.push(line);
      continue;
    }
    const rest = { ...line };
    delete rest.seams;
    out.push({ ...rest, text: seam.left, x0: seam.leftX0, x1: seam.leftX1, cells: undefined, spans: undefined });
    out.push({ ...rest, text: seam.right, x0: seam.rightX0, x1: seam.rightX1, cells: undefined, spans: undefined });
  }
  return out;
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
  let pictures = 0;
  let verses = 0;
  const out: Line[] = [];
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const pageLines = byPage.get(page) || [];
    const quiet = quietPicture(pageLines);
    if (quiet.dropped) pictures += 1;
    const timetable = schedulePage(quiet.lines);
    const split = timetable ? { body: quiet.lines, notes: [] as Line[] } : splitNotes(quiet.lines, bodyH);
    const opened = timetable ? split.body : openGutter(split.body);
    const ordered = timetable ? opened : orderColumns(opened);
    if (ordered !== opened) columns += 1;
    const lifted = timetable ? { lines: ordered, tables: 0 } : liftTables(ordered);
    tables += lifted.tables;
    const verse = !timetable && opened === split.body && ordered === opened && versePage(lifted.lines);
    if (verse) {
      verses += 1;
      for (const line of lifted.lines) {
        if (line.plate || line.role === "note" || line.table) continue;
        if (line.text.replace(/\s+/g, " ").trim().length < 2) continue;
        line.role = "verse";
      }
    } else if (markColumnNotes(lifted.lines)) notes += 1;
    out.push(...lifted.lines);
    if (split.notes.length) {
      notes += 1;
      out.push(...split.notes);
    }
  }
  const parts: string[] = [];
  if (columns) parts.push(columns === 1 ? "One page was read down each column." : `${columns} pages were read down each column.`);
  if (verses) parts.push(verses === 1 ? "One page was read as verse." : `${verses} pages were read as verse.`);
  if (tables) parts.push(tables === 1 ? "One table was kept as a table." : `${tables} tables were kept as tables.`);
  if (notes) parts.push(notes === 1 ? "Notes on one page were set apart." : `Notes on ${notes} pages were set apart.`);
  if (pictures) parts.push(pictures === 1 ? "Picture letters were left out of the prose." : `Picture letters were left out of the prose on ${pictures} pages.`);
  return { lines: out, note: parts.join(" ") };
}

function splitNotes(pageLines: Line[], bodyH: number): { body: Line[]; notes: Line[] } {
  const pageH = pageLines[0]?.pageH || 792;
  const bottom = pageLines.filter((line) => line.y < pageH * 0.28 && line.h > 0 && line.h <= bodyH * 0.86);
  if (bottom.length < 1 || bottom.length > 8 || bottom.length > pageLines.length * 0.4) return { body: pageLines, notes: [] };
  const top = [...bottom].sort((a, b) => b.y - a.y)[0];
  if (!noteOpen(top.text)) return { body: pageLines, notes: [] };
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
  for (let x = leftEdge + span * 0.35; x <= leftEdge + span * 0.65; x += 2) {
    let left = 0;
    let right = 0;
    let cross = 0;
    const leftLines: Line[] = [];
    const rightLines: Line[] = [];
    for (const line of body) {
      if (line.x1 < x - 2) {
        left += 1;
        leftLines.push(line);
      } else if (line.x0 > x + 2) {
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
  tagColumn(lines.filter((line) => line.x1 < cut + 4));
  tagColumn(lines.filter((line) => line.x0 > cut - 4));
  const spans = (line: Line) => {
    const across = line.x0 < cut - 8 && line.x1 > cut + 8 && line.x1 - line.x0 > span * 0.68;
    const top = line.pageH - Math.min(72, Math.max(48, line.pageH * 0.11));
    const head = line.y > top && line.x0 < cut && line.x1 > cut && line.x1 - line.x0 < span * 0.55 && line.text.trim().length < 40;
    return across || head;
  };
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

/** The unindented edge and the full measure of one column. */
function tagColumn(group: Line[]) {
  if (group.length < 4) return;
  const xs = group.map((line) => line.x0).sort((a, b) => a - b);
  const rights = group.map((line) => line.x1).sort((a, b) => a - b);
  const colLeft = xs[Math.floor(xs.length * 0.12)];
  const colRight = rights[Math.floor(rights.length * 0.86)];
  if (!(colRight > colLeft + 40)) return;
  for (const line of group) {
    line.colLeft = colLeft;
    line.colRight = colRight;
  }
}

/**
 * Footnotes set in the same type as the article, at the foot of a column.
 * Two or more marks ("6 See", "* The") and the lines under them are notes.
 * A numbered line higher up the column is left in the article.
 */
function markColumnNotes(lines: Line[]) {
  const runs: Line[][] = [];
  let run: Line[] = [];
  const flush = () => {
    if (run.length) runs.push(run);
    run = [];
  };
  for (const line of lines) {
    const prev = run[run.length - 1];
    const jumped = prev && (line.page !== prev.page || line.y > prev.y + Math.max(18, prev.h * 2));
    if (jumped) flush();
    run.push(line);
  }
  flush();
  let marked = false;
  for (const column of runs) {
    const pageH = column[0]?.pageH || 792;
    const marks = column.filter((line) => !line.plate && !line.table && !line.role && line.y < pageH * 0.38 && noteOpen(line.text));
    if (marks.length < 2) continue;
    const first = marks[0];
    let on = false;
    for (const line of column) {
      if (line === first) on = true;
      if (!on || line.plate || line.table || line.role) continue;
      line.role = "note";
    }
    marked = true;
  }
  return marked;
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
  if (scrapColumn(run)) return null;
  const listed = run.filter(contentsRow).length;
  if (listed >= run.length * 0.5) return null;
  return run;
}

/** A rule or a punch hole read as a column of one letter is not a table. */
function scrapColumn(run: Line[]) {
  const rows = run.map((line) => line.cells || []);
  const cols = Math.max(...rows.map((cells) => cells.length));
  for (let c = 0; c < cols; c++) {
    const texts = rows.map((row) => (row[c]?.text || "").replace(/\s+/g, " ").trim()).filter(Boolean);
    if (texts.length < 3) continue;
    if (texts.some((text) => /\p{L}{3,}/u.test(text))) continue;
    const tiny = texts.filter((text) => text.replace(/[^\p{L}\p{N}]/gu, "").length <= 3).length;
    if (tiny >= texts.length * 0.6) return true;
  }
  return false;
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
