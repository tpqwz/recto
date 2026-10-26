export type Raster = { width: number; height: number; rgba: Uint8ClampedArray };

function readNum(data: Uint8Array, offset: number, type: number, count: number, little: boolean) {
  const take = (at: number, bytes: number) => {
    if (little) {
      let n = 0;
      for (let i = 0; i < bytes; i++) n += data[at + i] * 2 ** (8 * i);
      return n;
    }
    let n = 0;
    for (let i = 0; i < bytes; i++) n = n * 256 + data[at + i];
    return n;
  };
  const width = type === 3 ? 2 : type === 4 ? 4 : 1;
  const valueAt = count * width <= 4 ? offset : take(offset, 4);
  const values: number[] = [];
  for (let i = 0; i < count; i++) values.push(take(valueAt + i * width, width));
  return values;
}

function lzw(input: Uint8Array, expected: number) {
  const out = new Uint8Array(expected);
  let filled = 0;
  let bit = 0;
  const read = (width: number) => {
    let value = 0;
    for (let i = 0; i < width; i++) {
      const at = bit >> 3;
      if (at >= input.length) return -1;
      value |= ((input[at] >> (bit & 7)) & 1) << i;
      bit++;
    }
    return value;
  };
  let clear = 256;
  let end = 257;
  let codeWidth = 9;
  let next = 258;
  let dict: number[][] = [];
  const reset = () => {
    dict = Array.from({ length: 256 }, (_, i) => [i]);
    codeWidth = 9;
    next = 258;
  };
  reset();
  let prev: number[] | null = null;
  while (filled < expected) {
    const code = read(codeWidth);
    if (code < 0 || code === end) break;
    if (code === clear) {
      reset();
      prev = null;
      continue;
    }
    let entry: number[];
    if (code < next && dict[code]) entry = dict[code];
    else if (prev) entry = prev.concat(prev[0]);
    else break;
    for (const byte of entry) {
      if (filled < expected) out[filled++] = byte;
    }
    if (prev && next < 4096) {
      dict[next++] = prev.concat(entry[0]);
      if (next === 512) codeWidth = 10;
      else if (next === 1024) codeWidth = 11;
      else if (next === 2048) codeWidth = 12;
    }
    prev = entry;
  }
  return out;
}

function packbits(input: Uint8Array, expected: number) {
  const out = new Uint8Array(expected);
  let i = 0;
  let o = 0;
  while (i < input.length && o < expected) {
    const mark = input[i++];
    if (mark <= 127) {
      const n = mark + 1;
      out.set(input.subarray(i, i + n), o);
      i += n;
      o += n;
    } else if (mark !== 128) {
      const n = 257 - mark;
      out.fill(input[i++] || 0, o, o + n);
      o += n;
    }
  }
  return out;
}

