import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectPrinted } from "./pages.ts";
import { mergeHyphen, repairText, type WordList } from "./repair.ts";
import { assembleFolio, epubArchive, type Line } from "./assemble.ts";
import { strToU8, unzipSync, zipSync } from "fflate";
import { linesFromBoxes, linesFromRegion, pictureScale } from "./picture.ts";
import { parseSettings } from "./settings.ts";
import { checkSameText, folioText, textFromReference } from "./check.ts";
import { hideSample, listHoldings, listShelf, rememberOpened, withoutOpened, SHELF_LIMIT, type ShelfState } from "./shelf.ts";
import { catalogFromOpened, recordFor, sortRecords, storeRecord } from "./library.ts";

const list: WordList = {
  has: (word) =>
    new Set(
      "conscious self of the group mind sex synchronously realize realise civilisation civilization bailey often into shall other average aver age trac dour our inculcating eating cul transiting sitting tran".split(
        " ",
      ),
    ).has(word),
};

function line(text: string, page: number, y: number, extra: Partial<Line> = {}): Line {
  return { text, y, x0: 72, x1: 400, h: 12, page, pageH: 792, pageW: 612, ...extra };
}

describe("printed pages", () => {
  it("keeps the file page when no folio is printed", () => {
    const pages = detectPrinted([line("A sentence on the first page.", 1, 400), line("And the second.", 2, 400)]);
    assert.equal(pages.label(1), 1);
    assert.equal(pages.label(2), 2);
  });

  it("reads an arabic run and ignores a year in the header", () => {
    const lines: Line[] = [];
    for (let n = 1; n <= 6; n++) {
      lines.push(line("A History 1980", n, 760));
      lines.push(line(String(n + 10), n, 20));
      lines.push(line("Body text of this page stays.", n, 400));
    }
    const pages = detectPrinted(lines);
    assert.equal(pages.label(1), 11);
    assert.equal(pages.label(6), 16);
  });

  it("keeps roman front matter and restarts arabic at 1", () => {
    const lines: Line[] = [];
    for (const [file, mark, y] of [
      [1, "i", 20],
      [2, "ii", 20],
      [3, "iii", 20],
      [4, "1", 20],
      [5, "2", 20],
      [6, "3", 20],
    ] as const) {
      lines.push(line(mark, file, y));
      lines.push(line("Body text of this page stays.", file, 400));
    }
    const pages = detectPrinted(lines);
    assert.equal(pages.label(1), "i");
    assert.equal(pages.label(2), "ii");
    assert.equal(pages.label(3), "iii");
    assert.equal(pages.label(4), 1);
    assert.equal(pages.label(6), 3);
  });

  it("does not number a trailing page after the last printed folio", () => {
    const lines: Line[] = [];
    for (let n = 1; n <= 4; n++) {
      lines.push(line(String(n), n, 20));
      lines.push(line("Body text of this page stays.", n, 400));
    }
    lines.push(line("Library stamp", 5, 20));
    lines.push(line("Body text of this page stays.", 5, 400));
    const pages = detectPrinted(lines);
    assert.equal(pages.label(1), 1);
    assert.equal(pages.label(4), 4);
    assert.equal(pages.label(5), null);
  });

  it("does not let a repeated chapter number set the offset", () => {
    const lines: Line[] = [];
    for (let n = 1; n <= 8; n++) {
      lines.push(line("3", n, 760));
      lines.push(line(String(20 + n), n, 20));
      lines.push(line("Body text of this page stays.", n, 400));
    }
    const pages = detectPrinted(lines);
    assert.equal(pages.label(1), 21);
    assert.equal(pages.label(8), 28);
  });
});

