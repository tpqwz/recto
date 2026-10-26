/**
 * Retired for the sample. Writes under /tmp so it cannot replace the public-domain edition.
 *   node scripts/build-folio.mjs
 * Writes /tmp/bailey-folio/book.json and /tmp/bailey-folio/a-compilation-on-sex.epub
 */
import { getDocument } from "/tmp/pdftools/node_modules/pdfjs-dist/legacy/build/pdf.mjs";
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

const PDF = "/workspace/attachments/ACoS_Bailey.pdf";
const WORDS = "/tmp/words_alpha.txt";
const BOOK_JSON = "/tmp/bailey-folio/book.json";
const EPUB_PATH = "/tmp/bailey-folio/a-compilation-on-sex.epub";
const STAGE = "/tmp/folio-epub";

const CHAPTERS = [
  { n: 1, title: "The Sex Energy", page: 1 },
  { n: 2, title: "The Problem of Sex", page: 4 },
  { n: 3, title: "Sex and Discipleship", page: 45 },
  { n: 4, title: "Marriage and Parenthood", page: 49 },
  { n: 5, title: "Chakras and Sex Energy", page: 62 },
  { n: 6, title: "Transmutation and Transference", page: 74 },
  { n: 7, title: "Kundalini and Sex Energy", page: 93 },
  { n: 8, title: "Disease and Sex Energy", page: 95 },
  { n: 9, title: "Homosexuality", page: 110 },
  { n: 10, title: "The Rays and Sex Energy", page: 114 },
  { n: 11, title: "Astrology and Sex Energy", page: 119 },
  { n: 12, title: "Devas and Sex Energy", page: 126 },
  { n: 13, title: "Cosmic Correspondences to the Sex Impulse", page: 130 },
  { n: 14, title: "The Mystery of Sex", page: 143 },
];

const RUNNING_TITLES = [
  "the sex energy",
  "the problem of sex",
  "sex and discipleship",
  "marriage and parenthood",
  "chakras and sex energy",
  "transmutation and transference",
  "kundalini and sex energy",
  "disease and sex energy",
  "homosexuality",
  "the rays and sex energy",
  "astrology and sex energy",
  "devas and sex energy",
  "cosmic correspondences to the sex impulse",
  "cosmic correspondences",
  "the mystery of sex",
];

const PREFIXES = new Set(
  "self non pre anti well over under re co mid semi ill pro ex post inter trans sub super out up all cross neo pseudo bi tri fore counter".split(" "),
);
const STOP = new Set(
  "a an of to in is it or as be we he if on at by my no so do up the and for but not are was his her its you our she they them from with that this".split(" "),
);
const REAL_SECTIONS = [
  /^1\.\s+Definition of Sex, of Virtue and of Vice/i,
  /^2\.\s+Sex in the New Age$/i,
  /^3\.\s+Some Suggestions for the Present Cycle/i,
];

const stats = {
  hyphensRejoined: 0,
  hyphensKept: 0,
  headersRemoved: 0,
  fragmentsRejoined: 0,
  wordsSplit: 0,
};
const splitLog = [];

const dict = new Set(
  fs.readFileSync(WORDS, "utf8").split(/\s+/).map((w) => w.trim().toLowerCase()).filter((w) => w.length > 1 && w.length < 28),
);
for (const w of STOP) dict.add(w);

function esc(s) {
  return String(s)
    .replace(/&/g, "&" + "amp;")
    .replace(/</g, "&" + "lt;")
    .replace(/>/g, "&" + "gt;")
    .replace(/"/g, "&" + "quot;");
}
function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}
function normTitle(s) {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}
function isCapsLine(text) {
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length < 3) return false;
  return letters.replace(/[^A-Z]/g, "").length / letters.length >= 0.82;
}
function mode(nums) {
  const m = new Map();
  for (const n of nums) m.set(n, (m.get(n) || 0) + 1);
  let best = nums[0] ?? 0;
  let bestN = -1;
  for (const [k, v] of m) if (v > bestN) { best = k; bestN = v; }
  return best;
}
function overlaps(a, b) {
  return Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 2;
}

function extractLines(items) {
  const its = items.filter((it) => it.str && String(it.str).trim()).map((it) => ({
    str: String(it.str).replace(/\u00ad/g, ""),
    x: it.transform[4],
    y: it.transform[5],
    w: it.width || 0,
    h: it.height || 8,
  }));
  its.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of its) {
    let placed = false;
    for (let i = lines.length - 1; i >= 0 && lines.length - i <= 6; i--) {
      const ln = lines[i];
      if (Math.abs(ln.y - it.y) > 3.2) continue;
      if (ln.items.some((o) => overlaps(o, it))) continue;
      ln.items.push(it);
      ln.y = ln.items.reduce((s, x) => s + x.y, 0) / ln.items.length;
      placed = true;
      break;
    }
    if (!placed) lines.push({ y: it.y, items: [it] });
  }
  return lines.map((ln) => {
    ln.items.sort((a, b) => a.x - b.x);
    let text = "";
    let prev = null;
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
      y: ln.y,
      x0: ln.items[0].x,
      x1: last.x + last.w,
      h: Math.max(...ln.items.map((i) => i.h || 0)),
      text: text.replace(/[ \t]+/g, " ").trim(),
    };
  }).sort((a, b) => b.y - a.y || a.x0 - b.x0);
}

