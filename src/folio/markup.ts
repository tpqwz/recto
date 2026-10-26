export type Piece = { level: 0 | 1 | 2; text: string };

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

export function decodeEntities(value: string) {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, token: string) => {
    if (token[0] === "#") {
      const code = token[1] === "x" || token[1] === "X" ? Number.parseInt(token.slice(2), 16) : Number.parseInt(token.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[token.toLowerCase()] ?? all;
  });
}

export function cleanText(value: string) {
  return decodeEntities(value)
    .replace(/\u00ad/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

type Tag = { name: string; attrs: Record<string, string>; close: boolean; self: boolean };

function nextTag(src: string, from: number): { tag: Tag; start: number; end: number } | null {
  const start = src.indexOf("<", from);
  if (start < 0) return null;
  const end = src.indexOf(">", start + 1);
  if (end < 0) return null;
  let raw = src.slice(start + 1, end).trim();
  if (raw.startsWith("!") || raw.startsWith("?")) return { tag: { name: "", attrs: {}, close: true, self: true }, start, end: end + 1 };
  const close = raw.startsWith("/");
  if (close) raw = raw.slice(1);
  const self = raw.endsWith("/");
  if (self) raw = raw.slice(0, -1);
  const name = (raw.match(/^[^\s/>]+/)?.[0] || "").toLowerCase();
  const attrs: Record<string, string> = {};
  for (const found of raw.matchAll(/([^\s=]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    if (found.index === 0) continue;
    attrs[found[1].toLowerCase()] = found[2] ?? found[3] ?? found[4] ?? "";
  }
  return { tag: { name, attrs, close, self }, start, end: end + 1 };
}

/** Walk tags. A heading keeps the text inside it, including nested paragraphs. */
export function piecesFromMarkup(
  src: string,
  options: {
    block: Set<string>;
    heading: (tag: string, attrs: Record<string, string>) => 0 | 1 | 2 | null;
    skip?: Set<string>;
  },
): { pieces: Piece[]; title: string; author: string } {
  const skip = options.skip ?? new Set<string>();
  const pieces: Piece[] = [];
  let skipping = 0;
  let mode: 0 | 1 | 2 | null = null;
  let buf = "";
  const flush = () => {
    const text = cleanText(buf);
    buf = "";
    if (!text || mode == null) return;
    pieces.push({ level: mode, text });
  };
  let i = 0;
  const cleaned = src.replace(/<!--[\s\S]*?-->/g, "");
  while (i < cleaned.length) {
    const found = nextTag(cleaned, i);
    if (!found) {
      if (!skipping && mode != null) buf += cleaned.slice(i);
      break;
    }
    if (!skipping && mode != null && found.start > i) buf += cleaned.slice(i, found.start);
    i = found.end;
    const tag = found.tag;
    if (!tag.name) continue;
    if (tag.close) {
      if (skipping && skip.has(tag.name)) skipping = Math.max(0, skipping - 1);
      if (!skipping && mode != null) {
        const level = options.heading(tag.name, tag.attrs);
        if (level != null || (mode === 0 && options.block.has(tag.name))) {
          flush();
          mode = null;
        }
      }
      continue;
    }
    if (skip.has(tag.name)) {
      if (!tag.self) skipping++;
      continue;
    }
    if (skipping) continue;
    const level = options.heading(tag.name, tag.attrs);
    if (level != null) {
      flush();
      mode = tag.self ? null : level;
      continue;
    }
    if (options.block.has(tag.name) && mode !== 1 && mode !== 2) {
      flush();
      mode = tag.self ? null : 0;
    }
    if (tag.name === "br") buf += " ";
  }
  flush();
  return { pieces, title: "", author: "" };
}

const HTML_BLOCK = new Set(["p", "li", "blockquote", "pre", "h1", "h2", "h3", "h4", "figcaption", "caption", "dt", "dd", "tr"]);
const FB2_BLOCK = new Set(["p", "v", "subtitle", "text-author", "title", "empty-line"]);

export function piecesFromHtml(src: string) {
  const title = cleanText(src.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const read = piecesFromMarkup(src, {
    block: HTML_BLOCK,
    heading: (tag) => (tag === "h1" ? 1 : tag === "h2" || tag === "h3" || tag === "h4" ? 2 : null),
    skip: new Set(["script", "style", "svg", "nav", "noscript", "head"]),
  });
  return { ...read, title: read.pieces.find((piece) => piece.level === 1)?.text || title, author: "" };
}

export function piecesFromFb2(src: string) {
  const title = cleanText(src.match(/<book-title[^>]*>([\s\S]*?)<\/book-title>/i)?.[1] || "");
  const first = cleanText(src.match(/<first-name[^>]*>([\s\S]*?)<\/first-name>/i)?.[1] || "");
  const last = cleanText(src.match(/<last-name[^>]*>([\s\S]*?)<\/last-name>/i)?.[1] || "");
  const read = piecesFromMarkup(src, {
    block: FB2_BLOCK,
    heading: (tag) => (tag === "title" ? 1 : tag === "subtitle" ? 2 : null),
    skip: new Set(["binary", "stylesheet", "description"]),
  });
  return { ...read, title, author: [first, last].filter(Boolean).join(" ") };
}

export function piecesFromLrs(src: string) {
  return piecesFromMarkup(src, {
    block: new Set(["p", "text", "plot", "title", "h1", "h2"]),
    heading: (tag) => (tag === "title" || tag === "h1" ? 1 : tag === "h2" ? 2 : null),
  });
}

function isHeading(line: string) {
  if (line.length < 4 || line.length > 80) return false;
  if (/^(chapter|book|part|lecture|section|canto|volume)\b/i.test(line)) return true;
  const words = line.split(" ");
  return line === line.toUpperCase() && /[A-Z]/.test(line) && words.length >= 2 && words.length <= 8 && !/[.,:;]$/.test(line);
}

export function piecesFromText(src: string): Piece[] {
  const chunks = src
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n\s*\n/)
    .map((part) => part.replace(/[ \t]*\n[ \t]*/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return chunks.map((text) => ({ level: isHeading(text) ? 1 : 0, text }));
}

const RTF_SKIP = new Set(["fonttbl", "colortbl", "stylesheet", "info", "pict", "header", "footer", "footnote", "object", "datafield", "xmlopen", "xmlclose"]);

export function piecesFromRtf(src: string): Piece[] {
  const pieces: Piece[] = [];
  let buf = "";
  let skip = 0;
  const flush = () => {
    const text = buf.replace(/[ \t]+/g, " ").trim();
    buf = "";
    if (text) pieces.push({ level: isHeading(text) ? 1 : 0, text });
  };
  let i = 0;
  const groups: { skip: boolean }[] = [];
  while (i < src.length) {
    const ch = src[i];
    if (ch === "{") {
      const ahead = src.slice(i + 1, i + 40);
      const starred = /^\s*\\[*]/.test(ahead);
      const word = /^\s*\\([a-z]+)/i.exec(ahead);
      const dest = starred || (word ? RTF_SKIP.has(word[1].toLowerCase()) : false);
      groups.push({ skip: dest || skip > 0 });
      if (dest || skip > 0) skip++;
      i++;
      continue;
    }
    if (ch === "}") {
      const group = groups.pop();
      if (group?.skip) skip = Math.max(0, skip - 1);
      i++;
      continue;
    }
    if (ch === "\\" && skip === 0) {
      if (src[i + 1] === "\\") {
        buf += "\\";
        i += 2;
        continue;
      }
      if (src[i + 1] === "{" || src[i + 1] === "}") {
        buf += src[i + 1];
        i += 2;
        continue;
      }
      if (src[i + 1] === "'") {
        const hex = src.slice(i + 2, i + 4);
        const byte = Number.parseInt(hex, 16);
        if (Number.isFinite(byte)) buf += decode1252Char(byte);
        i += 4;
        continue;
      }
      const word = /^\\([a-z]+)(-?\d+)? ?/i.exec(src.slice(i));
      if (!word) {
        i++;
        continue;
      }
      const name = word[1].toLowerCase();
      if (name === "u") {
        const code = Number(word[2] || 0);
        const point = code < 0 ? code + 65536 : code;
        if (point > 0) buf += String.fromCodePoint(point);
        i += word[0].length;
        if (src[i] && src[i] !== "\\" && src[i] !== "{" && src[i] !== "}") i++;
        continue;
      }
      if (name === "par" || name === "line" || name === "page") {
        flush();
        i += word[0].length;
        continue;
      }
      if (name === "bin") {
        const n = Number(word[2] || 0);
        i += word[0].length + Math.max(0, n);
        continue;
      }
      i += word[0].length;
      continue;
    }
    if (ch === "\\" && skip > 0) {
      const word = /^\\([a-z]+)(-?\d+)? ?/i.exec(src.slice(i));
      i += word ? word[0].length : 2;
      continue;
    }
    if (skip === 0 && ch !== "\n" && ch !== "\r") buf += ch;
    i++;
  }
  flush();
  return pieces;
}

function decode1252Char(byte: number) {
  if (byte < 0x80) return String.fromCharCode(byte);
  if (byte < 0xa0) return "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ"[byte - 0x80];
  return String.fromCharCode(byte);
}