describe("word repair", () => {
  it("rejoins a split word and keeps a real hyphen", () => {
    const hyphens = { n: 0 };
    const joined = mergeHyphen("the con-", "scious mind", list, hyphens);
    assert.equal(joined?.head, "the conscious");
    assert.equal(hyphens.n, 1);
    const kept = mergeHyphen("the self-", "conscious mind", list, hyphens);
    assert.equal(kept?.head, "the self-conscious");
    assert.equal(hyphens.n, 1);
  });

  it("splits glued tokens and fixes one OCR edit", () => {
    assert.equal(repairText("mind ofthe group", list), "mind of the group");
    assert.equal(repairText("ofaverage mind", list), "of average mind");
    assert.equal(repairText("andour group", list), "and our group");
    assert.equal(repairText("inculeating", list), "inculcating");
    assert.equal(repairText("transitting", list), "transiting");
    assert.equal(repairText("Attrac-", list), "Attrac-");
    assert.equal(repairText("Ishall go", list), "I shall go");
    assert.equal(repairText("into the group", list), "into the group");
    assert.equal(repairText("synchronouslv done", list), "synchronously done");
  });

  it("does not correct a kept name or a British spelling", () => {
    assert.equal(repairText("Wesak and antahkarana", list), "Wesak and antahkarana");
    assert.equal(repairText("realise civilisation", list), "realise civilisation");
    assert.equal(repairText("colourise the group", list), "colourise the group");
  });
});

describe("opened folio", () => {
  it("stores the printed labels and the repaired sentence", () => {
    const g = globalThis as { URL?: { createObjectURL?: (b: Blob) => string } };
    g.URL = g.URL || {};
    g.URL.createObjectURL = () => "blob:folio-test";
    const lines: Line[] = [];
    for (const [file, mark] of [
      [1, "i"],
      [2, "ii"],
      [3, "1"],
      [4, "2"],
    ] as const) {
      lines.push(line(mark, file, 20));
      lines.push(line(file === 3 ? "The con-" : "A body sentence stays here.", file, 500));
      if (file === 3) lines.push(line("scious mind ofthe group.", file, 480));
    }
    const folio = assembleFolio(lines, {
      title: "Sample",
      subtitle: "From a PDF",
      sourceName: "sample.pdf",
      emptyMessage: "empty",
      lexicon: list,
    });
    assert.equal(folio.chapters[0].page, "i");
    const text = folio.chapters
      .flatMap((ch) => ch.blocks)
      .flatMap((block) => block.runs || [])
      .filter((run) => typeof run === "string")
      .join(" ");
    assert.match(text, /conscious mind of the group/);
    assert.equal(folio.stats.hyphensRejoined, 1);
    const hrefs = folio.chapters.flatMap((ch) => ch.blocks.map((block) => block.page));
    assert.deepEqual(hrefs.filter((page, index) => hrefs.indexOf(page) === index), ["i", "ii", 1, 2]);
    const body = folio.chapters.flatMap((ch) => ch.blocks).find((block) => block.page === 1 && block.t === "p");
    assert.equal(body?.src, 3);
    const archive = unzipSync(epubArchive({ ...folio, cover: btoa("cover-bytes") }, "sample.pdf"));
    assert.ok(archive["OEBPS/cover.jpg"]);
    const opf = new TextDecoder().decode(archive["OEBPS/content.opf"]);
    assert.match(opf, /properties="cover-image"/);
    assert.match(opf, /idref="cover"/);
  });

  it("builds the contents from a printed contents page when the file has no outline", () => {
    const g = globalThis as { URL?: { createObjectURL?: (b: Blob) => string } };
    g.URL = g.URL || {};
    g.URL.createObjectURL = () => "blob:folio-test";
    const lines: Line[] = [
      line("i", 1, 20),
      line("A preface sentence stays here.", 1, 400),
      line("ii", 2, 20),
      line("Contents", 2, 700),
      line("The Twin Verses .......... 1", 2, 640),
      line("On Earnestness .......... 2", 2, 610),
      line("Thought .......... 3", 2, 580),
      line("1", 3, 20),
      line("Body of the twin verses stays.", 3, 400),
      line("2", 4, 20),
      line("Body of earnestness stays.", 4, 400),
      line("3", 5, 20),
      line("Body of thought stays.", 5, 400),
    ];
    const folio = assembleFolio(lines, { title: "Sample", subtitle: "", sourceName: "sample.pdf", emptyMessage: "empty" });
    assert.deepEqual(
      folio.toc.map((item) => item.label),
      ["Contents", "Front matter", "The Twin Verses", "On Earnestness", "Thought"],
    );
    assert.equal(folio.toc[2]?.page, 1);
    assert.equal(folio.toc[4]?.page, 3);
    const contents = folio.chapters[0];
    assert.equal(contents.blocks[0]?.s, "Contents");
    const linked = contents.blocks.filter((block) => block.t === "toc-entry");
    assert.deepEqual(
      linked.map((block) => block.s),
      ["Front matter", "The Twin Verses", "On Earnestness", "Thought"],
    );
    assert.equal(linked[1]?.id, folio.chapters[2]?.id);
    const prose = folio.chapters
      .flatMap((chapter) => chapter.blocks)
      .flatMap((block) => block.runs || [])
      .filter((run) => typeof run === "string")
      .join(" ");
    assert.doesNotMatch(prose, /\.{4}/);
    const archive = unzipSync(epubArchive(folio, "sample.pdf"));
    const contentsHtml = new TextDecoder().decode(archive["OEBPS/text/contents.xhtml"]);
    assert.match(contentsHtml, /The Twin Verses/);
    assert.match(contentsHtml, new RegExp(`href="${linked[1]?.id}\\.xhtml#${linked[1]?.id}"`));
  });
});