function absorbFragments(lines, pageWidth) {
  const primary = [];
  const frags = [];
  for (const ln of lines) {
    const narrow = ln.x1 - ln.x0 < pageWidth * 0.58;
    if (ln.x0 > pageWidth * 0.4 && narrow && /^[a-z]/.test(ln.text)) frags.push(ln);
    else primary.push({ ...ln });
  }
  for (const fr of frags) {
    let best = null;
    let bestDy = 99;
    for (const ln of primary) {
      const dy = Math.abs(ln.y - fr.y);
      if (dy > 13 || fr.x0 < ln.x1 - 12 || ln.x1 > pageWidth * 0.92) continue;
      if (dy < bestDy) { bestDy = dy; best = ln; }
    }
    if (best) {
      best.text = (best.text + " " + fr.text).replace(/[ \t]+/g, " ").trim();
      best.x1 = Math.max(best.x1, fr.x1);
      stats.fragmentsRejoined++;
    } else primary.push({ ...fr });
  }
  primary.sort((a, b) => b.y - a.y || a.x0 - b.x0);
  return primary;
}

function isRunningHeader(line, pageHeight) {
  if (line.y < pageHeight - 58) return false;
  const raw = line.text.trim();
  if (/^\d{1,3}$/.test(raw)) return true;
  const parts = raw.split(/\s+/);
  while (parts.length && /\d/.test(parts[0]) && parts[0].length <= 5) parts.shift();
  while (parts.length && /\d/.test(parts[parts.length - 1]) && parts[parts.length - 1].length <= 5) parts.pop();
  while (parts.length && parts[parts.length - 1].length <= 3 && !/[a-z]{3}/i.test(parts[parts.length - 1])) parts.pop();
  const n = parts.join(" ").toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
  if (!n) return true;
  return RUNNING_TITLES.includes(n);
}

function mergeHyphen(prev, next) {
  const m = String(next).match(/^([A-Za-z]+)([\s\S]*)$/);
  if (!m || !/[A-Za-z]-$/.test(prev)) return null;
  const suf = m[1];
  const rest = m[2];
  const last = prev.match(/([A-Za-z]+)-$/)[1];
  const concat = (last + suf).toLowerCase();
  const head = prev.slice(0, -last.length - 1);
  if (dict.has(concat)) {
    stats.hyphensRejoined++;
    return { head: head + last + suf, rest };
  }
  if (PREFIXES.has(last.toLowerCase()) && dict.has(suf.toLowerCase())) {
    stats.hyphensKept++;
    return { head: head + last + "-" + suf, rest };
  }
  if (dict.has(last.toLowerCase()) && dict.has(suf.toLowerCase()) && last.length >= 3 && suf.length >= 4) {
    stats.hyphensKept++;
    return { head: head + last + "-" + suf, rest };
  }
  stats.hyphensRejoined++;
  return { head: head + last + suf, rest };
}

function forceGlue(token) {
  const w = token.toLowerCase();
  const keep = new Set("into also onto upon over under other after there these those their about again being until every where which while still inner often total royal area".split(" "));
  if (keep.has(w) || (dict.has(w) && w !== "anda")) return null;
  const lefts = ["and", "the", "was", "his", "her", "for", "but", "not", "are", "from", "with", "that", "this", "is", "of", "to", "in", "it", "or", "as", "be", "an", "on", "at", "by", "we", "he"];
  const rights = ["a", "an", "of", "to", "the", "and", "is"];
  for (const L of lefts) {
    if (!w.startsWith(L) || w.length <= L.length || w.length > 8) continue;
    const R = w.slice(L.length);
    if (rights.includes(R)) return [L, R];
  }
  return null;
}

