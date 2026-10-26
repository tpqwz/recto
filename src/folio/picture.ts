import type { Line } from "./assemble.ts";

export type PictureBox = { text: string; poly: number[] | number[][] };

/** Long side stays near 1400 pixels. A full-size scan is slow and no clearer. */
export function pictureScale(pageW: number, pageH: number) {
  const long = Math.max(pageW, pageH, 1);
  return Math.min(2, 1400 / long);
}

function boxOf(poly: number[] | number[][]) {
  const xs: number[] = [];
  const ys: number[] = [];
  if (poly.length && typeof poly[0] === "number") {
    const flat = poly as number[];
    for (let i = 0; i + 1 < flat.length; i += 2) {
      xs.push(flat[i]);
      ys.push(flat[i + 1]);
    }
  } else {
    for (const point of poly as number[][]) {
      if (point.length >= 2) {
        xs.push(point[0]);
        ys.push(point[1]);
      }
    }
  }
  return { xs, ys };
}

/** Image pixels, origin at the top left, become PDF points, origin at the bottom left. */
export function linesFromBoxes(
  items: PictureBox[],
  page: number,
  pageW: number,
  pageH: number,
  imageW: number,
  imageH: number,
): Line[] {
  if (imageW <= 0 || imageH <= 0) return [];
  const sx = pageW / imageW;
  const sy = pageH / imageH;
  const lines: Line[] = [];
  for (const item of items) {
    const text = String(item.text || "")
      .replace(/<\/?s>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    const { xs, ys } = boxOf(item.poly || []);
    if (xs.length < 2) continue;
    const pdfX = xs.map((x) => x * sx);
    const pdfY = ys.map((y) => pageH - y * sy);
    const x0 = Math.min(...pdfX);
    const x1 = Math.max(...pdfX);
    const y0 = Math.min(...pdfY);
    const y1 = Math.max(...pdfY);
    lines.push({ text, x0, x1, y: y0, h: Math.max(8, y1 - y0), page, pageH, pageW });
  }
  return lines;
}

function takeRegions(node: unknown, into: PictureBox[]) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const entry of node) takeRegions(entry, into);
    return;
  }
  const record = node as Record<string, unknown>;
  const quads = record.quad_boxes ?? record.quadBoxes ?? record.bboxes;
  const labels = record.labels;
  if (Array.isArray(quads) && Array.isArray(labels) && quads.length === labels.length) {
    for (let i = 0; i < quads.length; i++) {
      const poly = quads[i];
      if (Array.isArray(poly)) into.push({ text: String(labels[i] ?? ""), poly: poly as number[] | number[][] });
    }
    return;
  }
  for (const value of Object.values(record)) takeRegions(value, into);
}

export function linesFromRegion(
  result: unknown,
  page: number,
  pageW: number,
  pageH: number,
  imageW: number,
  imageH: number,
): Line[] {
  const items: PictureBox[] = [];
  takeRegions(result, items);
  return linesFromBoxes(items, page, pageW, pageH, imageW, imageH);
}
