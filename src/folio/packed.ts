import { strFromU8, unzipSync, type Unzipped } from "fflate";
import { latin1, u16, u32 } from "./binary.ts";
import { piecesFromHtml, piecesFromLrs, piecesFromText, type Piece } from "./markup.ts";

export function unzip(data: Uint8Array): Unzipped {
  try {
    return unzipSync(data);
  } catch {
    throw new Error("That archive could not be opened.");
  }
}

export function textOf(bytes: Uint8Array) {
  const decode = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : "utf-8";
  return new TextDecoder(decode).decode(bytes);
}

const IMAGE = /\.(png|jpe?g|gif|webp|tiff?|bmp)$/i;

export function imageNames(files: Unzipped) {
  return Object.keys(files)
    .filter((name) => IMAGE.test(name) && !name.startsWith("__MACOSX") && !name.split("/").pop()?.startsWith("."))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function zipKind(files: Unzipped): "docx" | "epub" | "fb2" | "ocr" | "pages" | "html" | "text" | "unknown" {
  const names = Object.keys(files);
  if (names.some((name) => name === "word/document.xml" || name.endsWith("/word/document.xml"))) return "docx";
  if (names.some((name) => name === "META-INF/container.xml")) return "epub";
  if (names.some((name) => name.toLowerCase().endsWith(".fb2"))) return "fb2";
  if (names.some((name) => /\.(html?|xml|hocr|alto)$/i.test(name) && /ocr_page|HPOS=|<alto[\s>]/i.test(textOf(files[name]).slice(0, 2000)))) return "ocr";
  if (imageNames(files).length) return "pages";
  if (names.some((name) => /\.html?$/i.test(name))) return "html";
  if (names.some((name) => /\.txt$/i.test(name))) return "text";
  return "unknown";
}

function attr(src: string, name: string) {
  return new RegExp(`${name}="([^"]*)"`, "i").exec(src)?.[1] || "";
}

export function piecesFromEpub(files: Unzipped): { pieces: Piece[]; title: string; author: string } {
  const container = textOf(files["META-INF/container.xml"] || new Uint8Array());
  const root = /full-path="([^"]+)"/i.exec(container)?.[1] || "";
  const opf = textOf(files[root] || new Uint8Array());
  const base = root.includes("/") ? root.slice(0, root.lastIndexOf("/") + 1) : "";
  const titled = /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(opf)?.[1] || "";
  const author = /<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i.exec(opf)?.[1] || "";
  const manifest = new Map<string, string>();
  for (const item of opf.match(/<item\b[^>]*>/gi) || []) {
    const id = attr(item, "id");
    const href = attr(item, "href");
    if (id && href) manifest.set(id, decodeURIComponent(href));
  }
  const spine = [...opf.matchAll(/<itemref\b[^>]*>/gi)].map((item) => attr(item[0], "idref"));
  const pieces: Piece[] = [];
  for (const id of spine) {
    const href = manifest.get(id);
    if (!href) continue;
    const file = files[base + href] || files[href];
    if (!file) continue;
    const read = piecesFromHtml(textOf(file));
    pieces.push(...read.pieces);
  }
  if (!pieces.length) throw new Error("No text could be read from that EPUB.");
  return {
    pieces,
    title: titled.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
    author: author.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
  };
}

export function piecesFromDocx(files: Unzipped): { pieces: Piece[]; title: string; author: string } {
  const xml = textOf(files["word/document.xml"] || new Uint8Array());
  const core = textOf(files["docProps/core.xml"] || new Uint8Array());
  const title = /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(core)?.[1]?.replace(/\s+/g, " ").trim() || "";
  const author = /<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i.exec(core)?.[1]?.replace(/\s+/g, " ").trim() || "";
  const pieces: Piece[] = [];
  for (const para of xml.split(/<w:p[\s>]/).slice(1)) {
    const style = /<w:pStyle\b[^>]*w:val="([^"]+)"/i.exec(para)?.[1] || "";
    const text = [...para.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
      .map((found) => found[1])
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    const level: 0 | 1 | 2 = /^heading\s*1$/i.test(style) || style === "Title" ? 1 : /^heading\s*[2-4]$/i.test(style) ? 2 : 0;
    pieces.push({ level, text });
  }
  if (!pieces.length) throw new Error("No text could be read from that Word file.");
  return { pieces, title, author };
}