function segmentToken(token) {
  if (!/^[A-Za-z]+$/.test(token)) return null;
  const lower = token.toLowerCase();
  if (dict.has(lower) || lower.length < 4 || lower.length > 28) return null;
  if (new Set("arjuna buddha buddhas wesak".split(" ")).has(lower)) return null;
  if (token === token.toUpperCase() && /[A-Z]/.test(token)) return null;
  const capital = /^[A-Z]/.test(token);
  const stops = [...STOP].filter((w) => w.length >= 2).sort((a, b) => b.length - a.length);
  const cands = [];
  const takeStops = (s, acc) => {
    if (!s) return acc.length >= 2 ? acc : null;
    if (acc.length >= 4) return null;
    for (const w of stops) {
      if (s.startsWith(w)) {
        const got = takeStops(s.slice(w.length), acc.concat(w));
        if (got) return got;
      }
    }
    return null;
  };
  const onlyStops = takeStops(lower, []);
  if (onlyStops) cands.push(onlyStops);
  for (const w of stops) {
    if (!lower.startsWith(w) || lower.length === w.length) continue;
    const rest = lower.slice(w.length);
    if (dict.has(rest) && (rest.length >= 3 || STOP.has(rest))) cands.push([w, rest]);
  }
  for (let i = lower.length - 1; i >= 4; i--) {
    const a = lower.slice(0, i);
    const b = lower.slice(i);
    if (b.length > 3 || !STOP.has(b) || !dict.has(a)) continue;
    cands.push([a, b]);
  }
  for (let i = 6; i <= lower.length - 6; i++) {
    const a = lower.slice(0, i);
    const b = lower.slice(i);
    if (dict.has(a) && dict.has(b)) cands.push([a, b]);
  }
  const afterI = new Set("nor am have shall will can must know was had".split(" "));
  if (token.startsWith("I") && afterI.has(lower.slice(1))) cands.push(["I", lower.slice(1)]);
  if (!cands.length) return null;
  const commonShort = new Set("man men god way day age sex law ray son end use let set may can did had has him her its own new old few now too nor mind life".split(" "));
  const score = (parts) => {
    const content = parts.filter((p) => p !== "I" && !STOP.has(p));
    let s = content.length ? 36 : 42;
    if (parts[0] === "I") s += 40;
    if (STOP.has(parts[0])) s += parts[0].length * 8;
    for (const p of content) {
      s += Math.min(p.length, 8) * 3;
      if (commonShort.has(p)) s += 20;
      else if (p.length <= 3) s -= 36;
    }
    return s - parts.length;
  };
  let best = null;
  let bestScore = -1e9;
  const seen = new Set();
  for (const parts of cands) {
    const key = parts.join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    const sc = score(parts);
    if (sc > bestScore) { bestScore = sc; best = parts; }
  }
  stats.wordsSplit++;
  splitLog.push(token + " => " + best.join(" "));
  if (!capital) return best.join(" ");
  if (best[0] === "I") return "I " + best.slice(1).join(" ");
  return best[0][0].toUpperCase() + best[0].slice(1) + " " + best.slice(1).join(" ");
}

function cleanupText(s) {
  let t = s.replace(/\u00ad/g, "").replace(/[ \t]+/g, " ");
  t = t.replace(/([a-z])([A-Z])/g, "$1 $2");
  t = t.replace(/\s+([,.;:!?])/g, "$1");
  t = t.replace(/([.?!])([A-Za-z])/g, "$1 $2");
  t = t.replace(/\b(from|and|the|of|to|in|is|as|or|be)\.\s+([a-z])/g, "$1 $2");
  t = t.replace(/\b1\s+ama\b/g, "I am a");
  t = t.replace(/\b1\s+am\b/g, "I am");
  t = t.split(/(\s+)/).map((tok) => {
    const m = tok.match(/^([^A-Za-z]*)([A-Za-z]+)([^A-Za-z]*)$/);
    if (!m) return tok;
    const core = m[2];
    const forced = forceGlue(core);
    let fixed = core;
    if (forced) {
      stats.wordsSplit++;
      splitLog.push(core + " => " + forced.join(" "));
      fixed = /^[A-Z]/.test(core)
        ? forced[0][0].toUpperCase() + forced[0].slice(1) + " " + forced.slice(1).join(" ")
        : forced.join(" ");
    } else fixed = segmentToken(core) || core;
    return m[1] + fixed + m[3];
  }).join("");
  t = t.replace(/\blama brother of yours\b/g, "I am a brother of yours");
  t = t.replace(/\btbe not be so\b/g, "this not be so");
  t = t.replace(/\bup ona\b/g, "upon a");
  return t.replace(/[ \t]{2,}/g, " ").trim();
}

function chapterForPage(printed) {
  let cur = CHAPTERS[0];
  for (const c of CHAPTERS) if (printed >= c.page) cur = c;
  return cur;
}
function isSectionHeading(text) {
  return REAL_SECTIONS.some((re) => re.test(text.trim().replace(/\s+/g, " ")));
}
function isRealCapsHeading(text) {
  if (!isCapsLine(text) || text.length < 8 || text.length > 68) return false;
  const words = text.replace(/[^A-Za-z ]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length < 3 || words.length > 10) return false;
  const known = words.filter((w) => dict.has(w.toLowerCase())).length;
  return known / words.length >= 0.8;
}
function isListLine(text, x0, margin) {
  if (x0 < margin + 6) return false;
  return /^(?:\([a-z]{1,3}\)|[a-z]|\d{1,2})[.)]\s+\S/.test(text);
}

function assembleParagraph(lineGroup) {
  const runs = [];
  let buf = "";
  let bufPage = lineGroup[0].printed;
  const flush = () => { if (buf) { runs.push(buf); buf = ""; } };
  const take = (lineText, page) => {
    const piece = lineText.trim();
    const hyphen = /[A-Za-z]-$/.test(buf.trim());
    if (hyphen && buf) {
      const merged = mergeHyphen(buf.trim(), piece);
      if (merged) {
        if (page !== bufPage) {
          const head = buf.trim().replace(/[A-Za-z]+-$/, "");
          const wordAndRest = (merged.head.slice(head.length) + (merged.rest || "")).replace(/^\s+/, "");
          const wm = wordAndRest.match(/^(\S+)\s*([\s\S]*)$/);
          buf = (head + (wm ? wm[1] : "")).replace(/ +/g, " ").trim();
          flush();
          runs.push(page);
          bufPage = page;
          buf = wm && wm[2] ? wm[2].trim() : "";
        } else buf = (merged.head + (merged.rest || "")).replace(/ +/g, " ").trim();
        return;
      }
    }
    if (!buf) { buf = piece; bufPage = page; return; }
    if (page !== bufPage) { flush(); runs.push(page); bufPage = page; buf = piece; return; }
    buf = (buf + " " + piece).replace(/ +/g, " ");
  };
  for (const ln of lineGroup) take(ln.text, ln.printed);
  flush();
  const cleaned = [];
  for (const r of runs) {
    if (typeof r === "number") { if (cleaned[cleaned.length - 1] !== r) cleaned.push(r); }
    else { const c = cleanupText(r); if (c) cleaned.push(c); }
  }
  return cleaned;
}
function textOf(runs) {
  if (!runs) return "";
  if (typeof runs === "string") return runs;
  return runs.filter((r) => typeof r === "string").join(" ");
}