describe("picture pages", () => {
  it("keeps a sane drawing scale", () => {
    assert.equal(pictureScale(612, 792), 1400 / 792);
    assert.equal(pictureScale(200, 200), 2);
  });

  it("puts a top-of-image line at the top of the page and a footer number in the footer band", () => {
    const top = linesFromBoxes([{ text: "Chapter", poly: [[10, 10], [80, 10], [80, 30], [10, 30]] }], 1, 600, 800, 1200, 1600);
    assert.ok(top[0].y > 700);
    const foot = linesFromBoxes([{ text: "14", poly: [[100, 1500], [160, 1500], [160, 1580], [100, 1580]] }], 1, 600, 800, 1200, 1600);
    assert.ok(foot[0].y < 36);
    assert.equal(foot[0].text, "14");
  });

  it("reads region boxes from a vision result", () => {
    const lines = linesFromRegion(
      { "<OCR_WITH_REGION>": { quad_boxes: [[0, 0, 20, 0, 20, 10, 0, 10]], labels: ["Hello"] } },
      2,
      100,
      200,
      100,
      200,
    );
    assert.equal(lines[0].text, "Hello");
    assert.equal(lines[0].page, 2);
    assert.ok(lines[0].y > 150);
  });
});

describe("desk settings", () => {
  it("defaults to empty pages and PP-OCR, and ignores a broken value", () => {
    assert.deepEqual(parseSettings(null), { pictures: "empty", kind: "pp" });
    assert.deepEqual(parseSettings("{"), { pictures: "empty", kind: "pp" });
    assert.deepEqual(parseSettings(JSON.stringify({ pictures: "off", kind: "vision", extra: 1 })), {
      pictures: "off",
      kind: "vision",
    });
    assert.deepEqual(parseSettings(JSON.stringify({ pictures: "always", kind: "nope" })), { pictures: "empty", kind: "pp" });
  });
});

