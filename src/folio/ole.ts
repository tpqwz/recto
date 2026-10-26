import { decode1252, decodeUtf16, u16, u32 } from "./binary.ts";
import { piecesFromText, type Piece } from "./markup.ts";

const FREE = 0xffffffff;
const END = 0xfffffffe;
const FATSECT = 0xfffffffd;
const NOSTREAM = 0xffffffff;

function sectorChain(fat: number[], start: number) {
  const out: number[] = [];
  let n = start;
  const seen = new Set<number>();
  while (n < fat.length && n !== END && n !== FREE && !seen.has(n) && out.length < 100000) {
    seen.add(n);
    out.push(n);
    n = fat[n];
  }
  return out;
}

function readChain(data: Uint8Array, fat: number[], start: number, size: number, secSize: number) {
  const out = new Uint8Array(size);
  let filled = 0;
  for (const id of sectorChain(fat, start)) {
    const at = 512 + id * secSize;
    const take = Math.min(secSize, size - filled);
    out.set(data.subarray(at, at + take), filled);
    filled += take;
    if (filled >= size) break;
  }
  return out;
}

/** OLE compound file. Word .doc files are one of these. */
export function compoundStreams(data: Uint8Array) {
  if (data.length < 512 || data[0] !== 0xd0 || data[1] !== 0xcf || data[2] !== 0x11 || data[3] !== 0xe0) {
    throw new Error("Not a Word document.");
  }
  const secSize = 1 << u16(data, 0x1e);
  const miniSize = 1 << u16(data, 0x20);
  const fatCount = u32(data, 0x2c);
  const dirStart = u32(data, 0x30);
  const miniCutoff = u32(data, 0x38);
  const miniFatStart = u32(data, 0x3c);
  const fatSectors: number[] = [];
  for (let i = 0; i < 109 && fatSectors.length < fatCount; i++) {
    const id = u32(data, 0x4c + i * 4);
    if (id !== FREE) fatSectors.push(id);
  }
  const fat: number[] = [];
  for (const id of fatSectors) {
    const at = 512 + id * secSize;
    for (let o = 0; o + 4 <= secSize; o += 4) fat.push(u32(data, at + o));
  }
  const dirBytes = readChain(data, fat, dirStart, sectorChain(fat, dirStart).length * secSize, secSize);
  type Entry = { name: string; type: number; start: number; size: number };
  const entries: Entry[] = [];
  for (let o = 0; o + 128 <= dirBytes.length; o += 128) {
    const type = dirBytes[o + 0x42];
    if (!type) continue;
    const nameChars = Math.max(0, u16(dirBytes, o + 0x40) / 2 - 1);
    let name = "";
    for (let c = 0; c < nameChars; c++) name += String.fromCharCode(u16(dirBytes, o + c * 2));
    entries.push({ name, type, start: u32(dirBytes, o + 0x74), size: u32(dirBytes, o + 0x78) });
  }
  const root = entries[0];
  const miniFat =
    miniFatStart === END || miniFatStart === FREE
      ? new Uint8Array()
      : readChain(data, fat, miniFatStart, sectorChain(fat, miniFatStart).length * secSize, secSize);
  const miniTable: number[] = [];
  for (let o = 0; o + 4 <= miniFat.length; o += 4) miniTable.push(u32(miniFat, o));
  const miniStream = root ? readChain(data, fat, root.start, root.size, secSize) : new Uint8Array();
  const streams = new Map<string, Uint8Array>();
  for (const entry of entries) {
    if (entry.type !== 2 || !entry.name) continue;
    if (entry.size < miniCutoff && miniTable.length) {
      const out = new Uint8Array(entry.size);
      let filled = 0;
      let n = entry.start;
      const seen = new Set<number>();
      while (n < miniTable.length && n !== END && n !== FREE && !seen.has(n) && filled < entry.size) {
        seen.add(n);
        const at = n * miniSize;
        const take = Math.min(miniSize, entry.size - filled);
        out.set(miniStream.subarray(at, at + take), filled);
        filled += take;
        n = miniTable[n];
      }
      streams.set(entry.name, out);
    } else {
      streams.set(entry.name, readChain(data, fat, entry.start, entry.size, secSize));
    }
  }
  return streams;
}

function story(word: Uint8Array, table: Uint8Array) {
  const flags = u16(word, 0x0a);
  const complex = (flags & 0x0004) !== 0;
  const csw = u16(word, 0x20);
  const cslwAt = 0x22 + csw * 2;
  const cslw = u16(word, cslwAt);
  const longs = cslwAt + 2;
  let ccpText = u32(word, longs + 4);
  if (!ccpText || ccpText > 50_000_000) ccpText = u32(word, 0x4c);
  if (!complex) {
    const fcMin = u32(word, 0x18);
    const fcMac = u32(word, 0x1c);
    const slice = word.subarray(fcMin, Math.min(word.length, fcMac));
    const text = flags & 0x1000 ? decodeUtf16(slice) : decode1252(slice);
    return text.slice(0, ccpText || text.length);
  }
  const pairsAt = longs + cslw * 4 + 2;
  const clxAt = pairsAt + 33 * 8;
  const fcClx = u32(word, clxAt);
  const lcbClx = u32(word, clxAt + 4);
  const clx = table.subarray(fcClx, fcClx + lcbClx);
  let i = 0;
  while (i < clx.length && clx[i] === 1) {
    const size = u16(clx, i + 1);
    i += 3 + size;
  }
  if (clx[i] !== 2) throw new Error("This Word file has no readable text.");
  const lcb = u32(clx, i + 1);
  const plc = clx.subarray(i + 5, i + 5 + lcb);
  const pieces = Math.floor((lcb - 4) / 12);
  let text = "";
  for (let n = 0; n < pieces && text.length < ccpText; n++) {
    const cp = u32(plc, n * 4);
    const next = u32(plc, (n + 1) * 4);
    const pcd = (pieces + 1) * 4 + n * 8;
    let fc = u32(plc, pcd + 2);
    const count = Math.min(next - cp, ccpText - text.length);
    if (count <= 0) continue;
    if (fc & 0x40000000) {
      fc = (fc & 0x3fffffff) >>> 1;
      text += decode1252(word.subarray(fc, fc + count));
    } else {
      text += decodeUtf16(word.subarray(fc, fc + count * 2));
    }
  }
  return text;
}

function plain(raw: string) {
  return raw
    .replace(/\r/g, "\n")
    .replace(/[\u0001\u0007\u0008\u0013\u0014\u0015]/g, "")
    .replace(/\u000b/g, " ")
    .replace(/\u000c/g, "\n\n");
}

export function piecesFromDoc(data: Uint8Array): { pieces: Piece[]; title: string } {
  const streams = compoundStreams(data);
  const word = streams.get("WordDocument");
  if (!word || word.length < 0x20 || u16(word, 0) !== 0xa5ec) throw new Error("That Word file has no document stream.");
  const which = u16(word, 0x0a) & 0x0200 ? "1Table" : "0Table";
  const table = streams.get(which) || streams.get("1Table") || streams.get("0Table") || new Uint8Array();
  const text = plain(story(word, table));
  const pieces = piecesFromText(text);
  if (!pieces.length) throw new Error("No text could be read from that Word file.");
  return { pieces, title: "" };
}
