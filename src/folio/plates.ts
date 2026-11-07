import { unzlibSync, zlibSync } from "fflate";

export type PdfImage = { w: number; h: number; url: string };
export type ImageUse = { page: number; x: number; y: number; w: number; h: number; nativeW: number; nativeH: number; pageH: number };
export type Plate = { page: number; x: number; y: number; w: number; h: number; pageH: number; url: string };

const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(bytes: Uint8Array) {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return ~crc >>> 0;
}

function chunk(type: string, data: Uint8Array) {
  const body = new Uint8Array(4 + data.length);
  body.set(data, 4);
  body[0] = type.charCodeAt(0);
  body[1] = type.charCodeAt(1);
  body[2] = type.charCodeAt(2);
  body[3] = type.charCodeAt(3);
  const size = new Uint8Array(4);
  new DataView(size.buffer).setUint32(0, data.length);
  const sum = new Uint8Array(4);
  new DataView(sum.buffer).setUint32(0, crc32(body));
  const out = new Uint8Array(12 + data.length);
  out.set(size, 0);
  out.set(body, 4);
  out.set(sum, 8 + data.length);
  return out;
}

function u32(n: number) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n);
  return out;
}

function bytesOf(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function base64(bytes: Uint8Array) {
  let text = "";
  const stride = 0x8000;
  for (let i = 0; i < bytes.length; i += stride) text += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + stride)));
  return btoa(text);
}

/** A data URL for pixels that were stored compressed, not as a JPEG. */
function pngUrl(w: number, h: number, pixels: Uint8Array, channels: 1 | 3 | 4) {
  const stride = w * channels;
  const raw = new Uint8Array((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(pixels.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1);
  }
  const color = channels === 4 ? 6 : channels === 3 ? 2 : 0;
  const header = bytesOf(u32(w), u32(h), Uint8Array.of(8, color, 0, 0, 0));
  const png = bytesOf(PNG, chunk("IHDR", header), chunk("IDAT", zlibSync(raw)), chunk("IEND", new Uint8Array()));
  return `data:image/png;base64,${base64(png)}`;
}

function latin(bytes: Uint8Array, from: number, to: number) {
  let text = "";
  for (let i = from; i < to; i++) text += String.fromCharCode(bytes[i]);
  return text;
}

/** Pictures stored in the file. A running head that is only a picture is filtered later. */
export function imagesInPdf(bytes: Uint8Array): PdfImage[] {
  const found: PdfImage[] = [];
  const marker = "/Subtype";
  const text = latin(bytes, 0, bytes.length);
  let at = 0;
  while (at < text.length) {
    const hit = text.indexOf(marker, at);
    if (hit < 0) break;
    at = hit + marker.length;
    const kind = text.slice(hit, hit + 40).replace(/\s+/g, "");
    if (!kind.startsWith("/Subtype/Image")) continue;
    const dictStart = text.lastIndexOf("<<", hit);
    const streamAt = text.indexOf("stream", hit);
    const dictEnd = text.indexOf(">>", hit);
    if (dictStart < 0 || streamAt < 0 || dictEnd < 0 || dictEnd > streamAt) continue;
    const dict = text.slice(dictStart, dictEnd);
    const w = Number(/\/Width\s+(\d+)/.exec(dict)?.[1] || 0);
    const h = Number(/\/Height\s+(\d+)/.exec(dict)?.[1] || 0);
    if (!w || !h || w * h > 2_000_000) continue;
    if (/\/Predictor\s+/.test(dict) && !/\/Predictor\s+1\b/.test(dict)) continue;
    let start = streamAt + "stream".length;
    if (bytes[start] === 13) start += 1;
    if (bytes[start] === 10) start += 1;
    const length = Number(/\/Length\s+(\d+)/.exec(dict)?.[1] || 0);
    const endMark = text.indexOf("endstream", start);
    const end = length > 0 ? Math.min(bytes.length, start + length) : endMark;
    if (end <= start) continue;
    const raw = bytes.subarray(start, end);
    const filter = /\/Filter\s*\/([A-Za-z0-9]+)/.exec(dict)?.[1] || "";
    try {
      if (filter === "DCTDecode" && raw[0] === 0xff && raw[1] === 0xd8) {
        found.push({ w, h, url: `data:image/jpeg;base64,${base64(raw)}` });
        continue;
      }
      if (filter !== "FlateDecode") continue;
      const pixels = unzlibSync(raw);
      const channels = pixels.length === w * h * 4 ? 4 : pixels.length === w * h * 3 ? 3 : pixels.length === w * h ? 1 : 0;
      if (channels !== 1 && channels !== 3 && channels !== 4) continue;
      found.push({ w, h, url: pngUrl(w, h, pixels, channels) });
    } catch {
      /* a picture that will not inflate is left out; the text still converts */
    }
  }
  return found;
}

type Ops = { save: number; restore: number; transform: number; paintImageXObject: number; paintImageXObjectRepeat: number };

function multiply(m: number[], n: number[]) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** Where each painted picture sits. The numbers are PDF points, y upward. */
export function imagePlacements(fnArray: number[], argsArray: unknown[], ops: Ops, page: number, pageH: number): ImageUse[] {
  const uses: ImageUse[] = [];
  const stack: number[][] = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const arg = argsArray[i] as number[] | undefined;
    if (fn === ops.save) stack.push(ctm.slice());
    else if (fn === ops.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === ops.transform && arg && arg.length >= 6) ctm = multiply(ctm, arg);
    else if ((fn === ops.paintImageXObject || fn === ops.paintImageXObjectRepeat) && Array.isArray(arg)) {
      const nativeW = Number(arg[1]) || 0;
      const nativeH = Number(arg[2]) || 0;
      const w = Math.abs(ctm[0]);
      const h = Math.abs(ctm[3]);
      if (nativeW < 1 || nativeH < 1 || w < 4 || h < 4) continue;
      uses.push({ page, x: ctm[4], y: ctm[5], w, h, nativeW, nativeH, pageH });
    }
  }
  return uses;
}

