import { strToU8, zipSync } from "fflate";
import { detectPrinted, type PrintedPages } from "./pages.ts";
import { mergeHyphen, repairText, type WordList } from "./repair.ts";

export type PageRun = { p: string };
export type Run = string | number | PageRun;
export type Block = {
  t: string;
  id?: string;
  s?: string;
  page?: number | string | null;
  /** File page in the retained original, when this block was read from one. */
  src?: number;
  kind?: string;
  runs?: Run[];
  n?: number;
  headers?: string[];
  rows?: string[][];
  section?: boolean;
};
export type TocNode = { id: string; label: string; page: number | string | null; children: TocNode[] };
export type Folio = {
  title: string;
  subtitle: string;
  author: string;
  stats: { hyphensRejoined: number; headersRemoved: number; chapters: number };
  toc: TocNode[];
  chapters: { id: string; title: string; page: number | string | null; blocks: Block[] }[];
  epubHref?: string;
  epubName?: string;
  warning?: string;
  rights?: string;
  origin?: { name: string; kind: "pdf" | "djvu" | "image" | "pages" | "text" };
  /** JPEG cover from the original file, base64 without a data-URL prefix. */
  cover?: string;
};
export type OutlineItem = { label: string; page: number | null; children: OutlineItem[] };
export type Line = { text: string; y: number; x0: number; x1: number; h: number; page: number; pageH: number; pageW: number };

export function runPage(run: Run): number | string | null {
  if (typeof run === "number") return run;
  if (typeof run === "object" && run && "p" in run) return run.p;
  return null;
}

function esc(s: string) {
  return s
    .replace(/&/g, "&" + "amp;")
    .replace(/</g, "&" + "lt;")
    .replace(/>/g, "&" + "gt;")
    .replace(/"/g, "&" + "quot;");
}

export function cluster(items: { str: string; transform: number[]; width?: number; height?: number }[]): { text: string; y: number; x0: number; x1: number; h: number }[] {
  const its = items
    .filter((it) => it.str && String(it.str).trim())
    .map((it) => ({
      str: String(it.str).replace(/\u00ad/g, ""),
      x: it.transform[4],
      y: it.transform[5],
      w: it.width || 0,
      h: it.height || Math.abs(it.transform[3]) || 8,
    }));
  its.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; items: typeof its }[] = [];
  for (const it of its) {
    let placed = false;
    for (let i = lines.length - 1; i >= 0 && lines.length - i <= 6; i--) {
      const ln = lines[i];
      if (Math.abs(ln.y - it.y) > 3.2) continue;
      if (ln.items.some((o) => Math.min(o.x + o.w, it.x + it.w) - Math.max(o.x, it.x) > 2)) continue;
      ln.items.push(it);
      ln.y = ln.items.reduce((s, x) => s + x.y, 0) / ln.items.length;
      placed = true;
      break;
    }
    if (!placed) lines.push({ y: it.y, items: [it] });
  }
  return lines
    .map((ln) => {
      ln.items.sort((a, b) => a.x - b.x);
      let text = "";
      let prev: (typeof its)[number] | null = null;
      for (const it of ln.items) {
        if (prev) {
          const gap = it.x - (prev.x + prev.w);
          if (gap > Math.max(1.15, Math.max(prev.h, it.h, 8) * 0.12)) text += " ";
        }
        text += it.str;
        prev = it;
      }
      const last = ln.items[ln.items.length - 1];
      return {
        text: text.replace(/[ \t]+/g, " ").trim(),
        y: ln.y,
        x0: ln.items[0].x,
        x1: last.x + last.w,
        h: Math.max(...ln.items.map((i) => i.h || 0)),
      };
    })
    .filter((ln) => ln.text.replace(/[^A-Za-z0-9]/g, "").length > 0)
    .sort((a, b) => b.y - a.y || a.x0 - b.x0);
}

