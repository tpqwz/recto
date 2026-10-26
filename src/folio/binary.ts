export function u16(b: Uint8Array, o: number) {
  return b[o] | (b[o + 1] << 8);
}

export function u32(b: Uint8Array, o: number) {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

export function u16be(b: Uint8Array, o: number) {
  return (b[o] << 8) | b[o + 1];
}

export function u32be(b: Uint8Array, o: number) {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

export function latin1(b: Uint8Array, o: number, n: number) {
  let s = "";
  const end = Math.min(b.length, o + n);
  for (let i = o; i < end; i++) s += String.fromCharCode(b[i]);
  return s;
}

const CP1252 = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";

export function decode1252(b: Uint8Array) {
  let s = "";
  for (const byte of b) {
    if (byte < 0x80) s += String.fromCharCode(byte);
    else if (byte < 0xa0) s += CP1252[byte - 0x80];
    else s += String.fromCharCode(byte);
  }
  return s;
}

export function decodeUtf16(b: Uint8Array) {
  return new TextDecoder("utf-16le").decode(b.subarray(0, b.length - (b.length % 2)));
}

export function starts(b: Uint8Array, text: string, at = 0) {
  if (at + text.length > b.length) return false;
  for (let i = 0; i < text.length; i++) if (b[at + i] !== text.charCodeAt(i)) return false;
  return true;
}
