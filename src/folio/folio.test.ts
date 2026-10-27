import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectPrinted } from "./pages.ts";
import { mergeHyphen, repairText, type WordList } from "./repair.ts";
import { assembleFolio, epubArchive, type Line } from "./assemble.ts";
import { strToU8, unzipSync, zipSync } from "fflate";
import { linesFromBoxes, linesFromRegion, pictureScale } from "./picture.ts";
import { parseSettings } from "./settings.ts";
import { explainSaveFailure, formatBytes, OTHER_READER_BYTES, PICTURE_READER_BYTES, type StorageReport } from "./storage.ts";
import { looksScrappy, needsPicture, scriptIn } from "./script.ts";
import { checkSameText, folioText, textFromReference } from "./check.ts";
import { mergeScriptLines, readablePicture, untwinLine } from "./cases.ts";
import { dismissEntry, hideSample, listHoldings, listShelf, rememberOpened, splitStored, withoutOpened, SHELF_LIMIT, SAMPLES, type ShelfState } from "./shelf.ts";
import { bookKey } from "./revise.ts";
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
    const said: string[] = [];
    const folio = assembleFolio(lines, {
      title: "Sample",
      subtitle: "",
      sourceName: "sample.pdf",
      emptyMessage: "empty",
      onStatus: (status) => said.push(status),
    });
    assert.deepEqual(
      folio.toc.map((item) => item.label),
      ["Contents", "Front matter", "The Twin Verses", "On Earnestness", "Thought"],
    );
    assert.equal(folio.toc[2]?.page, 1);
    assert.equal(folio.toc[4]?.page, 3);
    assert.ok(said.some((status) => status === "Contents from the titles and page numbers, 3 chapters"));
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

  it("reads a two-column page down each column", () => {
    const g = globalThis as { URL?: { createObjectURL?: (b: Blob) => string } };
    g.URL = g.URL || {};
    g.URL.createObjectURL = () => "blob:folio-test";
    const lines: Line[] = [line("Both columns", 1, 740, { x0: 48, x1: 540, h: 18 })];
    for (let n = 0; n < 6; n++) {
      lines.push(line(`Left sentence ${n} stays in the left column.`, 1, 680 - n * 28, { x0: 48, x1: 250 }));
      lines.push(line(`Right sentence ${n} stays in the right column.`, 1, 680 - n * 28, { x0: 330, x1: 540 }));
    }
    const folio = assembleFolio(lines, { title: "Columns", subtitle: "", sourceName: "columns.pdf", emptyMessage: "empty" });
    const text = folio.chapters
      .flatMap((chapter) => chapter.blocks)
      .flatMap((block) => block.runs || [])
      .filter((run) => typeof run === "string")
      .join(" ");
    assert.ok(text.indexOf("Left sentence 0") < text.indexOf("Left sentence 5"));
    assert.ok(text.indexOf("Left sentence 5") < text.indexOf("Right sentence 0"));
    assert.match(folio.warning || "", /column/);
  });

  it("keeps aligned rows as a table and sets a footnote apart", () => {
    const g = globalThis as { URL?: { createObjectURL?: (b: Blob) => string } };
    g.URL = g.URL || {};
    g.URL.createObjectURL = () => "blob:folio-test";
    const cells = (texts: string[], y: number, h = 12): Line => ({
      text: texts.join(" "),
      y,
      x0: 72,
      x1: 460,
      h,
      page: 1,
      pageH: 792,
      pageW: 612,
      cells: texts.map((text, index) => ({ text, x0: 72 + index * 140, x1: 150 + index * 140 })),
    });
    const lines: Line[] = [
      line("A body sentence stays above the table.", 1, 640),
      cells(["Year", "Count", "Place"], 560),
      cells(["1902", "12", "London"], 540),
      cells(["1906", "9", "Paris"], 520),
      { ...line("1 The note stays under the table.", 1, 80, { h: 8, x0: 72, x1: 400 }), role: undefined },
    ];
    lines[lines.length - 1].h = 8;
    lines[lines.length - 1].y = 80;
    const folio = assembleFolio(lines, { title: "Table", subtitle: "", sourceName: "table.pdf", emptyMessage: "empty" });
    const table = folio.chapters.flatMap((chapter) => chapter.blocks).find((block) => block.t === "table");
    assert.deepEqual(table?.headers, ["Year", "Count", "Place"]);
    assert.deepEqual(table?.rows, [
      ["1902", "12", "London"],
      ["1906", "9", "Paris"],
    ]);
    const note = folio.chapters.flatMap((chapter) => chapter.blocks).find((block) => block.kind === "note");
    assert.match(note?.runs?.join(" ") || "", /note stays under/);
    const archive = unzipSync(epubArchive(folio, "table.pdf"));
    const html = new TextDecoder().decode(archive["OEBPS/text/c01.xhtml"]);
    assert.match(html, /<table>/);
    assert.match(html, /class="note"/);
  });

  it("reads a contents list that has no dot leaders", () => {
    const g = globalThis as { URL?: { createObjectURL?: (b: Blob) => string } };
    g.URL = g.URL || {};
    g.URL.createObjectURL = () => "blob:folio-test";
    const entry = (title: string, token: string, y: number): Line => ({
      text: `${title} ${token}`,
      y,
      x0: 72,
      x1: 400,
      h: 12,
      page: 2,
      pageH: 792,
      pageW: 612,
      cells: [
        { text: title, x0: 72, x1: 280 },
        { text: token, x0: 360, x1: 400 },
      ],
    });
    const lines: Line[] = [
      line("i", 1, 20),
      line("A preface sentence stays here.", 1, 400),
      line("ii", 2, 20),
      line("Contents", 2, 700),
      entry("The Twin Verses", "1", 640),
      entry("On Earnestness", "2", 610),
      entry("Thought", "3", 580),
      entry("Flowers", "4", 550),
      line("1", 3, 20),
      line("Body of the twin verses stays.", 3, 400),
      line("2", 4, 20),
      line("Body of earnestness stays.", 4, 400),
      line("3", 5, 20),
      line("Body of thought stays.", 5, 400),
      line("4", 6, 20),
      line("Body of flowers stays.", 6, 400),
    ];
    const folio = assembleFolio(lines, { title: "Sample", subtitle: "", sourceName: "plain.pdf", emptyMessage: "empty" });
    assert.deepEqual(
      folio.toc.map((item) => item.label),
      ["Contents", "Front matter", "The Twin Verses", "On Earnestness", "Thought", "Flowers"],
    );
    assert.equal(folio.chapters.flatMap((chapter) => chapter.blocks).some((block) => block.t === "table"), false);
  });

  it("splits an indented paragraph from the one before it", () => {
    const g = globalThis as { URL?: { createObjectURL?: (b: Blob) => string } };
    g.URL = g.URL || {};
    g.URL.createObjectURL = () => "blob:folio-test";
    const lines: Line[] = [
      line("First sentence of the opening paragraph stays together here", 1, 700, { x0: 72, x1: 520 }),
      line("and the second line of it stays with the first.", 1, 684, { x0: 72, x1: 360 }),
      line("Second paragraph starts indented and stays apart.", 1, 668, { x0: 92, x1: 480 }),
    ];
    const folio = assembleFolio(lines, { title: "Paragraphs", subtitle: "", sourceName: "p.pdf", emptyMessage: "empty" });
    const paras = folio.chapters.flatMap((chapter) => chapter.blocks).filter((block) => block.t === "p");
    assert.equal(paras.length, 2);
    assert.match(String(paras[0].runs?.join(" ")), /stays with the first/);
    assert.match(String(paras[1].runs?.join(" ")), /starts indented/);
  });

  it("removes a second copy of the text and leaves a single refrain", () => {
    const g = globalThis as { URL?: { createObjectURL?: (b: Blob) => string } };
    g.URL = g.URL || {};
    g.URL.createObjectURL = () => "blob:folio-test";
    const lines: Line[] = [];
    for (let n = 0; n < 6; n++) {
      const text = `Sentence number ${n} stays once on the page.`;
      lines.push(line(text, 1, 640 - n * 36));
      lines.push(line(text, 1, 640 - n * 36 - 2));
      lines[lines.length - 1].text = text.replace(/Sentence/, "S e n t e n c e");
    }
    const folio = assembleFolio(lines, { title: "Twins", subtitle: "", sourceName: "twins.pdf", emptyMessage: "empty" });
    const text = folio.chapters
      .flatMap((chapter) => chapter.blocks)
      .flatMap((block) => block.runs || [])
      .filter((run) => typeof run === "string")
      .join("\n");
    assert.equal(text.match(/stays once on the page/g)?.length, 6);
    assert.match(folio.warning || "", /second copy/);
    assert.equal(
      untwinLine("The participants should carry this out. The participants should carry this out."),
      "The participants should carry this out.",
    );
    const refrain: Line[] = [
      line("Never again.", 2, 700),
      line("Never again.", 2, 684),
      line("The rest of this page is ordinary prose and is not doubled at all.", 2, 668),
      line("Another ordinary sentence follows it without a twin anywhere.", 2, 652),
      line("A third ordinary sentence keeps the page from looking twinned.", 2, 636),
    ];
    const kept = assembleFolio(refrain, { title: "Refrain", subtitle: "", sourceName: "refrain.pdf", emptyMessage: "empty" });
    const again = kept.chapters
      .flatMap((chapter) => chapter.blocks)
      .flatMap((block) => block.runs || [])
      .filter((run) => typeof run === "string")
      .join(" ");
    assert.equal(again.match(/Never again/g)?.length, 2);
  });

  it("builds a linked contents from titles that begin again later", () => {
    const g = globalThis as { URL?: { createObjectURL?: (b: Blob) => string } };
    g.URL = g.URL || {};
    g.URL.createObjectURL = () => "blob:folio-test";
    const titles = ["Introduction", "Sealing Prayer", "Prayer of Command", "Binding Prayers", "Purification Prayer"];
    const lines: Line[] = [line("A preface sentence stays here.", 1, 400)];
    titles.forEach((title, index) => lines.push(line(title, 2, 700 - index * 28)));
    titles.forEach((title, index) => {
      const page = 3 + index;
      lines.push(line(String(page), page, 20));
      lines.push(line(title, page, 640));
      lines.push(line(`The words of ${title.toLowerCase()} stay in the chapter.`, page, 600));
    });
    const folio = assembleFolio(lines, { title: "Prayers", subtitle: "", sourceName: "prayers.pdf", emptyMessage: "empty" });
    assert.deepEqual(
      folio.toc.map((item) => item.label),
      ["Contents", "Front matter", ...titles],
    );
    const contents = folio.chapters[0].blocks.filter((block) => block.t === "toc-entry").map((block) => block.s);
    assert.deepEqual(contents, ["Front matter", ...titles]);
    const prose = folio.chapters
      .flatMap((chapter) => chapter.blocks)
      .filter((block) => block.t === "p")
      .flatMap((block) => block.runs || [])
      .join(" ");
    assert.doesNotMatch(prose, /^Introduction$/m);
    assert.match(prose, /words of sealing prayer/);
  });

  it("ignores a broken contents list and uses the chapter headings", () => {
    const g = globalThis as { URL?: { createObjectURL?: (b: Blob) => string } };
    g.URL = g.URL || {};
    g.URL.createObjectURL = () => "blob:folio-test";
    const words = new Set("chapter one the psychology of aristotle introduction definition soul among creatures".split(" "));
    const lines: Line[] = [
      line("TABLE OF CONTENTS", 2, 720),
      line("lil brant ites Vegerarion sts 10", 2, 680),
      line("Var Lhe Outer Senses junk 13", 2, 650),
      line("KmASSIONanideA CONS 21", 2, 620),
    ];
    for (let n = 3; n <= 8; n++) lines.push(line("A preface sentence stays in front.", n, 400));
    lines.push(line("CHAPTER ONE", 9, 640, { h: 11 }));
    lines.push(line("THE PSYCHOLOGY OF ARISTOTLE", 9, 590, { h: 12 }));
    lines.push(line("Introduction", 9, 530, { h: 12 }));
    lines.push(line("The soul is the first actuality of a living body.", 9, 500));
    lines.push(line("It remains the form of the body.", 9, 484));
    lines.push(line("The Aristotelian Meaning of Soul", 9, 450, { x0: 70, x1: 262, pageW: 332 }));
    lines.push(line("A. DEFINITION OF SOUL", 9, 430, { h: 9 }));
    lines.push(line("Among the creatures of the cosmic universe, we discern three kinds.", 9, 400));
    lines.push(line("Plant life reveals itself in acts of nutrition.", 9, 384));
    const folio = assembleFolio(lines, {
      title: "Thomistic Psychology",
      subtitle: "",
      sourceName: "brennan.pdf",
      emptyMessage: "empty",
      lexicon: { has: (word) => words.has(word) },
    });
    const labels = folio.toc.map((item) => item.label);
    assert.equal(labels.includes("lil brant ites Vegerarion sts"), false);
    assert.ok(labels.some((label) => /psychology of aristotle/i.test(label)));
    const sections = folio.toc.flatMap((item) => item.children.map((child) => child.label));
    assert.ok(sections.includes("Introduction"));
    assert.ok(sections.some((label) => /aristotelian meaning of soul/i.test(label)));
    assert.ok(sections.some((label) => /definition of soul/i.test(label)));
  });

  it("joins a wrapped chapter title and does not promote a title-page byline", () => {
    const g = globalThis as { URL?: { createObjectURL?: (b: Blob) => string } };
    g.URL = g.URL || {};
    g.URL.createObjectURL = () => "blob:folio-test";
    const page = { pageW: 600, pageH: 800 };
    const lines: Line[] = [
      line("Given by", 1, 760, { h: 16, x0: 220, x1: 380, ...page }),
      ...Array.from({ length: 8 }, (_, n) => line(`A body sentence stays on the page ${n}.`, 1, 740 - n * 4, { h: 11, x0: 48, x1: 540, ...page })),
      line("CHAPTER 7", 1, 700, { h: 22, x0: 230, x1: 370, ...page }),
      line("SUBTLE BODY,", 1, 668, { h: 22, x0: 160, x1: 440, ...page }),
      line("DENSE MIND:", 1, 636, { h: 22, x0: 190, x1: 410, ...page }),
      line("PAST LIVES", 1, 604, { h: 22, x0: 210, x1: 390, ...page }),
      line("AND PHYSICAL ILLS", 1, 572, { h: 22, x0: 150, x1: 450, ...page }),
      line("A body sentence stays under the title.", 1, 500, { h: 11, x0: 48, x1: 540, ...page }),
      line("The Case of Susan: A Dutch Artist's", 1, 430, { h: 14, x0: 48, x1: 420, ...page }),
      line("Residual Guilt", 1, 412, { h: 14, x0: 48, x1: 180, ...page }),
      line("The session stayed in the chapter.", 1, 370, { h: 11, x0: 48, x1: 540, ...page }),
      line("Another sentence keeps the body size.", 1, 352, { h: 11, x0: 48, x1: 520, ...page }),
    ];
    const folio = assembleFolio(lines, { title: "Sample", subtitle: "", sourceName: "wrapped.pdf", emptyMessage: "empty" });
    const labels = folio.toc.map((item) => item.label);
    assert.equal(labels.includes("Given by"), false);
    assert.ok(labels.some((label) => label === "Chapter 7. Subtle Body, Dense Mind: Past Lives and Physical Ills"));
    const sections = folio.toc.flatMap((item) => item.children.map((child) => child.label));
    assert.ok(sections.includes("The Case of Susan: A Dutch Artist's Residual Guilt"));
    assert.equal(sections.includes("Residual Guilt"), false);
  });

  it("builds the linked contents from a later list of titles and page numbers", () => {
    const g = globalThis as { URL?: { createObjectURL?: (b: Blob) => string } };
    g.URL = g.URL || {};
    g.URL.createObjectURL = () => "blob:folio-test";
    const titles = [
      ["Sealing Prayer", "3"],
      ["Prayer of Command", "4"],
      ["Binding Prayers", "5"],
      ["Purification Prayer", "6"],
    ] as const;
    const lines: Line[] = [line("A preface sentence stays here.", 1, 400)];
    for (const [title, token] of titles) {
      const page = Number(token);
      lines.push(line(String(page), page, 20));
      lines.push(line(`The words of ${title.toLowerCase()} stay in the chapter.`, page, 500));
    }
    titles.forEach(([title, token], index) => {
      lines.push(line(`${title} ${token} ${title} ${token}`, 8, 700 - index * 24));
    });
    const folio = assembleFolio(lines, { title: "Prayers", subtitle: "", sourceName: "indexed.pdf", emptyMessage: "empty" });
    assert.deepEqual(
      folio.toc.map((item) => item.label),
      ["Contents", "Front matter", ...titles.map(([title]) => title)],
    );
    const prose = folio.chapters
      .flatMap((chapter) => chapter.blocks)
      .filter((block) => block.t === "p")
      .flatMap((block) => block.runs || [])
      .join(" ");
    assert.match(prose, /words of sealing prayer/);
    assert.doesNotMatch(prose, /Sealing Prayer 3 Sealing Prayer 3/);
  });
});

