import { decode1252, latin1, u16, u16be, u32, u32be } from "./binary.ts";
import { piecesFromHtml, piecesFromText, type Piece } from "./markup.ts";

const LOCKED = "This file is locked. Open a copy that is not encrypted.";

function recordsOf(data: Uint8Array) {
  const count = u16(data, 0x4c);
  if (count < 1 || count > 200000 || 0x4e + count * 8 > data.length) return null;
  const offsets: number[] = [];
  for (let i = 0; i < count; i++) offsets.push(u32(data, 0x4e + i * 8));
  if (offsets[0] < 0x4e + count * 8) return null;
  for (let i = 1; i < offsets.length; i++) if (offsets[i] < offsets[i - 1] || offsets[i] > data.length) return null;
  offsets.push(data.length);
  return offsets;
}

export function isPalm(data: Uint8Array) {
  if (data.length < 0x60) return false;
  const type = latin1(data, 0x3c, 4);
  const creator = latin1(data, 0x40, 4);
  const known = type === "BOOK" || type === "TEXt" || type === "PNRd" || type === "zTXT" || creator === "MOBI" || creator === "REAd";
  return known && recordsOf(data) != null;
}

function palmdoc(bytes: Uint8Array) {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const mark = bytes[i];
    if (mark === 0) {
      out.push(0);
    } else if (mark <= 8) {
      for (let n = 0; n < mark && i + 1 < bytes.length; n++) out.push(bytes[++i]);
    } else if (mark < 0x80) {
      out.push(mark);
    } else if (mark < 0xc0) {
      const next = bytes[++i] || 0;
      const distance = (((mark << 8) | next) >> 3) & 0x7ff;
      const length = (mark & 7) + 3;
      const from = out.length - distance;
      for (let n = 0; n < length; n++) out.push(out[Math.max(0, from + n)] || 32);
    } else {
      out.push(32, mark ^ 0x80);
    }
  }
  return new Uint8Array(out);
}

function huffUnpack(dictionaries: Uint8Array[], section: Uint8Array) {
  const huff = dictionaries[0];
  if (latin1(huff, 0, 8) !== "HUFF\0\0\0\x18") throw new Error("This Kindle file uses a compression this desk cannot unpack.");
  const off1 = u32be(huff, 8);
  const off2 = u32be(huff, 12);
  const dict1: [number, number, bigint][] = [];
  for (let i = 0; i < 256; i++) {
    const value = u32be(huff, off1 + i * 4);
    const codelen = value & 0x1f;
    const term = value & 0x80;
    const maxcode = ((BigInt(value >>> 8) + 1n) << BigInt(32 - codelen)) - 1n;
    dict1.push([codelen, term, maxcode]);
  }
  const mincode = [0n];
  const maxcode = [0n];
  for (let i = 0; i < 32; i++) {
    const min = u32be(huff, off2 + i * 8);
    const max = u32be(huff, off2 + i * 8 + 4);
    const shift = BigInt(32 - (i + 1));
    mincode.push(BigInt(min) << shift);
    maxcode.push(((BigInt(max) + 1n) << shift) - 1n);
  }
  const dictionary: [Uint8Array, number][] = [];
  for (const cdic of dictionaries.slice(1)) {
    if (latin1(cdic, 0, 8) !== "CDIC\0\0\0\x10") continue;
    const phrases = u32be(cdic, 8);
    const bits = u32be(cdic, 12);
    const n = Math.min(1 << bits, phrases - dictionary.length);
    for (let i = 0; i < n; i++) {
      const at = u16be(cdic, 16 + i * 2);
      const blen = u16be(cdic, 16 + at);
      const slice = cdic.subarray(18 + at, 18 + at + (blen & 0x7fff));
      dictionary.push([slice, blen & 0x8000]);
    }
  }
  const cache = dictionary.map((entry) => entry);
  const read = (data: Uint8Array): Uint8Array => {
    const padded = new Uint8Array(data.length + 8);
    padded.set(data);
    const word = (at: number) => {
      let value = 0n;
      for (let b = 0; b < 8; b++) value = (value << 8n) | BigInt(padded[at + b] || 0);
      return value;
    };
    let pos = 0;
    let x = word(0);
    let n = 32;
    const parts: Uint8Array[] = [];
    let bitsleft = data.length * 8;
    const mask = 0xffffffffn;
    while (bitsleft > 0) {
      if (n <= 0) {
        pos += 4;
        x = word(pos);
        n += 32;
      }
      const code = (x >> BigInt(n)) & mask;
      let codelen = dict1[Number(code >> 24n)][0];
      const term = dict1[Number(code >> 24n)][1];
      let limit = dict1[Number(code >> 24n)][2];
      if (!term) {
        while (codelen < mincode.length && code < mincode[codelen]) codelen++;
        limit = maxcode[codelen] || 0n;
      }
      n -= codelen;
      bitsleft -= codelen;
      if (bitsleft < 0) break;
      const index = Number((limit - code) >> BigInt(32 - codelen));
      const entry = cache[index];
      if (!entry) break;
      let slice = entry[0];
      if (!entry[1]) {
        slice = read(slice);
        cache[index] = [slice, 1];
      }
      parts.push(slice);
    }
    const size = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(size);
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  };
  return read(section);
}

