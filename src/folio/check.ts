import { strFromU8, unzipSync } from "fflate";
import type { Folio } from "./assemble.ts";

export type CheckReport = { lines: string[] };

function readingMatter(text: string) {
  const start = text.search(/\*\*\*\s*START OF (?:THE |THIS )?PROJECT GUTENBERG/i);
  const end = text.search(/\*\*\*\s*END OF (?:THE |THIS )?PROJECT GUTENBERG/i);
  if (start >= 0 && end > start) return text.slice(text.indexOf("\n", start) + 1, end);
  return text;
}

function stripTags(text: string) {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, '"')
    .replace(/&#39;|'/g, "'")
    .replace(/&nbsp;/g, " ");
}

function words(text: string) {
  return readingMatter(text)
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9']+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 1);
}

function shingles(tokens: string[], size: number) {
  const out: string[] = [];
  for (let i = 0; i + size <= tokens.length; i++) out.push(tokens.slice(i, i + size).join(" "));
  return out;
}

export function folioText(folio: Folio) {
  const parts: string[] = [];
  for (const chapter of folio.chapters) {
    for (const block of chapter.blocks) {
      if (block.t === "toc-entry") continue;
      if (block.s) parts.push(block.s);
      if (block.runs) parts.push(block.runs.filter((run): run is string => typeof run === "string").join(" "));
      if (block.rows) parts.push(block.rows.map((row) => row.join(" ")).join(" "));
    }
  }
  return parts.join("\n");
}

export function textFromReference(name: string, bytes: Uint8Array) {
  const zip = name.toLowerCase().endsWith(".epub") || (bytes[0] === 0x50 && bytes[1] === 0x4b);
  if (!zip) return readingMatter(stripTags(new TextDecoder().decode(bytes)));
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("Could not read that EPUB.");
  }
  const names = Object.keys(files)
    .filter((file) => /\.(?:x?html|htm|txt)$/i.test(file) && !/(?:nav\.xhtml|toc\.ncx|content\.opf)$/i.test(file))
    .sort();
  if (!names.length) throw new Error("That EPUB has no text.");
  return names.map((file) => stripTags(strFromU8(files[file]))).join("\n");
}

export function checkSameText(bookText: string, referenceText: string): CheckReport {
  const size = 5;
  const book = words(bookText);
  const reference = words(referenceText);
  if (book.length < 40) return { lines: ["This book has too little text to check."] };
  if (reference.length < 40) return { lines: ["That file is too short to check. Use a text or EPUB of the same translation."] };
  const bookShingles = shingles(book, size);
  const referenceShingles = shingles(reference, size);
  const bookSet = new Set(bookShingles);
  const referenceSet = new Set(referenceShingles);
  let kept = 0;
  for (const gram of referenceShingles) if (bookSet.has(gram)) kept += 1;
  let outside = 0;
  for (const gram of bookShingles) if (!referenceSet.has(gram)) outside += 1;
  const same = Math.round((100 * kept) / referenceShingles.length);
  const extra = Math.round((100 * outside) / bookShingles.length);
  if (same < 15) {
    return { lines: ["This does not look like the same translation.", `${same}% of that text is in this EPUB.`] };
  }
  const lines = [`${same}% of that text is in this EPUB. ${extra}% of this EPUB is not in that text.`];
  const misses: string[] = [];
  let runStart = -1;
  const close = (last: number) => {
    if (last - runStart + 1 < 3) return;
    misses.push(reference.slice(runStart, last + size).slice(0, 10).join(" "));
  };
  for (let i = 0; i < referenceShingles.length && misses.length < 3; i++) {
    const missing = !bookSet.has(referenceShingles[i]);
    if (missing && runStart < 0) runStart = i;
    if (!missing && runStart >= 0) {
      close(i - 1);
      runStart = -1;
    }
  }
  if (runStart >= 0 && misses.length < 3) close(referenceShingles.length - 1);
  for (const miss of misses) lines.push(`Missing: “${miss}”`);
  return { lines };
}