/** RAR is only unpacked when the pages are stored, not compressed. A compressed comic should be saved as a zip. */
export function rarStored(data: Uint8Array): { name: string; bytes: Uint8Array }[] {
  const rar5 = data[6] === 1;
  if (rar5) return rar5Stored(data);
  if (!(data[0] === 0x52 && data[1] === 0x61 && data[2] === 0x72 && data[3] === 0x21)) throw new Error("That does not look like a RAR comic.");
  const files: { name: string; bytes: Uint8Array }[] = [];
  let i = 7;
  let compressed = false;
  while (i + 7 < data.length) {
    const flags = u16(data, i + 3);
    const size = u16(data, i + 5);
    let header = size;
    let add = 0;
    if (flags & 0x8000) {
      add = u32(data, i + 7);
      header = size;
    }
    const type = data[i + 2];
    if (type === 0x74 && i + size <= data.length) {
      const base = i + (flags & 0x8000 ? 11 : 7);
      const pack = u32(data, base);
      const method = data[base + 18];
      const nameLen = u16(data, base + 19);
      let nameAt = base + 25;
      if (flags & 0x100) nameAt += 8;
      const name = latin1(data, nameAt, nameLen);
      if (method !== 0x30) compressed = true;
      else files.push({ name, bytes: data.subarray(i + size, i + size + (add || pack)) });
    }
    const step = size + ((flags & 0x8000) ? add : 0);
    if (step <= 0) break;
    i += step;
  }
  if (!files.length && compressed) {
    throw new Error("This comic is a compressed RAR. Save the pages as a zip and open that. The desk does not include a RAR unpacker.");
  }
  return files;
}

function vint(data: Uint8Array, at: number) {
  let value = 0;
  let i = at;
  let shift = 0;
  while (i < data.length && shift < 56) {
    const byte = data[i++];
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value, next: i };
    shift += 7;
  }
  return { value, next: i };
}

function rar5Stored(data: Uint8Array) {
  const files: { name: string; bytes: Uint8Array }[] = [];
  let i = 8;
  let compressed = false;
  while (i + 8 < data.length) {
    const crc = i;
    i += 4;
    const header = vint(data, i);
    const type = vint(data, header.next);
    const flags = vint(data, type.next);
    let extra = flags.next;
    let dataSize = 0;
    if (flags.value & 0x0001) {
      const sized = vint(data, extra);
      dataSize = sized.value;
      extra = sized.next;
    }
    const headerEnd = crc + 4 + header.value;
    if (type.value === 2 && headerEnd + dataSize <= data.length) {
      const fileFlags = vint(data, extra);
      let p = vint(data, fileFlags.next).next;
      p = vint(data, p).next;
      if (fileFlags.value & 0x0002) p += 4;
      if (fileFlags.value & 0x0004) p += 4;
      const comp = vint(data, p);
      p = vint(data, comp.next).next;
      const nameLen = vint(data, p);
      const name = latin1(data, nameLen.next, nameLen.value);
      const method = comp.value & 0x3f;
      if (method !== 0) compressed = true;
      else files.push({ name, bytes: data.subarray(headerEnd, headerEnd + dataSize) });
    }
    if (header.value <= 0) break;
    i = headerEnd + dataSize;
  }
  if (!files.length && compressed) {
    throw new Error("This comic is a compressed RAR. Save the pages as a zip and open that. The desk does not include a RAR unpacker.");
  }
  return files;
}

export function litFiles(data: Uint8Array): { name: string; bytes: Uint8Array }[] {
  if (latin1(data, 0, 4) !== "ITSF") throw new Error("That does not look like a LIT book.");
  const headerLen = u32(data, 8);
  if (latin1(data, headerLen, 4) === "ITSP") {
    return readItsp(data, headerLen);
  }
  const sectionAt = Number(u32(data, 0x58)) || headerLen;
  if (latin1(data, sectionAt, 4) !== "ITSP") {
    throw new Error("This LIT is packed or sealed. Open an HTML, PDF, or EPUB of the same book.");
  }
  return readItsp(data, sectionAt);
}