async function inflate(input: Uint8Array) {
  const copy = new Uint8Array(input.byteLength);
  copy.set(input);
  const stream = new Blob([copy.buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream("deflate"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return bytes;
}

/** The TIFF kinds a scan usually uses: none, LZW, deflate, packbits, and a JPEG strip. */
export async function decodeTiff(data: Uint8Array): Promise<Raster[]> {
  const little = data[0] === 0x49 && data[1] === 0x49;
  if (!little && !(data[0] === 0x4d && data[1] === 0x4d)) throw new Error("That TIFF could not be read.");
  const num = (offset: number, bytes: number) => {
    if (little) {
      let n = 0;
      for (let i = 0; i < bytes; i++) n += data[offset + i] * 2 ** (8 * i);
      return n;
    }
    let n = 0;
    for (let i = 0; i < bytes; i++) n = n * 256 + data[offset + i];
    return n;
  };
  let ifd = num(4, 4);
  const pages: Raster[] = [];
  let guard = 0;
  while (ifd && guard++ < 200 && ifd + 2 < data.length) {
    const count = num(ifd, 2);
    const tags = new Map<number, number[]>();
    for (let n = 0; n < count; n++) {
      const at = ifd + 2 + n * 12;
      const tag = num(at, 2);
      const type = num(at + 2, 2);
      const nvals = num(at + 4, 4);
      tags.set(tag, readNum(data, at + 8, type, Math.min(nvals, 100000), little));
    }
    const width = tags.get(256)?.[0] || 0;
    const height = tags.get(257)?.[0] || 0;
    const compression = tags.get(259)?.[0] || 1;
    const photo = tags.get(262)?.[0] || 1;
    const samples = tags.get(277)?.[0] || (photo === 2 ? 3 : 1);
    const offsets = tags.get(273) || [];
    const counts = tags.get(279) || [];
    const rowsPer = tags.get(278)?.[0] || height;
    const predictor = tags.get(317)?.[0] || 1;
    if (!width || !height) break;
    if (compression === 7 && offsets.length) {
      pages.push(await jpegStrip(data.subarray(offsets[0], offsets[0] + (counts[0] || data.length - offsets[0]))));
    } else {
      const expected = width * height * samples;
      const strips: Uint8Array[] = [];
      for (let s = 0; s < offsets.length; s++) {
        const raw = data.subarray(offsets[s], offsets[s] + (counts[s] || 0));
        if (compression === 1) strips.push(raw);
        else if (compression === 5) strips.push(lzw(raw, width * Math.min(rowsPer, height - s * rowsPer) * samples));
        else if (compression === 8) strips.push(await inflate(raw));
        else if (compression === 32773) strips.push(packbits(raw, width * Math.min(rowsPer, height - s * rowsPer) * samples));
        else throw new Error("That TIFF uses a compression this desk cannot read. Save the pages as JPEG or PNG.");
      }
      const bytes = new Uint8Array(expected);
      let at = 0;
      for (const strip of strips) {
        bytes.set(strip.subarray(0, expected - at), at);
        at += strip.length;
      }
      if (predictor === 2 && samples >= 1) {
        for (let y = 0; y < height; y++) {
          for (let x = samples; x < width * samples; x++) bytes[y * width * samples + x] = (bytes[y * width * samples + x] + bytes[y * width * samples + x - samples]) & 255;
        }
      }
      const rgba = new Uint8ClampedArray(width * height * 4);
      for (let p = 0; p < width * height; p++) {
        if (samples >= 3) {
          rgba[p * 4] = bytes[p * samples];
          rgba[p * 4 + 1] = bytes[p * samples + 1];
          rgba[p * 4 + 2] = bytes[p * samples + 2];
        } else {
          const gray = photo === 0 ? 255 - bytes[p] : bytes[p];
          rgba[p * 4] = gray;
          rgba[p * 4 + 1] = gray;
          rgba[p * 4 + 2] = gray;
        }
        rgba[p * 4 + 3] = 255;
      }
      pages.push({ width, height, rgba });
    }
    ifd = num(ifd + 2 + count * 12, 4);
  }
  if (!pages.length) throw new Error("That TIFF could not be read.");
  return pages;
}

async function jpegStrip(bytes: Uint8Array): Promise<Raster> {
  if (typeof document === "undefined") throw new Error("Page images are read in the browser.");
  const canvas = await canvasFromBytes(bytes, "image/jpeg");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not draw that page.");
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, rgba: frame.data };
}

export function canvasFromRaster(raster: Raster) {
  const canvas = document.createElement("canvas");
  canvas.width = raster.width;
  canvas.height = raster.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not draw that page.");
  const pixels = new Uint8ClampedArray(raster.rgba);
  ctx.putImageData(new ImageData(pixels, raster.width, raster.height), 0, 0);
  return canvas;
}

export function canvasFromBytes(bytes: Uint8Array, type: string) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer as ArrayBuffer], { type });
  const url = URL.createObjectURL(blob);
  return new Promise<HTMLCanvasElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      const ctx = canvas.getContext("2d");
      URL.revokeObjectURL(url);
      if (!ctx || !canvas.width) {
        reject(new Error("Could not draw that page."));
        return;
      }
      ctx.drawImage(image, 0, 0);
      resolve(canvas);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not draw that page."));
    };
    image.src = url;
  });
}

export function mimeOf(name: string, bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (latin(bytes, "GIF8")) return "image/gif";
  if (latin(bytes, "RIFF") && latinAt(bytes, 8, "WEBP")) return "image/webp";
  if (/\.jpe?g$/i.test(name)) return "image/jpeg";
  if (/\.png$/i.test(name)) return "image/png";
  if (/\.gif$/i.test(name)) return "image/gif";
  if (/\.webp$/i.test(name)) return "image/webp";
  return "application/octet-stream";
}

function latin(bytes: Uint8Array, text: string) {
  return latinAt(bytes, 0, text);
}

function latinAt(bytes: Uint8Array, at: number, text: string) {
  if (at + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i++) if (bytes[at + i] !== text.charCodeAt(i)) return false;
  return true;
}
