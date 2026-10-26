/** A JPEG, base64 without the data-URL prefix, small enough to sit in an EPUB. */
export function jpegFromRgba(width: number, height: number, rgba: Uint8ClampedArray, maxEdge = 1400) {
  if (typeof document === "undefined" || !width || !height) return;
  const source = document.createElement("canvas");
  source.width = width;
  source.height = height;
  const ctx = source.getContext("2d");
  if (!ctx) return;
  const pixels = new Uint8ClampedArray(width * height * 4);
  pixels.set(rgba.subarray(0, pixels.length));
  ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
  const edge = Math.max(width, height);
  const canvas = edge <= maxEdge ? source : document.createElement("canvas");
  if (canvas !== source) {
    const scale = maxEdge / edge;
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext("2d")?.drawImage(source, 0, 0, canvas.width, canvas.height);
    source.width = 0;
    source.height = 0;
  }
  const url = canvas.toDataURL("image/jpeg", 0.82);
  canvas.width = 0;
  canvas.height = 0;
  const comma = url.indexOf(",");
  return comma >= 0 ? url.slice(comma + 1) : undefined;
}