async function main() {
  const data = new Uint8Array(fs.readFileSync(PDF));
  const doc = await getDocument({ data, disableWorker: true, useSystemFonts: true }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    pages.push({ n, w: vp.width, h: vp.height, lines: absorbFragments(extractLines(tc.items), vp.width) });
  }

  const bodyLines = [];
  for (const p of pages) {
    if (p.n < 15 || p.n > 162) continue;
    const printed = p.n - 14;
    const content = [];
    for (const ln of p.lines) {
      if (isRunningHeader(ln, p.h)) { stats.headersRemoved++; continue; }
      if (/theology library|claremont/i.test(ln.text) && ln.y < 50) continue;
      content.push({ ...ln, printed, pdf: p.n, pw: p.w, ph: p.h });
    }
    const margin = mode(content.filter((l) => l.x1 - l.x0 > 80).map((l) => Math.round(l.x0))) || 20;
    for (const ln of content) ln.margin = margin;
    bodyLines.push(...content);
  }

  const blocks = [];
  let i = 0;
  let skippingTitle = true;
  let currentChapter = 1;
  while (i < bodyLines.length) {
    const ln = bodyLines[i];
    const ch = chapterForPage(ln.printed);
    if (ch.n !== currentChapter) { currentChapter = ch.n; skippingTitle = true; }
    if (RUNNING_TITLES.includes(normTitle(ln.text)) && ln.text.length < 48) { i++; stats.headersRemoved++; continue; }
    if (skippingTitle && isCapsLine(ln.text) && ln.text.length < 80) {
      i++;
      while (bodyLines[i] && isCapsLine(bodyLines[i].text) && bodyLines[i].text.length < 60 && bodyLines[i].printed === ln.printed) i++;
      skippingTitle = false;
      continue;
    }
    skippingTitle = false;
    if (isRealCapsHeading(ln.text)) {
      let title = ln.text;
      let j = i + 1;
      while (bodyLines[j] && isRealCapsHeading(bodyLines[j].text) && bodyLines[j].printed === ln.printed && ln.y - bodyLines[j].y < 28) {
        title += " " + bodyLines[j].text;
        j++;
      }
      blocks.push({ t: "h2", id: `c${ch.n}-${slug(title)}`, s: cleanupText(title), page: ln.printed, chapter: ch.n });
      i = j;
      continue;
    }
    if (isSectionHeading(ln.text)) {
      blocks.push({
        t: "h2",
        id: `c${ch.n}-${slug(ln.text)}`,
        s: cleanupText(ln.text),
        page: ln.printed,
        chapter: ch.n,
        section: true,
      });
      i++;
      continue;
    }
    const list = isListLine(ln.text, ln.x0, ln.margin);
    const group = [ln];
    let j = i + 1;
    while (j < bodyLines.length) {
      const nx = bodyLines[j];
      if (chapterForPage(nx.printed).n !== ch.n) break;
      const prevLine = group[group.length - 1];
      const gap = prevLine.printed === nx.printed ? prevLine.y - nx.y : 12;
      const prevHyphen = /[A-Za-z]-$/.test(prevLine.text.trim());
      const indented = nx.x0 > nx.margin + 8;
      const prevShort = prevLine.x1 < nx.pw * 0.78 && prevLine.printed === nx.printed;
      const pageBreak = nx.printed !== prevLine.printed;
      const prevFull = prevLine.x1 > prevLine.pw * 0.78;
      const bigGap = gap > 18;
      if (isRealCapsHeading(nx.text) || isSectionHeading(nx.text)) break;
      if (list) {
        if (!prevHyphen && (isListLine(nx.text, nx.x0, nx.margin) || nx.x0 <= nx.margin + 10 || bigGap)) break;
        group.push(nx); j++; continue;
      }
      let cont = false;
      if (prevHyphen) cont = true;
      else if (pageBreak && prevFull && !indented) cont = true;
      else if (!pageBreak && !indented && !prevShort && !bigGap) cont = true;
      else if (!pageBreak && !indented && prevFull && gap < 16) cont = true;
      if (!cont || (isListLine(nx.text, nx.x0, nx.margin) && !prevHyphen)) break;
      group.push(nx); j++;
    }
    const runs = assembleParagraph(group);
    const plain = textOf(runs);
    if (plain.replace(/[^A-Za-z]/g, "").length >= 2) {
      const kind = /^\(\d+\)\s/.test(plain) ? "extract" : undefined;
      blocks.push({ t: list ? "li" : "p", runs, page: group[0].printed, chapter: ch.n, kind });
    }
    i = j;
  }

  const byChapter = new Map(CHAPTERS.map((c) => [c.n, []]));
  for (const b of blocks) {
    if (b.t === "h2") {
      const title = CHAPTERS.find((c) => c.n === b.chapter).title;
      const ns = normTitle(b.s);
      const nt = normTitle(title);
      if (ns.includes(nt) || nt.includes(ns)) continue;
    }
    byChapter.get(b.chapter).push(b);
  }
  const usedIds = new Set();
  const uniqueId = (id) => { let x = id || "s"; let k = 2; while (usedIds.has(x)) x = `${id}-${k++}`; usedIds.add(x); return x; };
  const chapters = CHAPTERS.map((c) => {
    const id = `c${String(c.n).padStart(2, "0")}`;
    const body = [{ t: "h1", id, s: c.title, page: c.page, chapter: c.n }];
    for (const b of byChapter.get(c.n)) {
      if (b.t === "h2") b.id = uniqueId(b.id);
      body.push(b);
    }
    return { id, title: c.title, page: c.page, blocks: body };
  });

  const front = buildFrontMatter(pages);
  const contentsChapter = {
    id: "contents",
    title: "Contents",
    page: null,
    blocks: [
      { t: "h1", id: "contents", s: "Contents" },
      ...CHAPTERS.map((c) => ({ t: "toc-entry", id: `c${String(c.n).padStart(2, "0")}`, n: c.n, s: c.title, page: c.page })),
    ],
  };
  const toc = [
    ...front.map((f) => ({ id: f.id, label: f.title, page: null, children: [] })),
    { id: "contents", label: "Contents", page: null, children: [] },
    ...chapters.map((c) => ({
      id: c.id,
      label: c.title,
      page: c.page,
      children: c.blocks.filter((b) => b.t === "h2" && b.section).map((b) => ({
        id: b.id,
        label: b.s.replace(/^\d+\.\s*/, ""),
        page: b.page,
        children: [],
      })),
    })),
  ];
  const book = {
    title: "A Compilation on Sex",
    subtitle: "From the writings of Alice A. Bailey and the Tibetan Master, Djwhal Khul",
    author: "Alice A. Bailey",
    contributor: "Djwhal Khul",
    publisher: "Lucis Publishing Company",
    year: "1980",
    stats: {
      ...stats,
      paragraphs: [...front, contentsChapter, ...chapters].reduce((n, c) => n + c.blocks.filter((b) => b.t === "p" || b.t === "li").length, 0),
      chapters: 14,
    },
    toc,
    chapters: [...front, contentsChapter, ...chapters],
  };
  fs.mkdirSync(path.dirname(BOOK_JSON), { recursive: true });
  fs.writeFileSync(BOOK_JSON, JSON.stringify(book));
  writeEpub(book);
  const blob = JSON.stringify(book);
  const at = blob.indexOf("Law of Service");
  const debug = [
    JSON.stringify(book.stats, null, 2),
    at >= 0 ? blob.slice(Math.max(0, at - 120), at + 220) : "MISSING Law of Service",
    "",
    ...book.toc.map((t) => `${t.page ?? "—"}\t${t.label}` + (t.children || []).map((c) => `\n\t${c.page}\t${c.label}`).join("")),
    "",
    "SPLITS",
    ...splitLog,
  ];
  fs.writeFileSync("/tmp/folio-debug.txt", debug.join("\n"));
  console.log(book.stats);
  console.log("fragments sample:", at >= 0 ? blob.slice(at - 80, at + 160) : "missing");
}