function readItsp(data: Uint8Array, at: number) {
  const blockLen = u32(data, at + 0x0c) || 0x1000;
  const indexHead = u32(data, at + 0x18);
  const dirStart = at + u32(data, at + 0x08);
  const files: { name: string; bytes: Uint8Array }[] = [];
  const listing = data.subarray(dirStart + indexHead * blockLen, dirStart + (indexHead + 1) * blockLen);
  if (latin1(listing, 0, 4) !== "PMGL" && latin1(listing, 0, 4) !== "PMGI") {
    throw new Error("This LIT is packed or sealed. Open an HTML, PDF, or EPUB of the same book.");
  }
  let p = 4 + 2 + 2 + 2;
  const contentAt = dirStart + blockLen * 8;
  while (p + 10 < listing.length) {
    const nameLen = Math.min(listing[p], 180);
    if (!nameLen) break;
    const name = latin1(listing, p + 1, nameLen);
    p += 1 + nameLen;
    if (!name.startsWith("/")) {
      p += 1;
      continue;
    }
    const offset = u32(listing, p);
    const length = u32(listing, p + 4);
    p += 8;
    if (offset + length <= data.length - contentAt && length > 0 && length < 20_000_000) {
      files.push({ name, bytes: data.subarray(contentAt + offset, contentAt + offset + length) });
    }
  }
  if (!files.length) throw new Error("This LIT is packed with LZX, or it is sealed. Open an HTML, PDF, or EPUB of the same book.");
  return files;
}

function lrfScore(bytes: Uint8Array) {
  let score = 0;
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    if (bytes[i + 1] === 0 && bytes[i] >= 32 && bytes[i] < 127) score++;
  }
  return score;
}

function lrfXor(bytes: Uint8Array, key: number) {
  const out = new Uint8Array(bytes.length);
  let k = key & 0xffff;
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i] ^ (k & 0xff);
    k = ((k & 0xff) << 8) | ((k >> 8) & 0xff);
  }
  return out;
}

export function piecesFromLrf(data: Uint8Array): { pieces: Piece[]; title: string; warning?: string } {
  if (latin1(data, 0, 4) !== "LRF\0") throw new Error("That does not look like a Sony LRF book.");
  const key = u16(data, 6);
  const objects = u32(data, 0x0c);
  const indexAt = u32(data, 0x14);
  const plain = data.subarray(0x20);
  const scrambled = key ? lrfXor(data.subarray(0x20), key) : plain;
  const best = lrfScore(scrambled) > lrfScore(plain) ? scrambled : plain;
  const runs: string[] = [];
  let buf = "";
  for (let i = 0; i + 1 < best.length; i += 2) {
    const code = best[i] | (best[i + 1] << 8);
    if (code === 10 || code === 13) {
      if (buf.trim().length > 20) runs.push(buf.trim());
      buf = "";
    } else if (code >= 32 && code < 0xfff0) buf += String.fromCharCode(code);
    else {
      if (buf.trim().length > 40) runs.push(buf.trim());
      buf = "";
    }
  }
  if (buf.trim().length > 40) runs.push(buf.trim());
  const pieces = piecesFromText(runs.join("\n\n"));
  if (pieces.length < 2 && objects && indexAt) {
    throw new Error("This Sony LRF could not be read. Open the LRS, EPUB, or PDF of the same book.");
  }
  return { pieces, title: "", warning: "Read from a Sony LRF. Check the wording." };
}

export function piecesFromLit(data: Uint8Array) {
  const files = litFiles(data);
  const pieces: Piece[] = [];
  let title = "";
  for (const file of files) {
    if (!/\.(html?|xml|txt)$/i.test(file.name)) continue;
    const text = textOf(file.bytes);
    if (/\.txt$/i.test(file.name)) pieces.push(...piecesFromText(text));
    else if (/<FictionBook[\s>]/i.test(text)) continue;
    else {
      const read = /<lrf[\s>]/i.test(text) ? piecesFromLrs(text) : piecesFromHtml(text);
      if (!title) title = read.title;
      pieces.push(...read.pieces);
    }
  }
  if (!pieces.length) throw new Error("This LIT is packed with LZX, or it is sealed. Open an HTML, PDF, or EPUB of the same book.");
  return { pieces, title };
}

export function utf8(bytes: Uint8Array) {
  return strFromU8(bytes);
}