/**
 * Pair painted pictures with the bytes stored in the file.
 * A picture repeated in the top or bottom band is the running head, not a figure.
 * A small or low-resolution picture that appears once is kept.
 */
export function contentPlates(uses: ImageUse[], images: PdfImage[], pages: number): Plate[] {
  const queues = new Map<string, PdfImage[]>();
  for (const image of images) {
    const key = `${image.w}x${image.h}`;
    const list = queues.get(key);
    if (list) list.push(image);
    else queues.set(key, [image]);
  }
  const plates: Plate[] = [];
  for (const use of uses) {
    const list = queues.get(`${use.nativeW}x${use.nativeH}`);
    if (!list?.length) continue;
    const image = list.length === 1 ? list[0] : list.shift()!;
    if (image.url.length > 1_500_000) continue;
    plates.push({ page: use.page, x: use.x, y: use.y, w: use.w, h: use.h, pageH: use.pageH, url: image.url });
  }
  const drop = new Set<Plate>();
  const byBox = new Map<string, Plate[]>();
  for (const plate of plates) {
    const key = `${Math.round(plate.w)}x${Math.round(plate.h)}`;
    const list = byBox.get(key);
    if (list) list.push(plate);
    else byBox.set(key, [plate]);
  }
  const inBand = (plate: Plate) => plate.y > plate.pageH * 0.82 || plate.y + plate.h < plate.pageH * 0.08;
  for (const list of byBox.values()) {
    const band = list.filter(inBand).length;
    if (list.length < 3 || list.length < Math.min(pages, 3) || band < list.length * 0.7) continue;
    for (const plate of list) if (inBand(plate)) drop.add(plate);
  }
  return plates.filter((plate) => !drop.has(plate)).slice(0, 48);
}