function buildFrontMatter(pages) {
  const out = [];
  out.push({
    id: "title-page",
    title: "Title page",
    page: null,
    blocks: [
      { t: "h1", id: "title-page", s: "A Compilation on Sex" },
      { t: "p", kind: "center", runs: ["Compiled by a student who has imposed his own punctuation on some of the original text"] },
      { t: "p", kind: "center", runs: ["From the Writings of Alice A. Bailey and the Tibetan Master, Djwhal Khul"] },
      { t: "p", kind: "center", runs: ["Lucis Publishing Company, New York"] },
      { t: "p", kind: "center", runs: ["Lucis Press, Ltd., London"] },
    ],
  });
  out.push({
    id: "copyright",
    title: "Copyright",
    page: null,
    blocks: [
      { t: "h1", id: "copyright", s: "Copyright" },
      { t: "p", kind: "center", runs: ["This compilation is extracted from books by Alice A. Bailey for which the Lucis Trust holds copyrights."] },
      { t: "p", kind: "center", runs: ["First printing, 1980."] },
      { t: "p", kind: "center", runs: ["The Lucis Publishing Company is a non-profit organisation owned by the Lucis Trust. No royalties are paid on this book."] },
      { t: "p", kind: "center", runs: ["Manufactured in the United States of America by Fort Orange Press, Inc., Albany, N.Y."] },
    ],
  });
  out.push(proseFromPages(pages, [9], "epigraph", "Epigraph"));
  out.push(referenceChapter());
  out.push(invocationFrom());
  out.push(proseFromPages(pages, [13, 14], "statement", "A Statement by the Tibetan"));
  return out;
}

