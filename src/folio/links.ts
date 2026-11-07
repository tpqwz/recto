/** A link rectangle in PDF user space, already limited to a safe address. */
export type LinkBox = { x0: number; y0: number; x1: number; y1: number; href: string };

export type Glyph = {
  str: string;
  transform: number[];
  width?: number;
  height?: number;
  dir?: string;
  href?: string;
};

/** The address a reader may open. A Google redirect is unwrapped. Anything else is dropped. */
export function safeHref(raw: string): string {
  const text = raw.replace(/\s+/g, "").trim();
  if (!text) return "";
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return "";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "mailto:") return "";
  const host = url.hostname.replace(/^www\./, "");
  if (host === "google.com" && url.pathname === "/url") {
    const next = url.searchParams.get("q") || url.searchParams.get("url") || "";
    if (next && next !== text) return safeHref(next);
  }
  return url.toString();
}

function hrefAt(x: number, baseline: number, h: number, boxes: LinkBox[]) {
  const glyphTop = baseline + h * 0.8;
  const glyphBottom = baseline - h * 0.15;
  const glyphH = Math.max(1, glyphTop - glyphBottom);
  let best: LinkBox | undefined;
  let area = Infinity;
  for (const box of boxes) {
    if (x < box.x0 || x > box.x1) continue;
    const overlap = Math.min(glyphTop, box.y1) - Math.max(glyphBottom, box.y0);
    if (overlap < glyphH * 0.45) continue;
    const size = Math.max(1, box.x1 - box.x0) * Math.max(1, box.y1 - box.y0);
    if (size < area) {
      area = size;
      best = box;
    }
  }
  return best?.href;
}

/** A word that is mostly inside a link is linked as a whole, so a proportional guess does not cut it. */
function snapWords(chars: string[], hrefs: (string | undefined)[]) {
  const out = hrefs.slice();
  let i = 0;
  while (i < chars.length) {
    if (/\s/.test(chars[i] || "")) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < chars.length && !/\s/.test(chars[j] || "")) j += 1;
    const votes = new Map<string, number>();
    for (let k = i; k < j; k++) {
      const href = hrefs[k];
      if (href) votes.set(href, (votes.get(href) || 0) + 1);
    }
    let best = "";
    let count = 0;
    for (const [href, n] of votes) {
      if (n > count) {
        best = href;
        count = n;
      }
    }
    if (best && count * 2 >= j - i) {
      for (let k = i; k < j; k++) out[k] = best;
    }
    i = j;
  }
  return out;
}

/**
 * Split each text run where a link rectangle covers only part of it.
 * A right-to-left run is left whole: cutting it by x would reverse the pieces.
 */
export function paintLinks(items: Glyph[], boxes: LinkBox[]): Glyph[] {
  if (!boxes.length) return items;
  const out: Glyph[] = [];
  for (const item of items) {
    const text = String(item.str || "");
    const chars = [...text];
    const width = item.width || 0;
    const x = item.transform?.[4] || 0;
    const y = item.transform?.[5] || 0;
    const h = item.height || Math.abs(item.transform?.[3] || 0) || 8;
    if (item.dir === "rtl" || chars.length < 1 || width <= 0) {
      out.push(item);
      continue;
    }
    const step = width / chars.length;
    const hrefs = snapWords(
      chars,
      chars.map((_, index) => hrefAt(x + step * (index + 0.5), y, h, boxes)),
    );
    let start = 0;
    for (let index = 1; index <= chars.length; index++) {
      if (index < chars.length && hrefs[index] === hrefs[start]) continue;
      const slice = chars.slice(start, index).join("");
      out.push({
        ...item,
        str: slice,
        width: step * (index - start),
        transform: [item.transform[0], item.transform[1], item.transform[2], item.transform[3], x + step * start, y],
        href: hrefs[start],
      });
      start = index;
    }
  }
  return out;
}