describe("picture pages", () => {
  it("drops a cover that did not read as words", () => {
    assert.equal(readablePicture([line("{:“ Approach", 1, 400), line("Bower", 1, 360)]), false);
    const page = Array.from({ length: 12 }, (_, n) => line(`A real sentence number ${n} stays on the page.`, 1, 700 - n * 16));
    assert.equal(readablePicture(page), true);
    const sanskrit = Array.from({ length: 4 }, (_, n) => line("धर्मपदः यमकवग्गो मनोपुब्बङ्गमा धम्मा", 1, 700 - n * 16));
    assert.equal(readablePicture(sanskrit), true);
    const english = line("The mind is the forerunner of all things.", 1, 500);
    const devanagari = line("मनोपुब्बङ्गमा धम्मा", 1, 460, { y: 460 });
    const merged = mergeScriptLines([english], [devanagari], "devanagari");
    assert.deepEqual(merged.map((item) => item.text), [english.text, devanagari.text]);
    assert.equal(needsPicture("धर्मपदः " + "अ".repeat(30)), false);
    assert.equal(needsPicture("the mind is the forerunner of all things"), false);
    assert.equal(needsPicture("x7 ## q q q !! 1l 1l"), true);
  });

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
    assert.deepEqual(parseSettings(null).scripts, ["en"]);
    assert.deepEqual(parseSettings("{").scripts, ["en"]);
    assert.deepEqual(parseSettings(JSON.stringify({ scripts: [] })).scripts, ["en"]);
    assert.deepEqual(
      parseSettings(JSON.stringify({ scripts: ["latin", "devanagari", "arabic", "cyrillic", "greek", "korean", "thai", "tamil", "telugu"], readers: 2 })).scripts,
      ["en"],
    );
    assert.deepEqual(parseSettings(JSON.stringify({ scripts: ["devanagari"], readers: 2 })).scripts, ["en", "devanagari"]);
    assert.deepEqual(parseSettings(JSON.stringify({ scripts: [], readers: 3 })).scripts, ["en"]);
    assert.deepEqual(parseSettings(JSON.stringify({ scripts: [], readers: 4 })).scripts, []);
    assert.deepEqual(parseSettings(JSON.stringify({ scripts: ["latin"], readers: 4 })).scripts, ["latin"]);
    assert.deepEqual(parseSettings(JSON.stringify({ pictures: "off", kind: "vision", keepFile: true, scripts: ["devanagari", "nope", "devanagari"], extra: 1 })).scripts, [
      "en",
      "devanagari",
    ]);
    assert.equal(formatBytes(1536), "1.5 KB");
    assert.ok(PICTURE_READER_BYTES < 25 * 1024 * 1024);
    assert.ok(OTHER_READER_BYTES > 60 * 1024 * 1024);
    assert.equal(scriptIn("The cloud of unknowing is English prose."), "en");
    assert.equal(scriptIn("धर्मपदः " + "अ".repeat(30)), "devanagari");
    assert.equal(scriptIn("Здравствуйте ".repeat(8)), "cyrillic");
    assert.equal(looksScrappy("the mind is the forerunner of all things"), false);
    assert.equal(looksScrappy("x7 ## q q q !! 1l 1l"), true);
    const room: StorageReport = { usage: 20 * 1024 * 1024, quota: 2 * 1024 * 1024 * 1024, persisted: false, lines: [] };
    const full: StorageReport = { usage: 1900 * 1024 * 1024, quota: 2 * 1024 * 1024 * 1024, persisted: false, lines: [] };
    assert.match(explainSaveFailure("QuotaExceededError", room, true), /Storage is not full/);
    assert.match(explainSaveFailure("QuotaExceededError", full, false), /could not be kept/);
    assert.doesNotMatch(explainSaveFailure("QuotaExceededError", full, false), /not full/);
    assert.deepEqual(parseSettings(JSON.stringify({ pictures: "always", kind: "nope" })), {
      pictures: "empty",
      kind: "pp",
      keepFile: false,
      scripts: ["en"],
    });
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
    const pinned = hideSample({ ...empty, recent: [bookKey(SAMPLES.find((item) => item.sampleId === "republic")!)] }, "republic");
    assert.equal(listShelf(pinned).some((item) => item.sampleId === "republic"), false);
    assert.equal(listShelf(hidden).length, listShelf(empty).length - 1);
  });

  it("keeps an opened title and can take it off without touching the samples", () => {
    const withBook = rememberOpened(empty, { id: "A\nB", title: "A", author: "B", kind: "opened", originName: "a.pdf" });
    assert.equal(listShelf(withBook)[0]?.title, "A");
    const gone = withoutOpened(withBook, "A\nB");
    assert.equal(listShelf(gone).some((item) => item.title === "A"), false);
    assert.equal(listShelf(gone).length, listShelf(empty).length);
    const removed = dismissEntry(withBook, withBook.opened[0]);
    assert.equal(listHoldings(removed).some((item) => item.title === "A"), false);
    const republic = SAMPLES.find((item) => item.sampleId === "republic");
    assert.equal(republic && listShelf(dismissEntry(empty, republic)).some((item) => item.sampleId === "republic"), false);
  });

  it("keeps only a handful on the shelf and files the rest by work and edition", () => {
    let state: ShelfState = { hidden: [], opened: [] };
    for (let n = 1; n <= SHELF_LIMIT + 1; n++) {
      state = rememberOpened(state, { id: `id-${n}`, title: `Title ${n}`, author: "A", kind: "opened" });
    }
    assert.equal(listShelf(state).length, SHELF_LIMIT);
    assert.equal(listShelf(state)[0]?.id, `id-${SHELF_LIMIT + 1}`);
    assert.equal(listShelf(state).some((item) => item.id === "id-1"), false);
    const buried = {
      hidden: [] as ShelfState["hidden"],
      opened: [{ id: "New\n", title: "New", author: "", kind: "opened" as const }],
      recent: SAMPLES.map((item) => bookKey(item)),
    };
    assert.equal(listShelf(buried)[0]?.title, "New");
    assert.equal(splitStored("abcdef", 2).join(""), "abcdef");
    assert.equal(splitStored("abcdef", 4).length, 2);
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

