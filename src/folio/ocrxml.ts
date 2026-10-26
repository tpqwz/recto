import type { Line } from "./assemble.ts";

function nums(source: string, names: string[]) {
  const out: number[] = [];
  for (const name of names) {
    const found = new RegExp(`${name}\\s*[:=]\\s*"?(-?[\\d.]+)`).exec(source);
    out.push(found ? Number(found[1]) : NaN);
  }
  return out;
}

function bbox(title: string) {
  const found = /bbox\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/.exec(title);
  if (!found) return null;
  return found.slice(1, 5).map(Number);
}

/** hOCR and ALTO already know where each word sat on the page. */
export function linesFromOcrXml(xml: string): Line[] {
  if (/<alto[\s>]|TextLine\b/i.test(xml) && /HPOS=/.test(xml)) return linesFromAlto(xml);
  return linesFromHocr(xml);
}

function linesFromHocr(xml: string): Line[] {
  const lines: Line[] = [];
  const pages = xml.split(/<div\b[^>]*class="[^"]*ocr_page[^"]*"[^>]*>/i).slice(1);
  pages.forEach((page, index) => {
    const head = page.slice(0, 400);
    const box = bbox(head) || [0, 0, 1000, 1400];
    const pageW = Math.max(1, box[2] - box[0]);
    const pageH = Math.max(1, box[3] - box[1]);
    const pageNo = index + 1;
    const chunks = page.split(/<span\b[^>]*class="[^"]*ocr_line[^"]*"[^>]*>/i).slice(1);
    for (const chunk of chunks) {
      const lineBox = bbox(chunk.slice(0, 300));
      const words = [...chunk.matchAll(/<span\b[^>]*class="[^"]*ocrx_word[^"]*"[^>]*>([\s\S]*?)<\/span>/gi)].map((found) =>
        found[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
      );
      const text = (words.length ? words.join(" ") : chunk.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
      if (!text || !lineBox) continue;
      const yTop = lineBox[1];
      const yBot = lineBox[3];
      lines.push({
        text,
        x0: lineBox[0],
        x1: lineBox[2],
        y: pageH - yBot,
        h: Math.max(8, yBot - yTop),
        page: pageNo,
        pageH,
        pageW,
      });
    }
  });
  return lines;
}

function linesFromAlto(xml: string): Line[] {
  const lines: Line[] = [];
  const pages = xml.split(/<Page\b/i).slice(1);
  pages.forEach((page, index) => {
    const head = page.slice(0, 500);
    const [width, height] = nums(head, ["WIDTH", "HEIGHT"]);
    const pageW = Number.isFinite(width) && width > 0 ? width : 1000;
    const pageH = Number.isFinite(height) && height > 0 ? height : 1400;
    const chunks = page.split(/<TextLine\b/i).slice(1);
    for (const chunk of chunks) {
      const strings = [...chunk.matchAll(/<String\b([^>]*)\/?>/gi)];
      if (!strings.length) continue;
      const parts: { x: number; text: string }[] = [];
      let x0 = Infinity;
      let x1 = 0;
      let y0 = Infinity;
      let y1 = 0;
      for (const found of strings) {
        const [hpos, vpos, w, h] = nums(found[1], ["HPOS", "VPOS", "WIDTH", "HEIGHT"]);
        const content = /CONTENT="([^"]*)"/.exec(found[1])?.[1] || "";
        if (!content) continue;
        parts.push({ x: hpos || 0, text: content });
        x0 = Math.min(x0, hpos || 0);
        x1 = Math.max(x1, (hpos || 0) + (w || 0));
        y0 = Math.min(y0, vpos || 0);
        y1 = Math.max(y1, (vpos || 0) + (h || 0));
      }
      parts.sort((a, b) => a.x - b.x);
      const text = parts
        .map((part) => part.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (!text) continue;
      lines.push({
        text,
        x0,
        x1,
        y: pageH - y1,
        h: Math.max(8, y1 - y0),
        page: index + 1,
        pageH,
        pageW,
      });
    }
  });
  return lines;
}