function median(nums: number[]) {
  if (!nums.length) return 12;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function joinParagraph(group: Line[], hyphens: { n: number }, printed: PrintedPages, lexicon: WordList | null) {
  const runs: Run[] = [];
  let buf = "";
  let page = group[0].page;
  const flush = () => {
    const t = lexicon ? repairText(buf, lexicon) : buf.replace(/[ \t]+/g, " ").trim();
    if (t) runs.push(t);
    buf = "";
  };
  const mark = (file: number) => {
    const label = printed.label(file);
    if (label == null) return;
    const prev = runs.length ? runPage(runs[runs.length - 1]) : null;
    if (prev != null && String(prev) === String(label)) return;
    runs.push(typeof label === "number" ? label : { p: label });
  };
  for (const ln of group) {
    const piece = ln.text.trim();
    if (lexicon && /[A-Za-z]-$/.test(buf.trim()) && /^[a-z]/.test(piece)) {
      const merged = mergeHyphen(buf.trim(), piece, lexicon, hyphens);
      if (merged) {
        if (ln.page !== page && printed.label(ln.page) != null) {
          buf = merged.head.trim();
          flush();
          page = ln.page;
          mark(page);
          buf = (merged.rest || "").trim();
        } else {
          buf = `${merged.head}${merged.rest || ""}`.replace(/ +/g, " ").trim();
          page = ln.page;
        }
        continue;
      }
    }
    if (ln.page !== page) {
      if (printed.label(ln.page) == null) {
        buf = buf ? `${buf} ${piece}` : piece;
        page = ln.page;
        continue;
      }
      flush();
      page = ln.page;
      mark(page);
      buf = piece;
      continue;
    }
    if (!lexicon && /[A-Za-z]-$/.test(buf) && /^[a-z(]/.test(piece)) {
      buf = buf.replace(/-$/, "") + piece;
      hyphens.n++;
    } else buf = buf ? `${buf} ${piece}` : piece;
  }
  flush();
  return runs;
}

function normalizeOutline(items: OutlineItem[]) {
  const kept = items.filter((item) => item.label.trim() && (item.page || item.children.some((child) => child.page)));
  if (kept.length === 1 && kept[0].children.filter((child) => child.page).length >= 2) {
    return kept[0].children.filter((child) => child.page);
  }
  return kept.filter((item) => item.page);
}

const CONTENTS_HEAD = /^(?:the\s+)?(?:table\s+of\s+)?contents\.?$/i;
const CONTENTS_ENTRY = /^(.{2,90}?)(?:\s*[.\u00b7\u2026_]{2,}\s*|\s{2,})([0-9]{1,4}|[ivxlcdm]{1,8})\s*$/i;

function fileForLabel(printed: PrintedPages, token: string, maxPage: number) {
  const want = /^\d+$/.test(token) ? String(Number(token)) : token.toLowerCase();
  for (let file = 1; file <= maxPage; file++) {
    const label = printed.label(file);
    if (label != null && String(label).toLowerCase() === want) return file;
  }
  return null;
}

/** A printed contents page, when the file itself has no outline. */
export function outlineFromContents(lines: Line[], printed: PrintedPages): OutlineItem[] {
  const ordered = [...lines].sort((a, b) => a.page - b.page || b.y - a.y);
  const head = ordered.find((ln) => ln.page <= 30 && CONTENTS_HEAD.test(ln.text.trim()));
  if (!head) return [];
  const maxPage = ordered.reduce((n, ln) => Math.max(n, ln.page), 1);
  const items: OutlineItem[] = [];
  let misses = 0;
  for (const ln of ordered) {
    if (ln.page < head.page || ln.page > head.page + 6) continue;
    if (ln.page === head.page && ln.y >= head.y) continue;
    const text = ln.text.trim();
    if (!text || CONTENTS_HEAD.test(text)) continue;
    const found = CONTENTS_ENTRY.exec(text);
    const title = found?.[1].replace(/[.\s]+$/g, "").trim();
    const token = found?.[2];
    const page = title && token && /[A-Za-z]/.test(title) ? fileForLabel(printed, token, maxPage) : null;
    if (!page || page <= head.page) {
      if (items.length) misses++;
      if (items.length >= 3 && misses >= 3) break;
      continue;
    }
    misses = 0;
    const prev = items[items.length - 1];
    if (prev && page < (prev.page || 0)) continue;
    if (items.some((item) => item.label === title)) continue;
    items.push({ label: title!.slice(0, 180), page, children: [] });
    if (items.length >= 80) break;
  }
  const pages = new Set(items.map((item) => item.page));
  return items.length >= 3 && pages.size >= 2 ? items : [];
}

/** Lines of a printed contents list, so they are not left in the reading text. */
function printedContentsLines(lines: Line[]) {
  const ordered = [...lines].sort((a, b) => a.page - b.page || b.y - a.y);
  const head = ordered.find((ln) => ln.page <= 30 && CONTENTS_HEAD.test(ln.text.trim()));
  if (!head) return new Set<Line>();
  const drop = new Set<Line>([head]);
  let kept = 0;
  let misses = 0;
  for (const ln of ordered) {
    if (ln.page < head.page || ln.page > head.page + 6) continue;
    if (ln === head || (ln.page === head.page && ln.y >= head.y)) continue;
    const text = ln.text.trim();
    if (!text) continue;
    if (CONTENTS_HEAD.test(text) || CONTENTS_ENTRY.test(text)) {
      drop.add(ln);
      kept++;
      misses = 0;
      continue;
    }
    if (kept) misses++;
    if (kept >= 3 && misses >= 3) break;
  }
  return kept >= 3 ? drop : new Set<Line>();
}

function blockText(block: Block) {
  if ((block.t === "h1" || block.t === "h2") && block.s) return block.s;
  return (block.runs || [])
    .filter((run): run is string => typeof run === "string")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function isPrintedContents(text: string) {
  const line = text.replace(/\s+/g, " ").trim();
  return CONTENTS_HEAD.test(line) || CONTENTS_ENTRY.test(line);
}

/** A linked contents page, as in the sample editions, in place of the printed list. */
function presentContents(chapters: Folio["chapters"]): Folio["chapters"] {
  const cleaned = chapters
    .map((chapter) => ({
      ...chapter,
      blocks: chapter.blocks.filter((block) => block.t === "h1" || block.t === "h2" || !isPrintedContents(blockText(block))),
    }))
    .filter((chapter) => {
      const body = chapter.blocks.some((block) => block.t !== "h1" && block.t !== "h2");
      if (chapter.title === "Front matter" || CONTENTS_HEAD.test(chapter.title)) return body;
      return chapter.blocks.length > 0;
    });
  if (cleaned.length < 2 || cleaned.some((chapter) => chapter.id === "contents")) return cleaned;
  let n = 0;
  const entries: Block[] = [{ t: "h1", id: "contents", s: "Contents" }];
  for (const chapter of cleaned) {
    const front = chapter.title === "Front matter";
    if (!front) n += 1;
    entries.push({ t: "toc-entry", id: chapter.id, n: front ? undefined : n, s: chapter.title, page: chapter.page });
    for (const block of chapter.blocks) {
      if (block.t !== "h2" || !block.id || !block.s || block.s === chapter.title) continue;
      entries.push({ t: "toc-entry", id: block.id, s: block.s, page: block.page, kind: "section" });
    }
  }
  return [{ id: "contents", title: "Contents", page: null, blocks: entries }, ...cleaned];
}

function slug(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "section"
  );
}

function chapterHtml(blocks: Block[], hrefFor?: (id: string) => string) {
  const parts: string[] = [];
  const seen = new Set<string>();
  const pages: string[] = [];
  const mark = (page?: number | string | null) => {
    if (page == null || page === "") return;
    const label = String(page);
    if (seen.has(label)) return;
    seen.add(label);
    pages.push(label);
    parts.push(
      `<span epub:type="pagebreak" id="page-${esc(label)}" role="doc-pagebreak" aria-label="${esc(label)}" title="${esc(label)}"></span>`,
    );
  };
  for (const b of blocks) {
    if (b.t === "h1" || b.t === "h2") {
      mark(b.page);
      parts.push(`<${b.t} id="${esc(b.id || "")}">${esc(b.s || "")}</${b.t}>`);
    } else if (b.t === "toc-entry") {
      const id = b.id || (b.n ? `c${String(b.n).padStart(2, "0")}` : "");
      const href = hrefFor ? hrefFor(id) : `#${id}`;
      const label = b.n ? `${b.n}. ${b.s || ""}` : b.s || "";
      const page = b.page != null && b.page !== "" ? ` <span>${esc(String(b.page))}</span>` : "";
      parts.push(`<p class="tocline${b.kind === "section" ? " section" : ""}"><a href="${esc(href)}">${esc(label)}</a>${page}</p>`);
    } else if (b.t === "p") {
      mark(b.page);
      const inner = (b.runs || [])
        .map((run) => {
          const label = runPage(run);
          if (label == null) return esc(String(run));
          const key = String(label);
          if (seen.has(key)) return "";
          seen.add(key);
          pages.push(key);
          return `<span epub:type="pagebreak" id="page-${esc(key)}" role="doc-pagebreak" aria-label="${esc(key)}" title="${esc(key)}"></span>`;
        })
        .join("");
      parts.push(`<p>${inner}</p>`);
    }
  }
  return { html: parts.join("\n"), pages };
}

function epubBlob(folio: Folio, sourceName: string) {
  const zipped = epubArchive(folio, sourceName);
  const blob = new Blob([zipped], { type: "application/epub+zip" });
  if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") return URL.createObjectURL(blob);
  return "";
}

function decode64(data: string) {
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The EPUB bytes, including a cover image when the file had one. */
export function epubArchive(folio: Folio, sourceName: string) {
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
  };
  const put = (name: string, text: string) => {
    files[name] = strToU8(text);
  };
  const cover = folio.cover ? decode64(folio.cover) : null;
  if (cover) files["OEBPS/cover.jpg"] = cover;
  put(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );
  put(
    "OEBPS/style.css",
    `body{font-family:Georgia,Palatino,serif;line-height:1.5;margin:0;padding:0 6%;color:#1c1915}h1,h2{font-weight:normal}h1{text-align:center}p{margin:0 0 .2em;text-indent:1.15em}p.noindent{text-indent:0}p.tocline{text-indent:0;margin:0.35em 0}p.tocline a{color:inherit;text-decoration:none}p.section{padding-left:1.2em}img.cover{display:block;width:100%;height:auto}`,
  );
  const manifest: string[] = [];
  const spine: string[] = [];
  if (cover) {
    put(
      "OEBPS/cover.xhtml",
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en"><head><meta charset="utf-8"/><title>${esc(folio.title)}</title><link rel="stylesheet" href="style.css"/></head><body style="margin:0;padding:0"><img class="cover" src="cover.jpg" alt="${esc(folio.title)}"/></body></html>`,
    );
    manifest.push(`<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`);
    manifest.push(`<item id="cover-image" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>`);
    spine.push(`<itemref idref="cover"/>`);
  }
  const pageLinks: { label: string; href: string; front: boolean }[] = [];
  const usedPages = new Set<string>();
  const hrefFor = (id: string) => {
    const owner = folio.chapters.find(
      (ch) => ch.id === id || ch.blocks.some((block) => (block.t === "h1" || block.t === "h2") && block.id === id),
    );
    return owner ? `${owner.id}.xhtml#${id}` : `#${id}`;
  };
  folio.chapters.forEach((ch) => {
    const built = chapterHtml(ch.blocks, hrefFor);
    put(
      `OEBPS/text/${ch.id}.xhtml`,
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en"><head><meta charset="utf-8"/><title>${esc(ch.title)}</title><link rel="stylesheet" href="../style.css"/></head><body><section>
${built.html}
</section></body></html>`,
    );
    manifest.push(`<item id="${ch.id}" href="text/${ch.id}.xhtml" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="${ch.id}"/>`);
    for (const label of built.pages) {
      if (usedPages.has(label)) continue;
      usedPages.add(label);
      pageLinks.push({ label, href: `text/${ch.id}.xhtml#page-${label}`, front: !/^\d+$/.test(label) });
    }
  });
  const toc = folio.toc
    .map((t) => {
      const kids = t.children
        .map((c) => `<li><a href="text/${t.id}.xhtml#${esc(c.id)}">${esc(c.label)}</a></li>`)
        .join("");
      return `<li><a href="text/${t.id}.xhtml">${esc(t.label)}</a>${kids ? `<ol>${kids}</ol>` : ""}</li>`;
    })
    .join("");
  const pageList = pageLinks.map((p) => `<li><a href="${esc(p.href)}">${esc(p.label)}</a></li>`).join("");
  put(
    "OEBPS/nav.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en"><head><title>Contents</title></head><body>
<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${toc}</ol></nav>
<nav epub:type="page-list" hidden="hidden"><ol>${pageList}</ol></nav>
</body></html>`,
  );
  let order = 1;
  const navPoints = folio.toc
    .map((t) => {
      const self = order++;
      const kids = t.children
        .map((c) => {
          const o = order++;
          return `<navPoint id="nav-${esc(c.id)}" playOrder="${o}"><navLabel><text>${esc(c.label)}</text></navLabel><content src="text/${t.id}.xhtml#${esc(c.id)}"/></navPoint>`;
        })
        .join("");
      return `<navPoint id="nav-${esc(t.id)}" playOrder="${self}"><navLabel><text>${esc(t.label)}</text></navLabel><content src="text/${t.id}.xhtml"/>${kids}</navPoint>`;
    })
    .join("");
  const arabicPages = pageLinks.map((p) => Number(p.label)).filter((n) => Number.isInteger(n) && n > 0);
  const maxPage = arabicPages.length ? Math.max(...arabicPages) : 0;
  const pageTargets = pageLinks
    .map((p) => {
      const o = order++;
      const type = p.front ? "front" : "normal";
      return `<pageTarget id="pt-${esc(p.label)}" type="${type}" value="${esc(p.label)}" playOrder="${o}"><navLabel><text>${esc(p.label)}</text></navLabel><content src="${esc(p.href)}"/></pageTarget>`;
    })
    .join("");
  put(
    "OEBPS/toc.ncx",
    `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="urn:uuid:recto-opened"/>
<meta name="dtb:depth" content="2"/><meta name="dtb:totalPageCount" content="${pageLinks.length}"/><meta name="dtb:maxPageNumber" content="${maxPage}"/></head>
<docTitle><text>${esc(folio.title)}</text></docTitle>
<navMap>${navPoints}</navMap>
<pageList><navLabel><text>Pages</text></navLabel>${pageTargets}</pageList>
</ncx>`,
  );
  put(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="3.0" xml:lang="en" prefix="schema: http://schema.org/">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">urn:uuid:recto-${esc(folio.title).slice(0, 24)}</dc:identifier>
<dc:title>${esc(folio.title)}</dc:title>
${folio.author ? `<dc:creator>${esc(folio.author)}</dc:creator>` : ""}
<dc:language>en</dc:language>
<dc:source>${esc(sourceName)}</dc:source>
<dc:rights>Personal reading copy made in Recto from a file supplied by the reader.</dc:rights>
<meta property="dcterms:modified">2026-10-24T16:00:00Z</meta>
<meta property="pageBreakSource">${esc(sourceName)}</meta>
<meta property="schema:accessibilityFeature">pageBreakMarkers</meta>
<meta property="schema:accessibilityFeature">pageNavigation</meta>
${cover ? `<meta name="cover" content="cover-image"/>` : ""}
</metadata><manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="css" href="style.css" media-type="text/css"/>
${manifest.join("\n")}
</manifest><spine toc="ncx">${spine.join("")}<itemref idref="nav" linear="no"/></spine>${cover ? `<guide><reference type="cover" title="Cover" href="cover.xhtml"/></guide>` : ""}</package>`,
  );
  return zipSync(files, { level: 6 });
}

type Para = { group: Line[]; runs: Run[]; h: number };

function pushChapter(chapters: Folio["chapters"], label: string, page: number | string | null, src?: number) {
  const id = `c${String(chapters.length + 1).padStart(2, "0")}`;
  const chapter = { id, title: label, page, blocks: [{ t: "h1", id, s: label, page, src }] as Block[] };
  chapters.push(chapter);
  return chapter;
}

function tocOf(chapters: Folio["chapters"]): TocNode[] {
  return chapters.map((c) => ({
    id: c.id,
    label: c.title,
    page: c.page,
    children: c.blocks
      .filter((b) => b.t === "h2" && b.id && b.s)
      .map((b) => ({ id: b.id || "", label: b.s || "", page: b.page ?? null, children: [] })),
  }));
}

function withOutline(paras: Para[], outline: OutlineItem[], title: string, printed: PrintedPages) {
  const chapters: Folio["chapters"] = [];
  const first = outline[0].page || 1;
  const front = paras.filter((p) => p.group[0].page < first);
  if (front.length) {
    const ch = pushChapter(chapters, "Front matter", printed.label(front[0].group[0].page), front[0].group[0].page);
    for (const p of front) ch.blocks.push({ t: "p", runs: p.runs, page: printed.label(p.group[0].page), src: p.group[0].page });
  }
  outline.forEach((item, index) => {
    const start = item.page || 1;
    const end = outline[index + 1]?.page ?? Infinity;
    const ch = pushChapter(chapters, item.label, printed.label(start), start);
    const seen = new Set<string>();
    const children = item.children.filter((c) => c.page && c.page >= start && c.page < end && c.page !== start);
    for (const p of paras) {
      const page = p.group[0].page;
      if (page < start || page >= end) continue;
      for (const child of children) {
        if (child.page !== page || seen.has(child.label)) continue;
        seen.add(child.label);
        const id = `${ch.id}-${slug(child.label)}`;
        ch.blocks.push({ t: "h2", id, s: child.label, page: printed.label(page), src: page, section: true });
      }
      ch.blocks.push({ t: "p", runs: p.runs, page: printed.label(page), src: page });
    }
  });
  if (!chapters.length) pushChapter(chapters, title, printed.label(paras[0]?.group[0].page ?? 1), paras[0]?.group[0].page);
  return chapters;
}

function withHeadings(paras: Para[], title: string, bodyH: number, printed: PrintedPages) {
  const headingAt = new Set<number>();
  paras.forEach((p, i) => {
    const text = p.runs.filter((r): r is string => typeof r === "string").join(" ");
    if (p.group.length === 1 && p.h > bodyH * 1.28 && text.length > 2 && text.length < 80 && !/[,:;]$/.test(text)) headingAt.add(i);
  });
  if (headingAt.size > 60) headingAt.clear();
  const chapters: Folio["chapters"] = [];
  let current = headingAt.has(0) ? null : pushChapter(chapters, title, printed.label(paras[0]?.group[0].page ?? 1), paras[0]?.group[0].page);
  paras.forEach((p, i) => {
    const text = p.runs.filter((r): r is string => typeof r === "string").join(" ");
    const filePage = p.group[0].page;
    if (headingAt.has(i)) {
      current = pushChapter(chapters, text, printed.label(filePage), filePage);
      return;
    }
    if (!current) current = pushChapter(chapters, title, printed.label(filePage), filePage);
    current.blocks.push({ t: "p", runs: p.runs, page: printed.label(filePage), src: filePage });
  });
  if (!chapters.length) pushChapter(chapters, title, 1);
  return chapters;
}

export function assembleFolio(
  rawLines: Line[],
  options: {
    title: string;
    subtitle: string;
    author?: string;
    sourceName: string;
    outline?: OutlineItem[];
    emptyMessage: string;
    lexicon?: WordList | null;
    onStatus?: (s: string) => void;
  },
): Folio {
  const printed = detectPrinted(rawLines);
  const lexicon = options.lexicon || null;
  const skipContents = printedContentsLines(rawLines);
  let headers = 0;
  const kept: Line[] = [];
  for (const ln of rawLines) {
    if (skipContents.has(ln)) continue;
    const short = ln.text.length < 72;
    const header = ln.y > ln.pageH - 54 && short && (/\d/.test(ln.text) || ln.text.length < 40);
    const footer = ln.y < 36 && short;
    if (header || footer) {
      headers++;
      continue;
    }
    kept.push(ln);
  }
  if (!kept.length) throw new Error(options.emptyMessage);
  const bodyH = median(kept.map((ln) => ln.h));
  const margin = median(kept.filter((ln) => ln.x1 - ln.x0 > 80).map((ln) => Math.round(ln.x0 / 2) * 2));
  const groups: Line[][] = [];
  let buf: Line[] = [];
  const flush = () => {
    if (buf.length) groups.push(buf);
    buf = [];
  };
  for (const ln of kept) {
    const prev = buf[buf.length - 1];
    const pageBreak = !!prev && prev.page !== ln.page;
    const gap = prev && !pageBreak ? prev.y - ln.y : 0;
    const prevEnded = !!prev && /[.?!]["']?$/.test(prev.text.trim()) && prev.x1 < prev.pageW * 0.78;
    const indented = ln.x0 > margin + 14;
    if (prev && !/[A-Za-z]-$/.test(prev.text) && (gap > Math.max(bodyH * 0.9, 14) || (indented && prevEnded) || (pageBreak && prevEnded))) flush();
    buf.push(ln);
  }
  flush();
  const hyphens = { n: 0 };
  const paras = groups
    .map((group) => ({ group, runs: joinParagraph(group, hyphens, printed, lexicon), h: group[0].h }))
    .filter((p) => p.runs.some((r) => typeof r === "string" && r.replace(/[^A-Za-z]/g, "").length > 1));
  if (!paras.length) throw new Error(options.emptyMessage);
  const tops = normalizeOutline(options.outline || []);
  const fromContents = tops.length >= 2 ? [] : outlineFromContents(rawLines, printed);
  const chosen = tops.length >= 2 ? tops : fromContents;
  const reading = chosen.length >= 2 ? withOutline(paras, chosen, options.title, printed) : withHeadings(paras, options.title, bodyH, printed);
  const chapters = presentContents(reading);
  const folio: Folio = {
    title: options.title,
    subtitle: options.subtitle,
    author: options.author || "",
    stats: { hyphensRejoined: hyphens.n, headersRemoved: headers, chapters: chapters.filter((chapter) => chapter.id !== "contents").length },
    toc: tocOf(chapters),
    chapters,
  };
  options.onStatus?.("Making the EPUB");
  folio.epubHref = epubBlob(folio, options.sourceName);
  folio.epubName = `${options.title.replace(/[^\w.-]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "folio"}.epub`;
  return folio;
}

const WORDS_A_PAGE = 320;

/** A book that already has paragraphs, rather than a picture of a page. */
export function folioFromPieces(
  pieces: { level: 0 | 1 | 2; text: string }[],
  meta: { title: string; subtitle: string; author?: string; sourceName: string },
): Folio {
  const chapters: Folio["chapters"] = [];
  let current: Folio["chapters"][number] | null = null;
  let page = 1;
  let words = 0;
  for (const piece of pieces) {
    const text = piece.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (piece.level === 1) {
      current = pushChapter(chapters, text, page);
      continue;
    }
    if (!current) current = pushChapter(chapters, meta.title, page);
    if (piece.level === 2) {
      current.blocks.push({ t: "h2", id: `${current.id}-s${current.blocks.length}`, s: text, page, section: true });
      continue;
    }
    current.blocks.push({ t: "p", runs: [piece.text], page });
    words += text.split(" ").length;
    if (words >= WORDS_A_PAGE) {
      page += 1;
      words = 0;
    }
  }
  if (!chapters.length) throw new Error("No text could be read from that file.");
  const presented = presentContents(chapters);
  const folio: Folio = {
    title: meta.title,
    subtitle: meta.subtitle,
    author: meta.author || "",
    stats: { hyphensRejoined: 0, headersRemoved: 0, chapters: presented.filter((chapter) => chapter.id !== "contents").length },
    toc: tocOf(presented),
    chapters: presented,
  };
  folio.epubHref = epubBlob(folio, meta.sourceName);
  folio.epubName = `${meta.title.replace(/[^\w.-]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "folio"}.epub`;
  return folio;
}

/** Rebuild the downloadable EPUB after a passage has been edited. */
export function republish(folio: Folio): Folio {
  if (typeof document === "undefined") return folio;
  if (folio.epubHref?.startsWith("blob:") && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(folio.epubHref);
  const next: Folio = { ...folio };
  next.epubHref = epubBlob(next, next.epubName || next.title);
  if (!next.epubName) {
    next.epubName = `${next.title.replace(/[^\w.-]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "folio"}.epub`;
  }
  return next;
}