function proseFromPages(pages, nums, id, title) {
  const lines = [];
  for (const n of nums) {
    const p = pages.find((x) => x.n === n);
    for (const ln of p.lines) {
      if (isCapsLine(ln.text) && ln.text.length < 64) continue;
      if (ln.text.replace(/[^A-Za-z]/g, "").length < 2) continue;
      lines.push({ ...ln, printed: 0, pw: p.w });
    }
  }
  const blocks = [{ t: "h1", id, s: title }];
  const margin = mode(lines.filter((l) => l.x1 - l.x0 > 60).map((l) => Math.round(l.x0))) || 20;
  let buf = [];
  const flush = () => {
    if (!buf.length) return;
    const runs = assembleParagraph(buf);
    if (textOf(runs).replace(/[^A-Za-z]/g, "").length > 12) blocks.push({ t: "p", runs });
    buf = [];
  };
  for (const ln of lines) {
    const prev = buf[buf.length - 1];
    const prevHyphen = prev && /[A-Za-z]-$/.test(prev.text);
    const yGap = prev ? prev.y - ln.y : 0;
    const prevEnded = prev && /[.?!]"?$/.test(prev.text.trim());
    const prevShort = prev && prev.x1 < (prev.pw || 280) * 0.78;
    const nextCapital = /^[A-Z]/.test(ln.text);
    const indented = ln.x0 > margin + 14;
    const hardGap = yGap > 22;
    const newPara = prevEnded && (indented || (prevShort && nextCapital));
    if (buf.length && !prevHyphen && (hardGap || newPara)) flush();
    buf.push(ln);
  }
  flush();
  return { id, title, page: null, blocks };
}

function invocationFrom() {
  const verse = [
    "From the point of Light within the Mind of God",
    "Let light stream forth into the minds of men.",
    "Let Light descend on Earth.",
    "From the point of Love within the Heart of God",
    "Let love stream forth into the hearts of men.",
    "May Christ return to Earth.",
    "From the centre where the Will of God is known",
    "Let purpose guide the little wills of men—",
    "The purpose which the Masters know and serve.",
    "From the centre which we call the race of men",
    "Let the Plan of Love and Light work out",
    "And may it seal the door where evil dwells.",
    "Let Light and Love and Power restore the Plan on Earth.",
  ];
  const note = "The above Invocation or Prayer does not belong to any person or group but to all Humanity. The beauty and the strength of this Invocation lies in its simplicity, and in its expression of certain central truths which all men, innately and normally, accept—the truth of the existence of a basic Intelligence to Whom we vaguely give the name of God; the truth that behind all outer seeming, the motivating power of the universe is Love; the truth that a great Individuality came to earth, called by Christians, the Christ, and embodied that love so that we could understand; the truth that both love and intelligence are effects of what is called the Will of God; and finally the self-evident truth that only through humanity itself can the Divine Plan work out.";
  return {
    id: "invocation",
    title: "The Great Invocation",
    page: null,
    blocks: [
      { t: "h1", id: "invocation", s: "The Great Invocation" },
      ...verse.map((s) => ({ t: "p", kind: "verse", runs: [s] })),
      { t: "p", runs: [note] },
      { t: "p", kind: "center", runs: ["Alice A. Bailey"] },
    ],
  };
}

function referenceChapter() {
  const rows = [
    ["1", "Initiation, Human and Solar", "1922", "9th, 1970", "225"],
    ["2", "Letters on Occult Meditation", "1922", "11th, 1973", "360"],
    ["3", "A Treatise on Cosmic Fire", "1925", "10th, 1973", "1,283"],
    ["4", "A Treatise on White Magic", "1934", "11th, 1971", "640"],
    ["5", "The Destiny of the Nations", "1949", "3rd, 1968", "152"],
    ["6", "Education in the New Age", "1954", "6th, 1971", "153"],
    ["7", "A Treatise on the Seven Rays, Vol. I — Esoteric Psychology", "1936", "6th, 1970", "430"],
    ["8", "Vol. II — Esoteric Psychology", "1942", "5th, 1970", "751"],
    ["9", "Vol. III — Esoteric Astrology", "1951", "7th, 1970", "695"],
    ["10", "Vol. IV — Esoteric Healing", "1953", "5th, 1970", "715"],
    ["11", "Vol. V — The Rays and the Initiations", "1960", "3rd, 1970", "769"],
    ["12", "The Externalisation of the Hierarchy", "1957", "3rd, 1968", "701"],
    ["13", "Discipleship in the New Age, Vol. I", "1944", "7th, 1971", "790"],
  ];
  return {
    id: "reference-index",
    title: "Reference Index",
    page: null,
    blocks: [
      { t: "h1", id: "reference-index", s: "Reference Index" },
      { t: "p", kind: "center", runs: ["Books by the Tibetan (Djwhal Khul) through Alice A. Bailey"] },
      { t: "p", runs: ["A reference such as (6 — 135/6) at the end of a quotation is taken from Education in the New Age, book 6, starting on page 135 and continued on page 136."] },
      { t: "table", headers: ["No.", "Title", "First edition", "Reference edition", "Pages"], rows },
    ],
  };
}