export function piecesFromPalm(data: Uint8Array): { pieces: Piece[]; title: string; author: string; warning?: string } {
  const offsets = recordsOf(data);
  if (!offsets) throw new Error("That Palm file could not be read.");
  const rec = (n: number) => data.subarray(offsets[n], offsets[n + 1]);
  const head = rec(0);
  const compression = u16(head, 0);
  const textLength = u32(head, 4);
  const textRecords = u16(head, 8);
  const encryption = u16(head, 12);
  if (encryption) throw new Error(LOCKED);
  const mobi = latin1(head, 16, 4) === "MOBI";
  let encoding = "win1252";
  let title = latin1(data, 0, 32).replace(/\0.*$/, "").trim();
  let author = "";
  let huffIndex = 0;
  let huffCount = 0;
  if (mobi) {
    const code = u32(head, 16 + 0x0c);
    if (code === 65001) encoding = "utf-8";
    const nameAt = u32(head, 16 + 0x54);
    const nameLen = u32(head, 16 + 0x58);
    if (nameLen > 0 && nameAt + nameLen <= head.length) {
      const raw = head.subarray(nameAt, nameAt + nameLen);
      const named = encoding === "utf-8" ? new TextDecoder().decode(raw) : decode1252(raw);
      if (named.trim()) title = named.trim();
    }
    huffIndex = u32(head, 16 + 0x70);
    huffCount = u32(head, 16 + 0x74);
    const exth = u32(head, 16 + 0x80);
    if (exth) {
      const at = 16 + u32(head, 20);
      if (latin1(head, at, 4) === "EXTH") {
        const n = u32(head, at + 8);
        let p = at + 12;
        for (let i = 0; i < n && p + 8 <= head.length; i++) {
          const kind = u32(head, p);
          const size = u32(head, p + 4);
          const value = head.subarray(p + 8, p + size);
          if (kind === 100 && !author) author = new TextDecoder().decode(value).replace(/\0/g, "").trim();
          p += size;
        }
      }
    }
  }
  const chunks: Uint8Array[] = [];
  const limit = Math.min(textRecords, offsets.length - 2);
  if (compression === 17480 && huffCount > 1) {
    const dicts: Uint8Array[] = [];
    for (let i = 0; i < huffCount && huffIndex + i < offsets.length - 1; i++) dicts.push(rec(huffIndex + i));
    for (let i = 1; i <= limit; i++) chunks.push(huffUnpack(dicts, rec(i)));
  } else if (compression === 1 || compression === 2) {
    for (let i = 1; i <= limit; i++) chunks.push(compression === 2 ? palmdoc(rec(i)) : rec(i));
  } else if (latin1(data, 0x3c, 4) === "zTXT") {
    throw new Error("This Palm book is zTXT. Open the plain text or the HTML of the same book.");
  } else {
    throw new Error("This Palm or Kindle file uses a compression this desk cannot unpack.");
  }
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const all = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.length;
  }
  const clipped = textLength && textLength < all.length ? all.subarray(0, textLength) : all;
  const text = encoding === "utf-8" ? new TextDecoder().decode(clipped) : decode1252(clipped);
  const markup = /<(p|html|body)\b/i.test(text) ? piecesFromHtml(text) : { pieces: piecesFromText(text), title: "", author: "" };
  return {
    pieces: markup.pieces,
    title: markup.title || title,
    author: markup.author || author,
  };
}