describe("same translation", () => {
  const verse =
    "All that we are is the result of what we have thought. It is founded on our thoughts. If a man speaks or acts with a pure thought, happiness follows him, like a shadow that never leaves him. He abused me, he beat me, he defeated me, he robbed me. In those who harbour such thoughts hatred will never cease.";

  it("scores a book against the same wording and names a missing passage", () => {
    const dropped = verse.replace("happiness follows him, like a shadow that never leaves him. ", "");
    const report = checkSameText(dropped, verse);
    assert.match(report.lines[0], /of that text is in this EPUB/);
    assert.match(report.lines[0], /of this EPUB is not in that text/);
    assert.ok(report.lines.some((line) => line.includes("happiness follows him")));
  });

  it("says so when the wording is a different text", () => {
    const other = Array.from({ length: 12 }, (_, n) => `Nothing in common with the reference passage number ${n} on this other page of words.`).join(" ");
    const report = checkSameText(other, verse + " " + verse);
    assert.match(report.lines[0], /does not look like the same translation/);
  });

  it("reads an EPUB and ignores a Project Gutenberg wrapper", () => {
    const wrapped = `*** START OF THE PROJECT GUTENBERG EBOOK ***\n${verse}\n*** END OF THE PROJECT GUTENBERG EBOOK ***\nlicense words that are not the book`;
    const epub = zipSync({
      "OEBPS/text/c01.xhtml": strToU8(`<html><body><p>${verse}</p></body></html>`),
      "OEBPS/nav.xhtml": strToU8("<html><body><nav>Contents only</nav></body></html>"),
    });
    const fromEpub = textFromReference("same.epub", epub);
    const report = checkSameText(fromEpub, wrapped);
    assert.match(report.lines[0], /^100% of that text is in this EPUB\. 0% of this EPUB is not in that text\./);
  });

  it("takes the reading text from a folio, not the contents lines", () => {
    const text = folioText({
      title: "T",
      subtitle: "",
      author: "",
      stats: { hyphensRejoined: 0, headersRemoved: 0, chapters: 1 },
      toc: [],
      chapters: [
        {
          id: "c01",
          title: "One",
          page: 1,
          blocks: [
            { t: "toc-entry", n: 1, s: "Do not count this contents line as the book", page: 1 },
            { t: "p", page: 1, runs: [verse] },
          ],
        },
      ],
    });
    assert.equal(text.includes("contents line"), false);
    assert.equal(text.includes("happiness follows him"), true);
  });
});

describe("shelf", () => {
  const empty: ShelfState = { hidden: [], opened: [] };

  it("lists the sample editions until one is hidden", () => {
    assert.equal(listShelf(empty).some((item) => item.sampleId === "republic"), true);
    const hidden = hideSample(empty, "republic");
    assert.equal(listShelf(hidden).some((item) => item.sampleId === "republic"), false);
    assert.equal(listShelf(hidden).length, listShelf(empty).length - 1);
  });

  it("keeps an opened title and can take it off without touching the samples", () => {
    const withBook = rememberOpened(empty, { id: "A\nB", title: "A", author: "B", kind: "opened", originName: "a.pdf" });
    assert.equal(listShelf(withBook)[0]?.title, "A");
    const gone = withoutOpened(withBook, "A\nB");
    assert.equal(listShelf(gone).some((item) => item.title === "A"), false);
    assert.equal(listShelf(gone).length, listShelf(empty).length);
  });

  it("keeps only a handful on the shelf and files the rest by work and edition", () => {
    let state: ShelfState = { hidden: [], opened: [] };
    for (let n = 1; n <= SHELF_LIMIT + 1; n++) {
      state = rememberOpened(state, { id: `id-${n}`, title: `Title ${n}`, author: "A", kind: "opened" });
    }
    assert.equal(listShelf(state).length, SHELF_LIMIT);
    assert.equal(listShelf(state).some((item) => item.id === "id-1"), false);
    assert.equal(listHoldings(state).some((item) => item.id === "id-1"), true);
    const first = catalogFromOpened({ title: "The Republic, Volume I", author: "Plato", filename: "rep-1.pdf" });
    const second = catalogFromOpened({ title: "The Republic, Volume II", author: "Plato", subtitle: "translated by Benjamin Jowett", filename: "rep-2.pdf" });
    assert.equal(first.work, "The Republic");
    assert.equal(first.volume, "Volume I");
    assert.equal(second.contributor, "Benjamin Jowett");
    assert.equal(second.work, first.work);
    const entry = { id: "1", title: first.title, author: "Plato", kind: "opened" as const };
    const stored = storeRecord({ hidden: [], opened: [entry] }, entry, { ...first, title: "Republic, vol. I" });
    assert.equal(recordFor(stored, entry).title, "Republic, vol. I");
    const ordered = sortRecords(
      [
        { entry, record: second },
        { entry, record: first },
      ],
      "title",
      "asc",
    );
    assert.equal(ordered[0]?.record.volume, "Volume I");
  });
});