function renderRuns(runs, pageIds) {
  let html = "";
  for (const r of runs || []) {
    if (typeof r === "number") {
      if (r > 0 && !pageIds.has(r)) {
        pageIds.add(r);
        html += `<span epub:type="pagebreak" id="page-${r}" role="doc-pagebreak" aria-label="${r}" title="${r}"></span>`;
      }
    } else html += esc(r);
  }
  return html;
}

function chapterHtml(ch, pageIds) {
  const parts = [];
  let seenPara = false;
  const mark = (page) => {
    if (page && !pageIds.has(page)) {
      pageIds.add(page);
      parts.push(`<span epub:type="pagebreak" id="page-${page}" role="doc-pagebreak" aria-label="${page}" title="${page}"></span>`);
    }
  };
  for (const b of ch.blocks) {
    if (b.t === "h1") { mark(b.page); parts.push(`<h1 id="${esc(b.id)}">${esc(b.s)}</h1>`); seenPara = false; }
    else if (b.t === "h2") { mark(b.page); parts.push(`<h2 id="${esc(b.id)}">${esc(b.s)}</h2>`); seenPara = false; }
    else if (b.t === "toc-entry") {
      parts.push(`<p class="tocline"><a href="c${String(b.n).padStart(2, "0")}.xhtml">${esc(b.n + ". " + b.s)}</a><span class="pg">${b.page}</span></p>`);
    } else if (b.t === "table") {
      const head = b.headers.map((h) => `<th>${esc(h)}</th>`).join("");
      const body = b.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("");
      parts.push(`<table class="index"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`);
    } else if (b.t === "p" || b.t === "li") {
      mark(b.page);
      const classes = [];
      if (b.t === "li") classes.push("item");
      if (b.kind === "verse") classes.push("verse");
      if (b.kind === "center") classes.push("center");
      if (b.kind === "extract") classes.push("extract");
      if (!seenPara && b.t === "p" && b.kind !== "verse" && b.kind !== "center") classes.push("noindent");
      if (b.t === "p" && b.kind !== "verse" && b.kind !== "center") seenPara = true;
      const cls = classes.length ? ` class="${classes.join(" ")}"` : "";
      parts.push(`<p${cls}>${renderRuns(b.runs, pageIds)}</p>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">
<head><meta charset="utf-8"/><title>${esc(ch.title)}</title><link rel="stylesheet" type="text/css" href="../style.css"/></head>
<body><section epub:type="${ch.page ? "chapter" : "frontmatter"}">
${parts.join("\n")}
</section></body></html>
`;
}

const EPUB_CSS = `body{font-family:Georgia,"Palatino Linotype",Palatino,serif;line-height:1.5;margin:0;padding:0 6%;color:#1c1915}
h1{font-weight:normal;font-size:1.55em;line-height:1.25;margin:1.4em 0 .7em;text-align:center}
h2{font-weight:normal;font-style:italic;font-size:1.15em;margin:1.5em 0 .45em}
p{margin:0 0 .15em;text-indent:1.15em}
p.noindent,p.extract,p.verse,p.center,p.item,p.tocline{text-indent:0}
p.extract{margin-top:.9em}
p.item{margin:.28em 0 .28em 1.2em}
p.verse{margin:.12em 0;text-align:center}
p.center{text-align:center;margin:.5em 1em}
p.tocline{margin:.4em 0}
p.tocline a{color:inherit;text-decoration:none}
p.tocline .pg{float:right}
table.index{width:100%;border-collapse:collapse;margin:1em 0 2em;font-size:.92em}
table.index th,table.index td{text-align:left;vertical-align:top;padding:.28em .4em;border-bottom:1px solid #ddd}
table.index th{font-style:italic;font-weight:normal}
`;

function writeEpub(book) {
  fs.rmSync(STAGE, { recursive: true, force: true });
  fs.mkdirSync(path.join(STAGE, "META-INF"), { recursive: true });
  fs.mkdirSync(path.join(STAGE, "OEBPS", "text"), { recursive: true });
  fs.writeFileSync(path.join(STAGE, "META-INF", "container.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>
<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
</rootfiles></container>`);
  fs.writeFileSync(path.join(STAGE, "OEBPS", "style.css"), EPUB_CSS);
  const pageIds = new Set();
  const manifest = [];
  const spine = [];
  for (const ch of book.chapters) {
    fs.writeFileSync(path.join(STAGE, "OEBPS", "text", `${ch.id}.xhtml`), chapterHtml(ch, pageIds));
    manifest.push(`<item id="${ch.id}" href="text/${ch.id}.xhtml" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="${ch.id}"/>`);
  }
  let order = 1;
  const ncxPoints = book.toc.map((t) => {
    const self = order++;
    const kids = (t.children || []).map((c) => {
      const o = order++;
      return `<navPoint id="nav-${c.id}" playOrder="${o}"><navLabel><text>${esc(c.label)}</text></navLabel><content src="text/${t.id}.xhtml#${c.id}"/></navPoint>`;
    }).join("");
    return `<navPoint id="nav-${t.id}" playOrder="${self}"><navLabel><text>${esc(t.label)}</text></navLabel><content src="text/${t.id}.xhtml"/>${kids}</navPoint>`;
  }).join("\n");
  const tocOl = book.toc.map((t) => {
    const kids = (t.children || []).map((c) => `<li><a href="text/${t.id}.xhtml#${esc(c.id)}">${esc(c.label)}</a></li>`).join("");
    return `<li><a href="text/${t.id}.xhtml">${esc(t.label)}</a>${kids ? `<ol>${kids}</ol>` : ""}</li>`;
  }).join("\n");
  const pageList = [...pageIds].sort((a, b) => a - b).map((p) => {
    const ch = book.chapters.find((c) =>
      c.id.startsWith("c") &&
      c.blocks.some((b) => b.t !== "toc-entry" && (b.page === p || (Array.isArray(b.runs) && b.runs.includes(p)))),
    );
    const href = `text/${ch ? ch.id : "c01"}.xhtml#page-${p}`;
    return { p, href, li: `<li><a href="${href}">${p}</a></li>` };
  });
  fs.writeFileSync(path.join(STAGE, "OEBPS", "nav.xhtml"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">
<head><meta charset="utf-8"/><title>Contents</title></head><body>
<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${tocOl}</ol></nav>
<nav epub:type="page-list" hidden="hidden"><ol>${pageList.map((x) => x.li).join("")}</ol></nav>
</body></html>`);
  const pageTargets = pageList.map((x) => {
    const o = order++;
    return `<pageTarget id="pt-${x.p}" type="normal" value="${x.p}" playOrder="${o}"><navLabel><text>${x.p}</text></navLabel><content src="${x.href}"/></pageTarget>`;
  }).join("");
  fs.writeFileSync(path.join(STAGE, "OEBPS", "toc.ncx"), `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="urn:uuid:7c1e9a40-6b2f-4d58-9a11-recto1980"/>
<meta name="dtb:depth" content="2"/><meta name="dtb:totalPageCount" content="${pageIds.size}"/><meta name="dtb:maxPageNumber" content="148"/></head>
<docTitle><text>A Compilation on Sex</text></docTitle><navMap>${ncxPoints}</navMap>
<pageList><navLabel><text>Pages</text></navLabel>${pageTargets}</pageList></ncx>`);
  fs.writeFileSync(path.join(STAGE, "OEBPS", "content.opf"), `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="3.0" xml:lang="en" prefix="schema: http://schema.org/">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">urn:uuid:7c1e9a40-6b2f-4d58-9a11-recto1980</dc:identifier>
<dc:title>A Compilation on Sex</dc:title>
<dc:creator>Alice A. Bailey</dc:creator>
<dc:contributor>Djwhal Khul</dc:contributor>
<dc:language>en</dc:language>
<dc:publisher>Lucis Publishing Company</dc:publisher>
<dc:date>1980</dc:date>
<dc:source>A Compilation on Sex, Lucis Publishing Company, 1980, library call number HQ 767.2 C65 1980</dc:source>
<dc:rights>Extracted from books by Alice A. Bailey for which the Lucis Trust holds copyrights. First printing 1980.</dc:rights>
<meta property="dcterms:modified">2026-10-24T16:00:00Z</meta>
<meta property="pageBreakSource">Printed pages of A Compilation on Sex, Lucis Publishing Company, 1980 (HQ 767.2 C65 1980)</meta>
<meta property="schema:accessibilityFeature">pageBreakMarkers</meta>
<meta property="schema:accessibilityFeature">pageNavigation</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="css" href="style.css" media-type="text/css"/>
${manifest.join("\n")}
</manifest>
<spine toc="ncx"><itemref idref="nav" linear="no"/>${spine.join("")}</spine>
</package>`);
  const missing = [];
  for (let p = 1; p <= 148; p++) if (!pageIds.has(p)) missing.push(p);
  fs.writeFileSync("/tmp/folio-pages.txt", `pages ${pageIds.size}\nmissing ${missing.join(",")}\n`);
  const py = spawnSync("python3", ["-c", `
import os, zipfile
stage, out = ${JSON.stringify(STAGE)}, ${JSON.stringify(EPUB_PATH)}
os.makedirs(os.path.dirname(out), exist_ok=True)
if os.path.exists(out): os.remove(out)
with zipfile.ZipFile(out, "w") as z:
    info = zipfile.ZipInfo("mimetype")
    info.compress_type = zipfile.ZIP_STORED
    info.date_time = (2020,1,1,0,0,0)
    info.external_attr = 0
    info.flag_bits = 0
    z.writestr(info, b"application/epub+zip")
    for dirpath, _, files in os.walk(stage):
        for fn in sorted(files):
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, stage).replace(os.sep, "/")
            z.write(full, rel, compress_type=zipfile.ZIP_DEFLATED)
print("zipped", os.path.getsize(out))
`], { encoding: "utf8" });
  if (py.status !== 0) { console.error(py.stderr); throw new Error("zip failed"); }
  console.log(py.stdout.trim());
  console.log(fs.readFileSync("/tmp/folio-pages.txt", "utf8").trim());
}

main().catch((err) => { console.error(err); process.exit(1); });
