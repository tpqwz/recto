import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectPrinted } from "./pages.ts";
import { headingStep, mergeHyphen, repairHeading, repairText, type WordList } from "./repair.ts";
import { assembleFolio, cluster, contentsEntry, epubArchive, runText, type Line } from "./assemble.ts";
import { paintLinks, safeHref } from "./links.ts";
import { contentPlates, imagesInPdf, type ImageUse, type PdfImage } from "./plates.ts";
import { strToU8, unzipSync, zipSync, zlibSync } from "fflate";
import { linesFromBoxes, linesFromRegion, pictureScale } from "./picture.ts";
import { parseSettings } from "./settings.ts";
import { explainSaveFailure, formatBytes, OTHER_READER_BYTES, PICTURE_READER_BYTES, type StorageReport } from "./storage.ts";
import { looksDoubtful, looksMangled, looksScrappy, needsPicture, pageNeedsPicture, scriptIn } from "./script.ts";
import { applyPageReading, correctPageWords, keepDoubtPage } from "./review.ts";
import { checkSameText, folioText, textFromReference } from "./check.ts";
import { keepPageLanguage, mergeScriptLines, pageLooksMixed, readablePicture, untwinLine } from "./cases.ts";
import { PRESS, pressUrl } from "./press.ts";
import { dismissEntry, hideSample, listHoldings, listShelf, rememberOpened, splitStored, withoutOpened, SHELF_LIMIT, SAMPLES, type ShelfState } from "./shelf.ts";
import { bookKey } from "./revise.ts";
import { catalogFromOpened, recordFor, sortRecords, storeRecord } from "./library.ts";

const list: WordList = {
  has: (word) =>
    new Set(
      "conscious self of the group mind sex synchronously realize realise civilisation civilization bailey often into shall other average aver age trac dour our inculcating eating cul transiting sitting tran gras pall mean well".split(
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

  it("reads a folio number set between dashes", () => {
    const lines: Line[] = [];
    for (let n = 1; n <= 6; n++) {
      lines.push(line("THE B-3 THERAPY", n + 1, 760));
      lines.push(line(`- ${n} -`, n + 1, 24));
      lines.push(line("Body text of this page stays.", n + 1, 400));
    }
    const pages = detectPrinted(lines);
    assert.equal(pages.label(1), null);
    assert.equal(pages.label(2), 1);
    assert.equal(pages.label(7), 6);
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

  it("keeps the page number when it moves from the footer to the header", () => {
    const lines: Line[] = [];
    for (let n = 1; n <= 6; n++) {
      lines.push(line(String(n + 10), n, 20));
      lines.push(line("Body text of this page stays.", n, 400));
    }
    for (let n = 7; n <= 12; n++) {
      lines.push(line(`${n + 12} ORIGIN OF SPECIES`, n, 760));
      lines.push(line("Body text of this page stays and continues.", n, 400));
    }
    const pages = detectPrinted(lines);
    assert.equal(pages.label(1), 11);
    assert.equal(pages.label(6), 16);
    assert.equal(pages.label(7), 19);
    assert.equal(pages.label(12), 24);
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
    assert.equal(mergeHyphen("super-", "eminet tecto", list, hyphens), null);
    assert.equal(hyphens.n, 1);
  });

  it("repairs an English line and leaves a Latin line", () => {
    const lexicon = {
      has: (word: string) => word === "nature" || "kindly temper follows home today".split(" ").includes(word) || list.has(word),
    };
    const folio = assembleFolio(
      [
        line("atque hinc illa fert natvre pharetram humero gradiens super-", 2, 640),
        line("eminet tecto sub radiis caput altis longe.", 2, 620),
        line("From the natvre of the mind a kindly temper follows him home.", 3, 640),
        line("From the riv-", 4, 640),
        line("erside a kindly temper follows him home today.", 4, 620),
      ],
      { title: "Two tongues", subtitle: "", sourceName: "t.pdf", emptyMessage: "empty", lexicon, skipEpub: true },
    );
    const prose = folio.chapters.flatMap((chapter) => chapter.blocks).flatMap((block) => block.runs || []).filter((run) => typeof run === "string").join("\n");
    assert.match(prose, /fert natvre pharetram/);
    assert.equal(prose.includes("supereminet"), false);
    assert.match(prose, /super-/);
    assert.match(prose, /nature of the mind/);
    assert.equal(prose.includes("natvre of the mind"), false);
    assert.match(prose, /riverside/);
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
    assert.equal(repairText("the groupmind grew", list), "the group mind grew");
  });

  it("does not split a capitalized name into two words", () => {
    assert.equal(repairText("Farmer Graspall met Meanwell", list), "Farmer Graspall met Meanwell");
    assert.equal(repairText("graspall is not a name here", list), "gras pall is not a name here");
  });

  it("does not correct a kept name or a British spelling", () => {
    assert.equal(repairText("Wesak and antahkarana", list), "Wesak and antahkarana");
    assert.equal(repairText("realise civilisation", list), "realise civilisation");
    assert.equal(repairText("colourise the group", list), "colourise the group");
  });

  it("repairs a heading and will not step a good word backwards", () => {
    const heads: WordList = {
      has: (word) => "tears sends and party pool tale".split(" ").includes(word) || list.has(word),
    };
    assert.equal(repairHeading("THE POOL OF TEAES", heads), "THE POOL OF TEARS");
    assert.equal(repairHeading("THE RABBIT SEXDS IN A LITTLE BILL", heads), "THE RABBIT SEXDS IN A LITTLE BILL".replace("SEXDS", "SENDS"));
    assert.equal(repairHeading("A MAD TEA-PARTV", heads), "A MAD TEA-PARTY");
    assert.equal(repairHeading("A CAUCUS-RACE AXD A LONG TALE", heads), "A CAUCUS-RACE AND A LONG TALE");
    assert.equal(repairHeading("THE POOL OF TEAKS", { has: (word) => word === "teaks" || heads.has(word) }), "THE POOL OF TEAKS");
    assert.equal(headingStep("teaks", "tears"), true);
    assert.equal(headingStep("tears", "teaks"), false);
    assert.equal(headingStep("rig", "pig"), true);
    assert.equal(headingStep("mad", "mau"), false);
    assert.equal(headingStep("croquet", "choquet"), false);
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

  it("reads a numbered contents list that uses a dot, and skips a picture credit", () => {
    const lines: Line[] = [
      line("i", 1, 20),
      line("A preface sentence stays here.", 1, 400),
      line("ii", 2, 20),
      line("Contents", 2, 740),
      line("Preface iii", 2, 700),
      line("1 Comparative Timeline (B C E) xvi", 2, 680),
      line("1 . Orientation 1", 2, 640),
      line("david ibbetson", 2, 620),
      line("2 . Law as Text 2", 2, 600),
      line("12 . Conclusion 12", 2, 400),
      line("Bibliography 13", 2, 360),
      line("Index 14", 2, 340),
      line("and noted calligrapher (© Pictures from History / Bridgeman Images). 6", 2, 200),
      line("iii", 3, 20),
      line("The preface stays.", 3, 400),
    ];
    for (let n = 1; n <= 14; n++) {
      const file = 3 + n;
      lines.push(line(String(n), file, 20));
      lines.push(line(`The body of page ${n} stays.`, file, 400));
    }
    for (let n = 3; n <= 11; n++) lines.push(line(`${n} . Chapter Title ${n}`, 2, 580 - n * 12));
    const folio = assembleFolio(lines, {
      title: "Cambridge",
      subtitle: "",
      sourceName: "cambridge.pdf",
      emptyMessage: "empty",
      lexicon: { has: (word) => word === "bibliography" || word === "index" },
    });
    const labels = folio.toc.map((item) => item.label);
    assert.equal(labels[0], "Contents");
    assert.ok(labels.includes("Preface"));
    assert.ok(labels.includes("1 · Orientation"));
    assert.ok(labels.includes("2 · Law as Text"));
    assert.ok(labels.includes("12 · Conclusion"));
    assert.ok(labels.includes("Bibliography"));
    assert.ok(labels.includes("Index"));
    assert.equal(labels.includes("david ibbetson"), false);
    assert.equal(labels.some((label) => /calligrapher|Bridgeman/.test(label)), false);
    const shown = folio.chapters[0].blocks.filter((block) => block.t === "toc-entry").map((block) => block.s);
    assert.ok(shown.includes("1 · Orientation"));
    assert.equal(shown.some((label) => label?.startsWith("1. ")), false);
  });

  it("keeps a hundred contents entries, including a proper name", () => {
    const g = globalThis as { URL?: { createObjectURL?: (b: Blob) => string } };
    g.URL = g.URL || {};
    g.URL.createObjectURL = () => "blob:folio-test";
    const words = new Set("the loan history chapter".split(" "));
    const lines: Line[] = [line("i", 1, 20), line("A preface sentence stays here.", 1, 400), line("Contents", 2, 760)];
    for (let n = 1; n <= 100; n++) {
      const title = n === 40 ? "The Rothschild Loan" : `History Chapter ${n}`;
      const file = 2 + Math.floor((n - 1) / 25);
      lines.push(line(`${title} .......... ${n}`, file, 730 - ((n - 1) % 25) * 22));
      const body = 10 + n;
      lines.push(line(String(n), body, 20));
      lines.push(line(`The body of chapter ${n} stays here.`, body, 400));
    }
    const folio = assembleFolio(lines, {
      title: "Long",
      subtitle: "",
      sourceName: "long.pdf",
      emptyMessage: "empty",
      skipEpub: true,
      lexicon: { has: (word) => words.has(word) },
    });
    const labels = folio.toc.map((item) => item.label);
    assert.equal(labels.includes("The Rothschild Loan"), true);
    assert.equal(labels.includes("History Chapter 100"), true);
    assert.equal(labels.filter((label) => label === "The Rothschild Loan" || /^History Chapter \d+$/.test(label)).length, 100);
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

  it("keeps a proper name and spaces a glued chapter number", () => {
    const g = globalThis as { URL?: { createObjectURL?: (b: Blob) => string } };
    g.URL = g.URL || {};
    g.URL.createObjectURL = () => "blob:folio-test";
    const words = new Set("the history of and".split(" "));
    const lines: Line[] = [line("Contents", 2, 760)];
    const titles = ["The History", "St. Bernardine of Siena", "Chapter2 Pagan Economics"];
    titles.forEach((title, index) => {
      const page = 3 + index;
      lines.push(line(`${title} .......... ${page}`, 2, 700 - index * 24));
      lines.push(line(String(page), page, 20));
      lines.push(line(`The body of entry ${index} stays here.`, page, 400));
    });
    const folio = assembleFolio(lines, {
      title: "Names",
      subtitle: "",
      sourceName: "names.pdf",
      emptyMessage: "empty",
      skipEpub: true,
      lexicon: { has: (word) => words.has(word) },
    });
    const labels = folio.toc.map((item) => item.label);
    assert.equal(labels.includes("St. Bernardine of Siena"), true);
    assert.equal(labels.includes("Chapter 2 Pagan Economics"), true);
  });

  it("reads both columns of a contents line", () => {
    const g = globalThis as { URL?: { createObjectURL?: (b: Blob) => string } };
    g.URL = g.URL || {};
    g.URL.createObjectURL = () => "blob:folio-test";
    const left = ["The Medici Bank", "Moral Decay", "The Turning"];
    const right = ["Jakob the Rich", "The London Branch", "Bread and Circuses"];
    const lines: Line[] = [line("Contents", 2, 760)];
    left.forEach((title, index) => {
      const page = 3 + index;
      const later = 8 + index;
      lines.push(line(`${title} .......... ${page} ${right[index]} .......... ${later}`, 2, 700 - index * 24));
      lines.push(line(String(page), page, 20));
      lines.push(line(`The body of ${title.toLowerCase()} stays.`, page, 400));
      lines.push(line(String(later), later, 20));
      lines.push(line(`The body of ${right[index].toLowerCase()} stays.`, later, 400));
    });
    const folio = assembleFolio(lines, { title: "Columns", subtitle: "", sourceName: "toc-columns.pdf", emptyMessage: "empty", skipEpub: true });
    const labels = folio.toc.map((item) => item.label);
    assert.equal(labels.includes("Jakob the Rich"), true);
    assert.equal(labels.includes("The London Branch"), true);
    assert.equal(labels.includes("Bread and Circuses"), true);
    assert.equal(labels.includes("The Medici Bank"), true);
  });

  it("does not let a short contents list swallow later chapters", () => {
    const g = globalThis as { URL?: { createObjectURL?: (b: Blob) => string } };
    g.URL = g.URL || {};
    g.URL.createObjectURL = () => "blob:folio-test";
    const lines: Line[] = [line("Contents", 2, 760)];
    for (let n = 1; n <= 5; n++) {
      lines.push(line(`Chapter ${n} Early .......... ${n}`, 2, 720 - n * 22));
      const page = 10 + n;
      lines.push(line(String(n), page, 20));
      lines.push(line(`Chapter ${n}`, page, 700, { h: 18 }));
      lines.push(line(`The body of early chapter ${n} stays.`, page, 640));
    }
    for (let n = 6; n <= 20; n++) {
      const page = 10 + n;
      lines.push(line(String(n), page, 20));
      lines.push(line(`Chapter ${n} Later Title`, page, 700, { h: 18 }));
      lines.push(line(`The body of later chapter ${n} stays.`, page, 640));
    }
    const folio = assembleFolio(lines, { title: "Long", subtitle: "", sourceName: "gappy.pdf", emptyMessage: "empty", skipEpub: true });
    const labels = folio.toc.map((item) => item.label);
    assert.equal(labels.includes("Chapter 20 Later Title"), true);
    assert.equal(labels.includes("Chapter 6 Later Title"), true);
    const last = folio.chapters[folio.chapters.length - 1];
    assert.equal(last.title, "Chapter 20 Later Title");
    const prose = last.blocks
      .flatMap((block) => block.runs || [])
      .filter((run) => typeof run === "string")
      .join(" ");
    assert.match(prose, /later chapter 20/);
    assert.doesNotMatch(prose, /later chapter 6/);
  });

  it("keeps every numbered chapter when the columns are read across", () => {
    const g = globalThis as { URL?: { createObjectURL?: (b: Blob) => string } };
    g.URL = g.URL || {};
    g.URL.createObjectURL = () => "blob:folio-test";
    const lines: Line[] = [line("Contents", 2, 760)];
    for (let n = 1; n <= 40; n++) {
      const y = 740 - n * 14;
      const right = n + 40;
      const leftPage = 10 + n;
      const rightPage = 10 + right;
      lines.push(line(`Chapter ${n} - Early Title .......... ${leftPage}`, 2, y, { x0: 72, x1: 250 }));
      lines.push(line(`Chapter ${right} - Later Title .......... ${rightPage}`, 2, y, { x0: 120, x1: 300 }));
      for (const page of [leftPage, rightPage]) {
        lines.push(line(String(page), page, 20));
        lines.push(line(`The body of file page ${page} stays.`, page, 400));
      }
    }
    const folio = assembleFolio(lines, { title: "Columns", subtitle: "", sourceName: "wide.pdf", emptyMessage: "empty", skipEpub: true });
    const labels = folio.toc.map((item) => item.label);
    assert.equal(labels.includes("Chapter 1 - Early Title"), true);
    assert.equal(labels.includes("Chapter 40 - Early Title"), true);
    assert.equal(labels.includes("Chapter 41 - Later Title"), true);
    assert.equal(labels.includes("Chapter 80 - Later Title"), true);
    assert.equal(labels.filter((label) => /^Chapter \d+ - /.test(label)).length, 80);
    const first = labels.find((label) => /^Chapter \d+ - /.test(label));
    assert.equal(first, "Chapter 1 - Early Title");
  });

  it("keeps chapters whose pages fall outside the numbered footers", () => {
    const g = globalThis as { URL?: { createObjectURL?: (b: Blob) => string } };
    g.URL = g.URL || {};
    g.URL.createObjectURL = () => "blob:folio-test";
    const lines: Line[] = [line("Contents", 2, 760)];
    for (let file = 1; file <= 60; file++) {
      if (file >= 40 && file <= 55) lines.push(line(String(file - 20), file, 20));
      lines.push(line(`Body sentence on file ${file} stays here.`, file, 400));
    }
    for (let n = 1; n <= 30; n++) {
      lines.push(line(`Chapter ${n} - Title .......... ${5 + n}`, 2, 740 - n * 16));
    }
    const folio = assembleFolio(lines, { title: "Range", subtitle: "", sourceName: "range.pdf", emptyMessage: "empty", skipEpub: true });
    const labels = folio.toc.map((item) => item.label);
    assert.equal(labels.includes("Chapter 1 - Title"), true);
    assert.equal(labels.includes("Chapter 14 - Title"), true);
    assert.equal(labels.includes("Chapter 30 - Title"), true);
    assert.equal(labels.filter((label) => /^Chapter \d+ - Title$/.test(label)).length, 30);
  });

  it("orders chapters by number when the later ones were read first", () => {
    const g = globalThis as { URL?: { createObjectURL?: (b: Blob) => string } };
    g.URL = g.URL || {};
    g.URL.createObjectURL = () => "blob:folio-test";
    const lines: Line[] = [line("Contents", 2, 760)];
    for (let n = 72; n <= 87; n++) lines.push(line(`Chapter ${n} - Later .......... ${100 + n}`, 2, 700 - (n - 72)));
    for (let n = 1; n <= 71; n++) lines.push(line(`Chapter ${n} - Early .......... ${300 + n}`, 2, 500 - n));
    const pages = new Set<number>();
    for (let n = 72; n <= 87; n++) pages.add(100 + n);
    for (let n = 1; n <= 71; n++) pages.add(300 + n);
    for (const page of pages) {
      lines.push(line(String(page), page, 20));
      lines.push(line(`The body of page ${page} stays.`, page, 400));
    }
    const folio = assembleFolio(lines, { title: "Order", subtitle: "", sourceName: "order.pdf", emptyMessage: "empty", skipEpub: true });
    const labels = folio.toc.map((item) => item.label);
    const first = labels.find((label) => /^Chapter \d+ /.test(label));
    assert.equal(first, "Chapter 1 - Early");
    assert.ok(labels.indexOf("Chapter 1 - Early") < labels.indexOf("Chapter 72 - Later"));
    assert.ok(labels.indexOf("Chapter 71 - Early") < labels.indexOf("Chapter 72 - Later"));
    assert.equal(labels.includes("Chapter 87 - Later"), true);
  });

  it("splits two chapters on one line and keeps the year in the title", () => {
    const g = globalThis as { URL?: { createObjectURL?: (b: Blob) => string } };
    g.URL = g.URL || {};
    g.URL.createObjectURL = () => "blob:folio-test";
    const lines: Line[] = [line("Contents", 2, 760)];
    lines.push(line("Chapter 1 The Ciompi Rebellion of 1378 12 Chapter 2 Pagan Economics 28", 2, 720));
    for (let n = 3; n <= 12; n++) lines.push(line(`Chapter ${n} - Title .......... ${30 + n}`, 2, 700 - n));
    for (let page = 12; page <= 50; page++) {
      lines.push(line(String(page), page, 20));
      lines.push(line(`The body of page ${page} stays.`, page, 400));
    }
    const folio = assembleFolio(lines, { title: "Split", subtitle: "", sourceName: "split.pdf", emptyMessage: "empty", skipEpub: true });
    const labels = folio.toc.map((item) => item.label);
    assert.equal(labels.includes("Chapter 1 The Ciompi Rebellion of 1378"), true);
    assert.equal(labels.includes("Chapter 2 Pagan Economics"), true);
    assert.equal(labels.some((label) => /Chapter 1[\s\S]*Chapter 2/.test(label)), false);
    assert.ok(labels.indexOf("Chapter 1 The Ciompi Rebellion of 1378") < labels.indexOf("Chapter 12 - Title"));
  });

  it("lifts chapters that the file nested under the last chapter", () => {
    const g = globalThis as { URL?: { createObjectURL?: (b: Blob) => string } };
    g.URL = g.URL || {};
    g.URL.createObjectURL = () => "blob:folio-test";
    const lines: Line[] = [line("A sentence of the book stays here.", 1, 400)];
    const outline = [];
    for (let n = 72; n <= 87; n++) {
      outline.push({
        label: `Chapter ${n} - Later`,
        page: 100 + n,
        children:
          n === 87
            ? Array.from({ length: 20 }, (_, i) => ({ label: `Chapter ${i + 1} - Early`, page: 300 + i, children: [] }))
            : [],
      });
    }
    const folio = assembleFolio(lines, {
      title: "Nested",
      subtitle: "",
      sourceName: "nested.pdf",
      emptyMessage: "empty",
      skipEpub: true,
      outline,
    });
    const labels = folio.toc.map((item) => item.label);
    assert.ok(labels.indexOf("Chapter 1 - Early") < labels.indexOf("Chapter 72 - Later"));
    assert.ok(labels.indexOf("Chapter 20 - Early") < labels.indexOf("Chapter 72 - Later"));
    const last = folio.toc.find((item) => item.label === "Chapter 87 - Later");
    assert.equal(last?.children.some((child) => /Chapter 1/.test(child.label)), false);
  });

  it("does not open a chapter on a tall line of prose", () => {
    const lines: Line[] = [];
    for (let n = 0; n < 12; n++) {
      lines.push(line(`The story continues with sentence number ${n} about the farmer.`, 3, 700 - n * 16, { h: 11, x0: 72, x1: 520 }));
    }
    lines.push(line("were born, was not that sort of a man. A rich relation came", 3, 470, { h: 16, x0: 72, x1: 520 }));
    lines.push(line("The next sentence stays in the same stretch of the tale.", 3, 440, { h: 11, x0: 72, x1: 520 }));
    lines.push(line("WIZARD", 4, 700, { h: 28, x0: 40, x1: 180, pageW: 600 }));
    lines.push(line("Dorothy lived in the midst of the great Kansas prairies.", 4, 640, { h: 11, x0: 72, x1: 520 }));
    lines.push(line("The WON-", 4, 560, { h: 28, x0: 40, x1: 200, pageW: 600 }));
    lines.push(line("The title page keeps the broken word in the text.", 4, 500, { h: 11, x0: 72, x1: 520 }));
    lines.push(line("Iwl^ PRANK B)il", 4, 420, { h: 28, x0: 180, x1: 420, pageW: 600 }));
    lines.push(line("The of Father Goose", 4, 340, { h: 18, x0: 160, x1: 440, pageW: 600 }));
    lines.push(line("The Cyclone", 5, 700, { h: 22, x0: 230, x1: 370, pageW: 600 }));
    lines.push(line("Dorothy looked at the gray sky and held on.", 5, 640, { h: 11, x0: 72, x1: 520 }));
    lines.push(line("Morning the", 6, 700, { h: 20, x0: 200, x1: 360, pageW: 600 }));
    lines.push(line("Scarecrow said the day was fine.", 6, 660, { h: 11, x0: 72, x1: 520 }));
    lines.push(line("Why do you stare", 7, 700, { h: 16, x0: 200, x1: 420, pageW: 600 }));
    lines.push(line("At the painted joker in the corner.", 7, 670, { h: 11, x0: 72, x1: 520 }));
    const folio = assembleFolio(lines, { title: "Story", subtitle: "", sourceName: "prose.pdf", emptyMessage: "empty", skipEpub: true });
    const labels = folio.toc.map((item) => item.label);
    assert.equal(labels.some((label) => /were born|rich relation|Wizard|WON|PRANK|Father Goose|Morning|stare/.test(label)), false);
    assert.ok(labels.some((label) => /Cyclone/.test(label)));
    const prose = folio.chapters.flatMap((chapter) => chapter.blocks).flatMap((block) => block.runs || []).join(" ");
    assert.match(prose, /rich relation came/);
    assert.match(prose, /Kansas prairies/);
    assert.match(prose, /broken word/);
    assert.match(prose, /day was fine/);
    assert.match(prose, /painted joker/);
  });

  it("keeps small-cap contents names and does not slice the chapter on the word I", () => {
    const words = new Set(
      "the story of door search for mr was quite at ease murder case incident letter remarkable last night narrative but happen have noticed his address lives some square other sir make it a rule mine you never asked body stays here full statement dr".split(
        " ",
      ),
    );
    const lines: Line[] = [line("A preface sentence stays here.", 1, 400), line("1", 1, 20), line("Contents", 2, 720), line("2", 2, 20)];
    const titles = [
      "STORY OF THE DOOR 3",
      "SEARCH FOR MR. HYDE .... 4",
      "DR. JEKYLL WAS QUITE AT EASE 5",
      "THE CAREW MURDER CASE .... 6",
      "REMARKABLE INCIDENT OF DR. LANYON 7",
      "HENRY JEKYLL'S FULL STATEMENT OF THE",
      "CASE .... 8",
    ];
    titles.forEach((title, index) => lines.push(line(title, 2, 680 - index * 18)));
    for (let n = 3; n <= 8; n++) lines.push(line(String(n), n, 20));
    lines.push(line("But I happen to have noticed his address ; he lives in some square or other.", 3, 400));
    lines.push(line("And you never asked about the place with the door.", 3, 380));
    lines.push(line("No, sir, I make it a rule of mine and I ask nothing.", 4, 400));
    lines.push(line("The body of the search stays here.", 4, 360));
    lines.push(line("The body of the last night stays here.", 8, 400));
    const folio = assembleFolio(lines, {
      title: "Jekyll",
      subtitle: "",
      sourceName: "jekyll.pdf",
      emptyMessage: "empty",
      skipEpub: true,
      lexicon: { has: (word) => words.has(word) },
    });
    const labels = folio.toc.map((item) => item.label);
    assert.ok(labels.some((label) => /STORY OF THE DOOR/.test(label)));
    assert.ok(labels.some((label) => /SEARCH FOR MR\. HYDE/.test(label)));
    assert.ok(labels.some((label) => /REMARKABLE INCIDENT OF DR\. LANYON/.test(label)));
    assert.ok(labels.some((label) => /STATEMENT OF THE CASE/.test(label)));
    assert.equal(labels.some((label) => /noticed his address|make it a rule|^But$/.test(label)), false);
    const prose = folio.chapters.flatMap((chapter) => chapter.blocks).flatMap((block) => block.runs || []).join(" ");
    assert.match(prose, /noticed his address/);
    assert.match(prose, /search stays here/);
  });

  it("keeps a roman contents line with a comma or a long numeral", () => {
    const words = new Set("the machine is lost strange animal inventor sunset night came".split(" "));
    const lines: Line[] = [line("Contents", 2, 740), line("2", 2, 20)];
    const rows: [string, number, { text: string; x0: number; x1: number }[]?][] = [
      ["I. The Inventor, . . . 3", 680],
      ["V. Sunset, . . 4", 660],
      ["VI. The Machine is Lost, . 5", 640, [
        { text: "VI. The Machine is Lost, .", x0: 40, x1: 220 },
        { text: "5", x0: 250, x1: 280 },
      ]],
      ["VII. The Strange Animal, . 6", 620],
      ["VIII. The Morlocks, . . 7", 600],
      ["XIII. The Further Vision, . 8", 580],
    ];
    for (const [text, y, cells] of rows) lines.push(line(text, 2, y, cells ? { cells } : {}));
    for (let n = 3; n <= 8; n++) {
      lines.push(line(String(n), n, 20));
      lines.push(line(`The body of chapter ${n} stays here.`, n, 400));
    }
    lines.push(line("Nora. He went home and stayed there.", 4, 360));
    const folio = assembleFolio(lines, {
      title: "Time",
      subtitle: "",
      sourceName: "time.pdf",
      emptyMessage: "empty",
      skipEpub: true,
      lexicon: { has: (word) => words.has(word) },
    });
    const labels = folio.toc.map((item) => item.label);
    assert.ok(labels.some((label) => /VI\b/.test(label) && /Machine is Lost/.test(label)));
    assert.ok(labels.some((label) => /VIII\b/.test(label) && /Morlocks/.test(label)));
    assert.ok(labels.some((label) => /XIII\b/.test(label) && /Further Vision/.test(label)));
    assert.equal(labels.some((label) => /Nora/.test(label)), false);
  });

  it("does not slice a play on a spoken line or a publisher list", () => {
    const lines: Line[] = [];
    for (let n = 1; n <= 8; n++) {
      lines.push(line(String(n), n, 20));
      lines.push(line(`The scene on page ${n} stays in the play.`, n, 500));
    }
    lines.push(line("Helmer (playing). Slower ! Slower 3", 5, 360));
    lines.push(line("am going at once 4", 6, 340));
    lines.push(line("For Children from 7", 7, 340));
    lines.push(line("For Players from 8", 8, 340));
    const folio = assembleFolio(lines, { title: "Doll", subtitle: "", sourceName: "doll.pdf", emptyMessage: "empty", skipEpub: true });
    const labels = folio.toc.map((item) => item.label);
    assert.equal(labels.some((label) => /Helmer|am going|For Children|For Players/.test(label)), false);
    const prose = folio.chapters.flatMap((chapter) => chapter.blocks).flatMap((block) => block.runs || []).join(" ");
    assert.match(prose, /scene on page 5/);
    assert.match(prose, /Slower/);
  });

  it("opens a play on its acts, not on the advertisements after it", () => {
    const lines: Line[] = [];
    for (const [act, page] of [
      ["ACT I", 2],
      ["ACT II", 3],
      ["ACT III", 4],
    ] as const) {
      lines.push(line(act, page, 700, { h: 18, x0: 250, x1: 340, pageW: 600 }));
      lines.push(line(`The scene of ${act} stays in the play.`, page, 640, { h: 11, x0: 72, x1: 520 }));
      lines.push(line("Helmer speaks and the talk goes on for a while.", page, 620, { h: 11, x0: 72, x1: 520 }));
    }
    lines.push(line("THE NELSON PLAYBOOKS", 5, 700, { h: 22, x0: 120, x1: 480, pageW: 600 }));
    lines.push(line("A graduated course in drama for schools and amateurs.", 5, 640, { h: 11, x0: 72, x1: 240, pageW: 600 }));
    const folio = assembleFolio(lines, { title: "Doll", subtitle: "", sourceName: "doll.pdf", emptyMessage: "empty", skipEpub: true });
    const labels = folio.toc.map((item) => item.label);
    assert.ok(labels.includes("Act I"));
    assert.ok(labels.includes("Act II"));
    assert.ok(labels.includes("Act III"));
    assert.equal(labels.some((label) => /Nelson|Helmer/.test(label)), false);
    const prose = folio.chapters.flatMap((chapter) => chapter.blocks).flatMap((block) => block.runs || []).join(" ");
    assert.match(prose, /scene of ACT II/);
  });

  it("does not open a chapter on a library stamp or a publisher list", () => {
    const lines: Line[] = [];
    for (let n = 0; n < 14; n++) lines.push(line(`A body sentence stays on the opening page number ${n}.`, 1, 720 - n * 14, { h: 11, x0: 72, x1: 520 }));
    lines.push(line("LIBRARY FUNDS", 2, 500, { h: 20, x0: 180, x1: 420, pageW: 600 }));
    lines.push(line("BROTHER LAWRENCE", 3, 500, { h: 22, x0: 160, x1: 440, pageW: 600 }));
    lines.push(line("THE COMRADE SERIES", 4, 700, { h: 24, x0: 140, x1: 460, pageW: 600 }));
    lines.push(line("A new series of brochure gems by recognized favorites among writers.", 4, 660, { h: 11, x0: 72, x1: 220, pageW: 600 }));
    for (let n = 0; n < 6; n++) lines.push(line(`Author . Essay Title ${n}.`, 4, 620 - n * 16, { h: 11, x0: 90, x1: 220, pageW: 600 }));
    lines.push(line("Brother Lawrence", 5, 700, { h: 26, x0: 150, x1: 450, pageW: 600 }));
    lines.push(line("The value of this little book is its extreme simplicity.", 5, 640, { h: 11, x0: 72, x1: 520 }));
    lines.push(line("The trouble with most of the religion of the day is its complexity.", 5, 620, { h: 11, x0: 72, x1: 520 }));
    const folio = assembleFolio(lines, { title: "Lawrence", subtitle: "", sourceName: "lawrence.pdf", emptyMessage: "empty", skipEpub: true });
    const labels = folio.toc.map((item) => item.label);
    assert.equal(labels.some((label) => /Library Funds|Comrade Series/.test(label)), false);
    assert.ok(labels.some((label) => /Brother Lawrence/.test(label)));
    const prose = folio.chapters.flatMap((chapter) => chapter.blocks).flatMap((block) => block.runs || []).join(" ");
    assert.match(prose, /extreme simplicity/);
  });

  it("reads a contents mark before the book number and keeps XI between X and XII", () => {
    const lines: Line[] = [line("Contents", 2, 760)];
    const books = [
      ["I", 10],
      ["II", 20],
      ["III", 30],
      ["IV", 40],
      ["V", 50],
      ["VI", 60],
      ["VII", 70],
      ["VIII", 80],
      ["IX", 90],
      ["X", 100],
      ["XL", 110],
      ["XII", 120],
    ] as const;
    books.forEach(([num, page], index) => {
      const mark = num === "VI" || num === "VII" ? "^ " : "";
      lines.push(
        line(`${mark}BOOK ${num}. . ${page}`, 2, 740 - index * 18, {
          cells: [
            { text: `${mark}BOOK ${num}.`, x0: 15, x1: 120 },
            { text: String(page), x0: 180, x1: 220 },
          ],
        }),
      );
      lines.push(line(String(page), page, 30));
      lines.push(line(`BOOK ${num}.`, page, 700, { h: 18 }));
      lines.push(line(`The text of book ${num} stays here.`, page, 640));
    });
    const folio = assembleFolio(lines, { title: "Marcus", subtitle: "", sourceName: "books.pdf", emptyMessage: "empty", skipEpub: true });
    const labels = folio.toc.map((item) => item.label);
    assert.ok(labels.some((label) => /\bVI\b/.test(label)));
    assert.ok(labels.some((label) => /\bVII\b/.test(label)));
    assert.equal(labels.some((label) => /^\^/.test(label)), false);
    assert.ok(labels.some((label) => /\bXI\b/.test(label)));
    assert.equal(labels.some((label) => /\bXL\b/.test(label)), false);
    const xi = labels.findIndex((label) => /\bXI\b/.test(label));
    const x = labels.findIndex((label) => /\bX\b/.test(label) && !/\bXI\b|XII/.test(label));
    const xii = labels.findIndex((label) => /\bXII\b/.test(label));
    assert.ok(x >= 0 && xi > x && xii > xi);
    const sixth = folio.chapters.find((chapter) => /\bVI\b/.test(chapter.title));
    const body = (sixth?.blocks || []).flatMap((block) => block.runs || []).join(" ");
    assert.match(body, /book VI stays/);
  });

  it("keeps a sentence in the bottom band of a short page", () => {
    const lines: Line[] = [
      line("Farmer Meanwell left the village with his family.", 2, 200, { pageH: 452 }),
      line("and Graspall she was not free from trouble and care.", 2, 28, { pageH: 452 }),
      line("He soon fell ill, and when he found himself unable to get work.", 2, 15, { pageH: 452 }),
      line("12", 2, 12, { pageH: 452 }),
    ];
    const folio = assembleFolio(lines, { title: "Goody", subtitle: "", sourceName: "short.pdf", emptyMessage: "empty", skipEpub: true });
    const prose = folio.chapters.flatMap((chapter) => chapter.blocks).flatMap((block) => block.runs || []).join(" ");
    assert.match(prose, /trouble and care/);
    assert.match(prose, /fell ill/);
    assert.doesNotMatch(prose, /\b12\b/);
  });

  it("keeps a picture's letters out of the sentence beside them", () => {
    const g = globalThis as { URL?: { createObjectURL?: (b: Blob) => string } };
    g.URL = g.URL || {};
    g.URL.createObjectURL = () => "blob:folio-test";
    const lines: Line[] = [];
    for (let n = 0; n < 4; n++) {
      lines.push(line(`The crow spoke a full sentence number ${n} about the field.`, 3, 640 - n * 16, { x0: 95, x1: 350, h: 12 }));
    }
    lines.push(line("3J^]^^t,^", 3, 560, { x0: 174, x1: 250, h: 11 }));
    lines.push(
      line("such a good arL but\\tne al", 3, 500, {
        x0: 95,
        x1: 349,
        h: 12,
        cells: [
          { text: "such a good", x0: 95, x1: 163 },
          { text: "arL but\\tne al", x0: 267, x1: 349 },
        ],
      }),
    );
    lines.push(line("Scarecro.v^fter", 3, 488, { x0: 168, x1: 260, h: 11 }));
    lines.push(line("all the corn he wanted from the field.", 3, 470, { x0: 95, x1: 350, h: 12 }));
    for (let n = 0; n < 4; n++) {
      lines.push(line(`A quiet sentence on the dinner page number ${n} stays put.`, 4, 640 - n * 16, { x0: 40, x1: 340, h: 12 }));
    }
    lines.push(
      line("fruit from a tree near for her dinner.", 4, 400, {
        x0: 40,
        x1: 349,
        h: 12,
        cells: [
          { text: "fruit from a tree near", x0: 40, x1: 161 },
          { text: "for her dinner.", x0: 268, x1: 349 },
        ],
      }),
    );
    lines.push(line("bA\\;^ttiiill(i//i^", 4, 388, { x0: 165, x1: 243, h: 11 }));
    lines.push(line("Dorothy ate it before the sun went down.", 4, 360, { x0: 40, x1: 340, h: 12 }));
    const folio = assembleFolio(lines, { title: "Oz", subtitle: "", sourceName: "picture.pdf", emptyMessage: "empty", skipEpub: true });
    const prose = folio.chapters
      .flatMap((chapter) => chapter.blocks)
      .flatMap((block) => block.runs || [])
      .filter((run) => typeof run === "string")
      .join(" ");
    assert.match(prose, /such a good Scarecro/);
    assert.match(prose, /fruit from a tree near for her dinner/);
    assert.doesNotMatch(prose, /arL|ttiiill|3J\^/);
    const good = prose.indexOf("such a good");
    const next = prose.indexOf("all the corn");
    assert.ok(good >= 0 && next > good);
  });

  it("does not slice the book from a contents list that has no page numbers", () => {
    const lines: Line[] = [line("List of Chapters", 2, 760, { h: 16 })];
    for (let n = 1; n <= 8; n++) lines.push(line(`Chapter ${n}. A title with no page`, 2, 720 - n * 20));
    for (let page = 4; page <= 20; page++) {
      lines.push(line(`The tale keeps its order on file page ${page}.`, page, 500, { h: 11, x0: 72, x1: 520 }));
    }
    const folio = assembleFolio(lines, { title: "Oz", subtitle: "", sourceName: "nopages.pdf", emptyMessage: "empty", skipEpub: true });
    const prose = folio.chapters.flatMap((chapter) => chapter.blocks).flatMap((block) => block.runs || []).filter((run) => typeof run === "string").join(" ");
    assert.match(prose, /file page 4/);
    assert.match(prose, /file page 20/);
    const at4 = prose.indexOf("file page 4");
    const at20 = prose.indexOf("file page 20");
    assert.ok(at4 >= 0 && at20 > at4);
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

  it("keeps a Greek page and the English page that faces it", () => {
    const lexicon = { has: (word: string) => word === "nature" || list.has(word) };
    const greek = [
      line("ἐκ τῆς natvre τοῦ νοῦ πρᾶον ἦθος ἕπεται.", 4, 640, { h: 11 }),
      line("^1 καὶ αἰδὼς καὶ ἀνδρεία.", 4, 620, { h: 11 }),
    ];
    const english = [
      line("From the natvre of the mind a kindly temper follows him home.", 5, 640),
      line("Modesty and manliness follow with it.", 5, 620),
    ];
    const folio = assembleFolio([...greek, ...english], {
      title: "Meditations",
      subtitle: "",
      sourceName: "m.pdf",
      emptyMessage: "empty",
      lexicon,
      skipEpub: true,
    });
    const texts = folio.chapters.flatMap((chapter) => chapter.blocks).map((block) => (block.runs || []).filter((run) => typeof run === "string").join(" "));
    const greekBlock = texts.find((text) => text.includes("νοῦ"));
    if (!greekBlock) throw new Error("missing Greek block");
    assert.match(greekBlock, /natvre/);
    assert.equal(greekBlock.includes("kindly"), false);
    const prose = texts.join("\n");
    assert.ok(prose.indexOf("νοῦ") < prose.indexOf("kindly temper"));
    assert.match(prose, /nature of the mind/);
    assert.equal(prose.includes("natvre of the mind"), false);
  });

  it("keeps both languages when one page prints both", () => {
    const lines = [
      line("ἐκ τῆς φύσεως τοῦ νοῦ πρᾶον ἦθος ἕπεται αὐτῷ.", 4, 640, { h: 11 }),
      line("καὶ αἰδὼς καὶ ἀνδρεία συνέπεται.", 4, 622, { h: 11 }),
      line("From the nature of the mind a kindly temper follows him.", 4, 560),
      line("Modesty and manliness follow with it.", 4, 542),
    ];
    const folio = assembleFolio(lines, { title: "Meditations", subtitle: "", sourceName: "m.pdf", emptyMessage: "empty", skipEpub: true });
    const texts = folio.chapters.flatMap((chapter) => chapter.blocks).map((block) => (block.runs || []).filter((run) => typeof run === "string").join(" "));
    const greekBlock = texts.find((text) => text.includes("φύσεως"));
    const englishBlock = texts.find((text) => text.includes("kindly temper"));
    assert.ok(greekBlock && !greekBlock.includes("kindly"));
    assert.ok(englishBlock && !englishBlock.includes("φύσεως"));
    const prose = texts.join("\n");
    assert.ok(prose.indexOf("φύσεως") < prose.indexOf("kindly temper"));
  });

  it("keeps a second passage on the page and does not lay it over the English", () => {
    const english = Array.from({ length: 8 }, (_, index) => line(`From my grandfather Verus I learned a line of good temper ${index}.`, 3, 640 - index * 16));
    const greek = Array.from({ length: 4 }, (_, index) => line("ἐκ τῆς φύσεως τοῦ νοῦ πρᾶον ἦθος", 3, 400 - index * 16, { h: 11 }));
    const both = keepPageLanguage(english, greek, "greek");
    assert.equal(both.script, "greek");
    assert.ok(both.lines.some((item) => item.text.includes("grandfather")));
    assert.ok(both.lines.some((item) => item.text.includes("φύσεως")));
    assert.ok(both.lines.findIndex((item) => item.text.includes("grandfather")) < both.lines.findIndex((item) => item.text.includes("φύσεως")));
    const overlaid = keepPageLanguage(english, greek.map((item, index) => ({ ...item, y: english[index].y, x0: english[index].x0, x1: english[index].x1 })), "greek");
    assert.equal(overlaid.script, "en");
    assert.deepEqual(overlaid.lines.map((item) => item.text), english.map((item) => item.text));
    assert.equal(keepPageLanguage(english, [greek[0]], "greek").script, "en");
    const scraps = Array.from({ length: 6 }, (_, index) => line("x7 ## q", 3, 640 - index * 16));
    const won = keepPageLanguage(scraps, greek, "greek");
    assert.equal(won.script, "greek");
    assert.equal(won.lines.some((item) => item.text.includes("x7")), false);
    assert.equal(pageLooksMixed([...english.slice(0, 4), ...Array.from({ length: 4 }, () => line("x7 ## qq qq", 3, 300))]), true);
    assert.equal(pageLooksMixed(english), false);
    assert.equal(pageLooksMixed([...english, line("x7 ## qq qq", 3, 200), line("x7 ## qq qq", 3, 180)]), false);
  });

  it("sends a broken fount to the picture reader only when another script is on", () => {
    const mangled = Array.from({ length: 22 }, () => "ZKovtdpios avToupytKoy").join(" ");
    const latin = Array.from({ length: 8 }, () => "Officium est consistere in officio virtutis.").join(" ");
    const english = Array.from({ length: 8 }, () => "From my grandfather Verus I learned good temper.").join(" ");
    assert.equal(looksMangled(mangled), true);
    assert.equal(looksMangled(latin), false);
    assert.equal(looksMangled(english), false);
    assert.equal(pageNeedsPicture(mangled, ["en"]), false);
    assert.equal(pageNeedsPicture(mangled, ["en", "greek"]), true);
    assert.equal(pageNeedsPicture(english, ["en", "greek"]), false);
    const shy = `${Array.from({ length: 17 }, () => "ZKovtdpios").join(" ")} ${Array.from({ length: 30 }, () => "word").join(" ")}`;
    assert.equal(looksMangled(shy), false);
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
      corrections: false,
      review: false,
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

describe("public domain encyclopedias", () => {
  const files = [
    "Encyclopedia_Britannica_01_A_-_Androphagi.djvu",
    "Encyclopedia_Britannica_03_Austria_lower_-_Bisectrix.djvu",
    "Encyclopedia_Britannica_10_Evangelical_church_conference_-_Francis_Joseph_I.djvu",
    "Encyclopedia_Britannica_17_Lord_Chamberlain_-_Mecklenburg.djvu",
    "Encyclopedia_Britannica_24_Sainte-Claire_Deville_-_Shuttle.djvu",
    "Encyclopedia_Britannica_29_Index_-_List_of_contributors.djvu",
  ];

  it("lists every volume of the eleventh Britannica and the New International", () => {
    const britannica = PRESS.find((work) => work.id === "britannica-11");
    const international = PRESS.find((work) => work.id === "new-international");
    assert.equal(britannica?.volumes.length, 29);
    assert.equal(international?.volumes.length, 17);
    assert.equal(britannica?.volumes[0]?.label, "A–Androphagi");
    assert.equal(britannica?.volumes[28]?.label, "Index–List of contributors");
    assert.equal(new Set(PRESS.flatMap((work) => work.volumes.map((volume) => volume.id))).size, 46);
    for (const name of files) assert.equal(britannica?.volumes.some((volume) => volume.file === name), true);
    const first = britannica!.volumes[0];
    assert.equal(
      pressUrl(britannica!, first),
      "https://cors.archive.org/cors/EncyclopaediaBritannica1911HQDJVU/Encyclopedia_Britannica_01_A_-_Androphagi.djvu",
    );
    const lastNie = international!.volumes[16];
    assert.equal(pressUrl(international!, lastNie), "https://cors.archive.org/cors/newinternationa17gilm/newinternationa17gilm.pdf");
  });
});

describe("interlinear pages", () => {
  it("keeps an interlinear gloss under its own line", () => {
    const pairs = [
      ["atque hinc illa fert pharetram humeroque graditur super-", "and hence that she carries a quiver on the shoulder and"],
      ["eminent tecto et radiis caput emicat altis", "she stands out from the roof and her head flashes with high rays"],
      ["talis erat Dido laeta ferebat se talem per medios", "such was Dido joyful she carried herself such through the midst"],
      ["instans operi que futuris regnis tum resedit", "intent upon the work and her future dominions then she sat"],
      ["foribus divae media testudine templi septa", "at the gates of the goddess in the middle of the temple"],
      ["armis que subnixa alte solio dabat jura leges", "with arms and raised high on a throne she gave laws"],
    ];
    const lines: Line[] = [];
    let y = 700;
    for (const [latin, english] of pairs) {
      lines.push(line(latin, 40, y, { h: 9, x0: 32, x1: 250, pageW: 285, pageH: 800 }));
      y -= 6;
      lines.push(line(english, 40, y, { h: 7, x0: 36, x1: 240, pageW: 285, pageH: 800 }));
      y -= 14;
    }
    const folio = assembleFolio(lines, { title: "Virgil", subtitle: "", sourceName: "v.pdf", emptyMessage: "empty", skipEpub: true });
    const texts = folio.chapters.flatMap((chapter) => chapter.blocks).map((block) => (block.runs || []).filter((run) => typeof run === "string").join(" "));
    const prose = texts.join("\n");
    for (const text of texts) {
      const hasLatin = /pharetram|eminent|Dido laeta|futuris|testudine|subnixa/.test(text);
      const hasEnglish = /quiver|flashes|joyful|dominions|goddess|throne/.test(text);
      assert.equal(hasLatin && hasEnglish, false, text);
    }
    assert.ok(prose.indexOf("pharetram") < prose.indexOf("quiver"));
    assert.ok(prose.indexOf("quiver") < prose.indexOf("eminent"));
    assert.doesNotMatch(prose, /super-and|superand/);
  });

  it("drops a running head that repeats and keeps a sentence that appears once", () => {
    const lines: Line[] = [];
    for (const page of [1, 2, 3]) {
      lines.push(line("ODES OF HORACE.", page, 770, { pageH: 800 }));
      lines.push(line("The body of the ode begins here and continues across the page.", page, 640, { pageH: 800 }));
    }
    lines.push(line("make him an help meet for him.", 2, 750, { pageH: 800 }));
    lines.push(line("THE ARGUMENT", 4, 760, { pageH: 800 }));
    lines.push(line("And the Lord God said it is not good that the man should be alone.", 4, 640, { pageH: 800 }));
    lines.push(line("The short page still keeps this closing sentence intact.", 5, 28, { pageH: 452 }));
    lines.push(line("12", 5, 15, { pageH: 452 }));
    const folio = assembleFolio(lines, { title: "Bible", subtitle: "", sourceName: "b.pdf", emptyMessage: "empty", skipEpub: true });
    const prose = folio.chapters.flatMap((chapter) => chapter.blocks).flatMap((block) => block.runs || []).filter((run) => typeof run === "string").join(" ");
    assert.equal(prose.includes("ODES OF HORACE"), false);
    assert.match(prose, /make him an help meet for him/);
    assert.match(prose, /THE ARGUMENT/);
    assert.match(prose, /body of the ode/);
    assert.match(prose, /closing sentence intact/);
    assert.equal(/\b12\b/.test(prose), false);
  });

  it("keeps a body chapter when the contents line has no page", () => {
    const lines: Line[] = [line("Contents", 2, 700)];
    const contents = [
      "I. Down the Hole .......... 3",
      "II. The Pool .......... 4",
      "IV. The Rabbit .......... 5",
      "X. The Lobster Quadrille IV,",
      "XI. Who Stole the Tarts? 7",
      "XII. Alice's Evidence .......... 8",
    ];
    contents.forEach((text, index) => lines.push(line(text, 2, 660 - index * 18)));
    const bodies: [number, string, string][] = [
      [3, "CHAPTER I.", "The hole stays."],
      [4, "CHAPTER II.", "The pool stays."],
      [5, "CHAPTER IV.", "The rabbit stays."],
      [6, "CHAPTEK X.", "The lobster quadrille stays in its own chapter."],
      [7, "The tarts stay in their own chapter.", ""],
      [8, "CHAPTER XII.", "The evidence stays."],
    ];
    for (const [page, head, body] of bodies) {
      lines.push(line(String(page), page, 20));
      lines.push(line(head, page, 500, { h: 16 }));
      if (page === 6) lines.push(line("THE LOBSTER QUADRILLE.", page, 470, { h: 14 }));
      if (body) lines.push(line(body, page, 440));
    }
    const folio = assembleFolio(lines, { title: "Alice", subtitle: "", sourceName: "a.pdf", emptyMessage: "empty", skipEpub: true });
    const labels = folio.toc.map((item) => item.label);
    assert.equal(labels.some((label) => /^chapter x\b/i.test(label)), true);
    assert.equal(labels.some((label) => /who stole the tarts/i.test(label)), true);
    const lobster = folio.chapters.find((chapter) => /^chapter x\b/i.test(chapter.title));
    const tarts = folio.chapters.find((chapter) => /tarts/i.test(chapter.title));
    assert.ok(lobster);
    assert.ok(tarts);
    const lobsterText = (lobster?.blocks || []).flatMap((block) => block.runs || []).join(" ");
    const tartsText = (tarts?.blocks || []).flatMap((block) => block.runs || []).join(" ");
    assert.match(lobsterText, /lobster quadrille stays/);
    assert.match(tartsText, /tarts stay/);
    assert.equal(lobsterText.includes("tarts stay"), false);
  });

  it("keeps a short line that sits under only part of the line above", () => {
    const lines: Line[] = [];
    let y = 700;
    for (let n = 0; n < 4; n++) {
      lines.push(line("The full line of the verse runs across the measure of the page.", 4, y, { h: 10, x0: 40, x1: 500 }));
      y -= 12;
      lines.push(line("Ger. sg. only", 4, y, { h: 7, x0: 48, x1: 160 }));
      y -= 16;
    }
    const folio = assembleFolio(lines, { title: "Crib", subtitle: "", sourceName: "c.pdf", emptyMessage: "empty", skipEpub: true });
    const texts = folio.chapters.flatMap((chapter) => chapter.blocks).map((block) => (block.runs || []).filter((run) => typeof run === "string").join(" "));
    assert.equal(texts.some((text) => text.includes("Ger. sg. only") && text.includes("full line")), false);
  });

  it("reads a Hebrew line from the right", () => {
    const words = [
      ["לְבַדּוֹ", 40],
      ["הָאָדָם", 110],
      ["וַיֹּאמֶר", 190],
      ["Genesis", 280],
    ] as const;
    const items = words.map(([str, x]) => ({ str, transform: [11, 0, 0, 11, x, 500], width: 60, height: 11 }));
    const lines = cluster(items);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].text, "וַיֹּאמֶר הָאָדָם לְבַדּוֹ Genesis");
    const greek = cluster([{ str: "καὶ εἶπεν ὁ θεὸς", transform: [12, 0, 0, 12, 40, 400], width: 120, height: 12 }]);
    assert.equal(greek.length, 1);
    assert.match(greek[0].text, /εἶπεν/);
    const english = cluster([
      { str: "From", transform: [12, 0, 0, 12, 40, 300], width: 28, height: 12 },
      { str: "the", transform: [12, 0, 0, 12, 72, 300], width: 20, height: 12 },
      { str: "mind", transform: [12, 0, 0, 12, 96, 300], width: 28, height: 12 },
    ]);
    assert.equal(english[0].text, "From the mind");
    const split = cluster([
      { str: "לְב ַּד", transform: [20, 0, 0, 20, 70.5, 500], width: 46.6, height: 20, dir: "rtl" },
      { str: "וֹ", transform: [20, 0, 0, 20, 70.6, 500], width: 0, height: 20, dir: "rtl" },
      { str: "הָאָדָם", transform: [20, 0, 0, 20, 124, 500], width: 52, height: 20, dir: "rtl" },
      { str: "וַיֹּאמֶר", transform: [20, 0, 0, 20, 418, 500], width: 52, height: 20, dir: "rtl" },
      { str: "Genesis 2:18", transform: [14, 0, 0, 14, 477, 500], width: 75, height: 14, dir: "ltr" },
    ]);
    assert.equal(split[0].text, "וַיֹּאמֶר הָאָדָם לְבַּדוֹ Genesis 2:18");
    const logical = cluster([
      { str: "וַיֹּאמֶר", transform: [20, 0, 0, 20, 40, 400], width: 52, height: 20, dir: "ltr" },
      { str: "הָאָדָם", transform: [20, 0, 0, 20, 110, 400], width: 52, height: 20, dir: "ltr" },
      { str: "לְבַדּוֹ", transform: [20, 0, 0, 20, 180, 400], width: 52, height: 20, dir: "ltr" },
    ]);
    assert.equal(logical[0].text, "וַיֹּאמֶר הָאָדָם לְבַדּוֹ");
  });

  it("repairs the chapter title from the opening line and keeps a contents page", () => {
    const words = new Set("teaks tears pool caucus race long tale rabbit sends little bill pig pepper mad party mau rig croquet queen ground and the".split(" "));
    const lines: Line[] = [line("Contents", 1, 700)];
    const rows: [string, number, string, string, string][] = [
      ["II. The Pool of Teaks .......... 12", 2, "CHAPTER II.", "THE POOL OF TEAES.", "The pool stays."],
      ["III. A Caucus-Race Axd a Long Tale .......... 13", 3, "CHAPTER III.", "A CAUCUS-RACE AND A LONG TALE.", "The tale stays."],
      ["VI. Rig and Pepper .......... 14", 4, "CHAPTER VI.", "PIG AND PEPPER.", "The pepper stays."],
      ["VII. A Mad Tea-Partv .......... 15", 5, "CHAPTER VII.", "A MAU TEA-PARTY.", "The party stays."],
      ["VIII. The Queen's Croquet-Ground .......... 18", 6, "CHAPTER VIII.", "THE queen's CHOQUET GROUND.", "The ground stays."],
    ];
    rows.forEach(([text], index) => lines.push(line(text, 1, 660 - index * 22)));
    for (const file of [2, 3, 4, 7, 8, 9, 10]) lines.push(line(String(file + 10), file, 20), line("A numbered page stays in the book.", file, 400));
    lines.push(line("18", 6, 20));
    for (let file = 20; file <= 30; file++) lines.push(line(String(file + 10), file, 20), line("A later numbered page stays.", file, 400));
    for (const [, file, head, sub, body] of rows) {
      lines.push(line(head, file, 700, { h: 16 }));
      lines.push(line(sub, file, 640));
      lines.push(line(body, file, 560));
    }
    const folio = assembleFolio(lines, {
      title: "Alice",
      subtitle: "",
      sourceName: "alice.pdf",
      emptyMessage: "empty",
      skipEpub: true,
      lexicon: { has: (word) => words.has(word) },
    });
    const labels = folio.toc.map((item) => item.label);
    assert.ok(labels.some((label) => label.includes("The Pool of Tears")), labels.join(" | "));
    assert.equal(labels.some((label) => /teaks|teaes/i.test(label)), false);
    assert.ok(labels.some((label) => label.includes("A Caucus-Race and a Long Tale")));
    assert.ok(labels.some((label) => label.includes("Pig and Pepper")));
    assert.equal(labels.some((label) => /\brig\b/i.test(label)), false);
    assert.ok(labels.some((label) => label.includes("A Mad Tea-Party")));
    assert.equal(labels.some((label) => /mau|partv/i.test(label)), false);
    assert.ok(labels.some((label) => label.includes("The Queen's Croquet-Ground")));
    assert.equal(labels.some((label) => /choquet/i.test(label)), false);
    const pool = folio.chapters.find((chapter) => /pool of tears/i.test(chapter.title));
    const poolText = (pool?.blocks || []).flatMap((block) => block.runs || []).join(" ");
    assert.match(poolText, /The Pool of Tears/);
    assert.equal(/teaes|teaks/i.test(poolText), false);
    assert.match(poolText, /CHAPTER II/);
    const queen = folio.chapters.find((chapter) => /croquet/i.test(chapter.title));
    const queenText = (queen?.blocks || []).flatMap((block) => block.runs || []).join(" ");
    assert.match(queenText, /The Queen's Croquet-Ground/);
    assert.equal(/choquet/i.test(queenText), false);
    const tea = folio.chapters.find((chapter) => /tea-party/i.test(chapter.title));
    assert.equal(tea?.page, 15);
    const teaText = (tea?.blocks || []).flatMap((block) => block.runs || []).join(" ");
    assert.match(teaText, /party stays/);
    assert.match(teaText, /A Mad Tea-Party/);
    assert.equal(/mau|partv/i.test(teaText), false);
  });

  it("repairs the chapter mark on the opening and dresses a heading the body confirms", () => {
    const words = new Set("rabbit sends little bill queen croquet ground advice caterpillar stole tarts mock turtle story alice evidence and the who from cool fountains".split(" "));
    const lines: Line[] = [line("Contents", 1, 720)];
    const rows: [string, number, string, string][] = [
      ["IV. The Rabbit Sends in a Little Bill .......... 3", 3, "CHAPTER lY.", "THE RABBIT SENDS IN A LITTLE BILL."],
      ["VIII. The Queen's Croquet-Ground .......... 4", 4, "CHAPTER Vlil.", "THE queen's CHOQUET GROUND."],
      ["XI. Who Stole the Tarts .......... 5", 5, "CHAPTEft XL", "WHO STOLE THE TARTS."],
      ["V. ADVICE FROM A CATERPILLAR .......... 6", 6, "CHAPTER V.", "ADVICE FROM A CATERPILLAR."],
      ["IX. THE MOCK TURTLE'S STORY .......... 7", 7, "", ""],
      ["XII. Alice's evidence .......... 8", 8, "CHAPTER XII.", "ALICES EVIDENCE."],
    ];
    rows.forEach(([text], index) => lines.push(line(text, 1, 680 - index * 22)));
    for (const [, file, head, sub] of rows) {
      lines.push(line(String(file), file, 20));
      if (head) lines.push(line(head, file, 700, { h: 16 }));
      if (file === 4) lines.push(line("The cool fountains.", file, 730, { x0: 40, x1: 560 }));
      if (sub) lines.push(line(sub, file, 640));
      lines.push(line(`The body of file ${file} stays in the chapter.`, file, 520));
    }
    const folio = assembleFolio(lines, {
      title: "Alice",
      subtitle: "",
      sourceName: "marks.pdf",
      emptyMessage: "empty",
      skipEpub: true,
      lexicon: { has: (word) => words.has(word) },
    });
    const labels = folio.toc.map((item) => item.label);
    assert.ok(labels.includes("V. Advice from a Caterpillar"), labels.join(" | "));
    assert.ok(labels.includes("IX. THE MOCK TURTLE'S STORY"), labels.join(" | "));
    const prose = (title: RegExp) =>
      (folio.chapters.find((chapter) => title.test(chapter.title))?.blocks || [])
        .flatMap((block) => block.runs || [])
        .filter((run) => typeof run === "string")
        .join(" ");
    const bill = prose(/little bill/i);
    assert.match(bill, /CHAPTER IV/);
    assert.equal(bill.includes("lY"), false);
    assert.match(bill, /The Rabbit Sends in a Little Bill/);
    const queen = prose(/croquet/i);
    assert.match(queen, /CHAPTER VIII/);
    assert.equal(queen.includes("fountains. CHAPTER"), false);
    assert.match(queen, /cool fountains/);
    assert.equal(/vlil|choquet/i.test(queen), false);
    assert.match(queen, /The Queen's Croquet-Ground/);
    const tarts = prose(/tarts/i);
    assert.match(tarts, /CHAPTER XI/);
    assert.equal(/chapteft|CHAPTER XL/i.test(tarts), false);
    assert.match(tarts, /Who Stole the Tarts/);
    const caterpillar = prose(/caterpillar/i);
    assert.match(caterpillar, /Advice from a Caterpillar/);
    assert.equal(caterpillar.includes("ADVICE FROM"), false);
    const mockChapter = folio.chapters.find((chapter) => /MOCK TURTLE/.test(chapter.title));
    assert.equal(mockChapter?.title, "IX. THE MOCK TURTLE'S STORY");
    assert.match(prose(/MOCK TURTLE/), /stays in the chapter/);
    assert.ok(labels.includes("XII. Alice's Evidence"), labels.join(" | "));
    const evidence = prose(/evidence/i);
    assert.match(evidence, /Alice's Evidence/);
    assert.equal(evidence.includes("ALICES"), false);
  });

  it("joins a wrapped capital title and drops the scan marks on a contents line", () => {
    assert.equal(contentsEntry({ text: 'How the Rhinoceros Got His Skin ."- \' • 31' })?.title, "How the Rhinoceros Got His Skin");
    assert.equal(contentsEntry({ text: "Tiger! Tiger! .......... 87" })?.title, "Tiger! Tiger!");
    const lines: Line[] = [
      line("Contents", 1, 720),
      line('How the Rhinoceros Got His Skin ."- \' • .......... 5', 1, 680),
      line("The Beginning of the Armadillos .......... 6", 1, 658),
      line("The Butterfly that Stamped .......... 8", 1, 636),
    ];
    lines.push(
      line("5", 5, 20),
      line("HOW THE RHINOCEROS GOT", 5, 700, { h: 16, x0: 80, x1: 420 }),
      line("HIS SKIN", 5, 678, { h: 15, x0: 200, x1: 310 }),
      line("Once upon a time the story stays.", 5, 600),
      line("6", 6, 20),
      line("THE BEGINNING OP THE", 6, 700, { h: 16, x0: 70, x1: 430 }),
      line("ARMADILLOS", 6, 678, { h: 15, x0: 190, x1: 340 }),
      line("This story of the tortoise stays.", 6, 600),
      line("8", 8, 20),
      line("THE BUTTERFLY THAT", 8, 700, { h: 16, x0: 90, x1: 400 }),
      line("STAMPED", 8, 678, { h: 15, x0: 210, x1: 320 }),
      line("THE LAST OP THE SPIRITS.", 8, 640, { h: 14 }),
      line("SEE OP. CIT. IN THE NOTE", 8, 600, { h: 14 }),
      line("The phantom stays in the chapter.", 8, 540),
    );
    const folio = assembleFolio(lines, {
      title: "Stories",
      subtitle: "",
      sourceName: "wrap.pdf",
      emptyMessage: "empty",
      skipEpub: true,
      lexicon: { has: (word) => word.length >= 2 },
    });
    const labels = folio.toc.map((item) => item.label);
    assert.ok(labels.some((label) => label === "How the Rhinoceros Got His Skin"), labels.join(" | "));
    assert.equal(labels.some((label) => /["•]/.test(label)), false);
    assert.ok(labels.some((label) => label === "The Beginning of the Armadillos"), labels.join(" | "));
    const prose = (title: RegExp) =>
      (folio.chapters.find((chapter) => title.test(chapter.title))?.blocks || [])
        .flatMap((block) => block.runs || [])
        .filter((run) => typeof run === "string")
        .join("\n");
    const rhino = prose(/rhinoceros/i);
    assert.match(rhino, /Once upon a time the story stays/);
    assert.equal(/HOW THE RHINOCEROS|HIS SKIN/.test(rhino), false);
    const beginning = prose(/armadillo/i);
    assert.equal(/\bOP\b/.test(beginning), false);
    assert.equal(/\bARMADILLOS\b/.test(beginning), false);
    assert.match(beginning, /tortoise stays/);
    const stave = prose(/butterfly/i);
    assert.match(stave, /THE LAST OF THE SPIRITS/);
    assert.equal(stave.includes("OP THE"), false);
    assert.match(stave, /OP\. CIT\./);
    assert.equal(/THE BUTTERFLY THAT\b/.test(stave), false);
    assert.match(stave, /phantom stays/);
  });

  it("starts a chapter at its heading when the contents page is still the previous chapter", () => {
    const lines: Line[] = [
      line("Contents", 1, 720),
      line("V. Advice from a Caterpillar .......... 3", 1, 680),
      line("VI. Pig and Pepper .......... 4", 1, 658),
      line("VII. A Mad Tea-Party .......... 9", 1, 636),
    ];
    for (const page of [3, 4, 5, 6, 7, 8, 9]) lines.push(line(String(page), page, 20));
    lines.push(
      line("CHAPTER V.", 3, 700, { h: 16 }),
      line("The caterpillar stays in this chapter.", 3, 640),
      line("That is not said right, said the Caterpillar.", 4, 640),
      line("The advice goes on for another page.", 5, 640),
      line("CHAPTER VI.", 8, 700, { h: 16 }),
      line("PIG AND PEPPER.", 8, 660),
      line("The pepper starts here.", 8, 600),
      line("CHAPTER VII.", 9, 700, { h: 16 }),
      line("The tea starts here.", 9, 640),
    );
    const folio = assembleFolio(lines, {
      title: "Alice",
      subtitle: "",
      sourceName: "early.pdf",
      emptyMessage: "empty",
      skipEpub: true,
      lexicon: { has: (word) => word.length >= 2 },
    });
    const pepper = folio.chapters.find((chapter) => /pepper/i.test(chapter.title));
    const caterpillar = folio.chapters.find((chapter) => /caterpillar/i.test(chapter.title));
    assert.equal(pepper?.blocks[0]?.src, 8);
    const pepperText = (pepper?.blocks || []).flatMap((block) => block.runs || []).join(" ");
    const earlier = (caterpillar?.blocks || []).flatMap((block) => block.runs || []).join(" ");
    assert.match(pepperText, /pepper starts/);
    assert.equal(pepperText.includes("not said right"), false);
    assert.match(earlier, /not said right/);
    assert.match(earlier, /caterpillar stays/);
  });

  it("drops a running head whose wording changes and keeps one sentence", () => {
    const lines: Line[] = [];
    for (const page of [1, 2, 3]) {
      lines.push(line("THE TARTS", page, 770, { pageH: 800 }));
      lines.push(line("The court of hearts goes on with the trial today.", page, 640, { pageH: 800 }));
    }
    lines.push(line("WHO STOLE THE TARTS f 163", 4, 770, { pageH: 800 }));
    lines.push(line("The trial sentence continues after the head.", 4, 640, { pageH: 800 }));
    lines.push(line("Who stole the tarts?", 5, 760, { pageH: 800 }));
    lines.push(line("That question is the whole of the evidence.", 5, 640, { pageH: 800 }));
    const folio = assembleFolio(lines, { title: "Trial", subtitle: "", sourceName: "t.pdf", emptyMessage: "empty", skipEpub: true });
    const prose = folio.chapters.flatMap((chapter) => chapter.blocks).flatMap((block) => block.runs || []).filter((run) => typeof run === "string").join(" ");
    assert.match(prose, /Who stole the tarts\?/);
    assert.equal(prose.includes("TARTS f"), false);
    assert.equal(prose.includes("THE TARTS"), false);
    assert.match(prose, /court of hearts/);
    assert.match(prose, /trial sentence continues/);
  });

  it("does not open the same book from a running head", () => {
    const page = { pageH: 428, pageW: 280 };
    const lines: Line[] = [
      line("BOOK IV", 10, 320, { ...page, h: 11 }),
      line("The mastery of the mind stays in this one book.", 10, 280, { ...page }),
    ];
    for (const [n, head] of [
      [11, "' BOOK IV"],
      [12, "BOOK IV ."],
      [13, ". BOOK IV"],
      [14, "BOOK VI ."],
    ] as const) {
      lines.push(line(head, n, 400, { ...page, h: 11 }));
      lines.push(line("The same book continues with another sentence here.", n, 280, { ...page }));
    }
    lines.push(line("BOOK V", 15, 320, { ...page, h: 11 }));
    lines.push(line("A later book starts once and only once.", 15, 280, { ...page }));
    const folio = assembleFolio(lines, { title: "Marcus", subtitle: "", sourceName: "m.pdf", emptyMessage: "empty", skipEpub: true });
    const labels = folio.toc.map((item) => item.label);
    assert.equal(labels.filter((label) => /book iv\b/i.test(label)).length, 1);
    assert.equal(labels.filter((label) => /book v\b/i.test(label)).length, 1);
    assert.equal(labels.some((label) => /book vi\b/i.test(label)), false);
    const prose = folio.chapters.flatMap((chapter) => chapter.blocks).flatMap((block) => block.runs || []).filter((run) => typeof run === "string").join(" ");
    assert.match(prose, /mastery of the mind/);
    assert.match(prose, /later book starts/);
    assert.equal(prose.includes("' BOOK"), false);
  });

  it("splits a full-width crib without joining it to the english", () => {
    const lines: Line[] = [];
    let y = 640;
    const band = ["one", "two", "three", "four", "five"];
    for (let n = 0; n < 5; n++) {
      lines.push(line(`iti akarnya atmanas putranam anadhigata line ${band[n]}`, 4, y, { h: 8.6, x0: 40, x1: 460 }));
      y -= 12;
      lines.push(line(`Ind karn with a Ger man note ${band[n]}`, 4, y, { h: 6.8, x0: 40, x1: 460 }));
      y -= 12;
      lines.push(line(`Thus having heard of himself of the sons ${band[n]}`, 4, y, { h: 8.1, x0: 40, x1: 460 }));
      y -= 16;
    }
    lines.push(line("iti akarnya the sanskrit line stays whole", 4, y, { h: 8.4, x0: 40, x1: 460 }));
    y -= 12;
    lines.push(line("Ind karn the grammar note stays whole", 4, y, { h: 6.1, x0: 40, x1: 460 }));
    y -= 11;
    lines.push(line("sg. m. N.sg. Par. stays", 4, y, { h: 7, x0: 40, x1: 145 }));
    y -= 12;
    lines.push(line("Thus the sense stays with the translation", 4, y, { h: 8.2, x0: 40, x1: 460 }));
    y -= 12;
    lines.push(line("whom", 4, y, { h: 11.2, x0: 40, x1: 67 }));
    const folio = assembleFolio(lines, { title: "Hitopadesa", subtitle: "", sourceName: "h.pdf", emptyMessage: "empty", skipEpub: true });
    const texts = folio.chapters.flatMap((chapter) => chapter.blocks).map((block) => (block.runs || []).filter((run) => typeof run === "string").join(" "));
    assert.equal(texts.some((text) => text.includes("Ind karn") && text.includes("Thus having")), false);
    assert.equal(texts.some((text) => text.includes("iti akarnya") && text.includes("Ind karn")), false);
    const grammar = texts.find((text) => text.includes("grammar note"));
    const english = texts.find((text) => text.includes("sense stays"));
    assert.match(grammar || "", /N\.sg\. Par\. stays/);
    assert.match(english || "", /\bwhom\b/);
    assert.equal((grammar || "").includes("sense stays"), false);
    assert.equal((english || "").includes("N.sg"), false);
  });

  it("keeps a contents title when the page number is glued on", () => {
    const lines: Line[] = [line("Contents", 2, 720)];
    const rows = [
      ["Mowgli's Brothers ..... 3", 3, "MOWGLI'S BROTHERS", "The brothers stay."],
      ["'Tiger! Tiger!' . . . . -87", 87, "TIGER! TIGER!", "The tiger stays."],
      ["The Beginning of the Armadillos . lOI", 101, "THE BEGINNING OF THE ARMADILLOS", "The armadillos stay."],
      ["How the First Letter was Written . 123", 123, "HOW THE FIRST LETTER WAS WRITTEN", "The letter stays."],
      ["The White Seal ... 127", 127, "THE WHITE SEAL", "The seal stays."],
    ] as const;
    rows.forEach(([row], index) => lines.push(line(row, 2, 680 - index * 22)));
    for (const [, page, head, body] of rows) {
      lines.push(line(String(page), page, 20));
      lines.push(line(head, page, 640, { h: 16 }));
      lines.push(line(body, page, 600));
    }
    const folio = assembleFolio(lines, { title: "Jungle", subtitle: "", sourceName: "j.pdf", emptyMessage: "empty", skipEpub: true });
    const labels = folio.toc.map((item) => item.label);
    assert.equal(labels.some((label) => /tiger! tiger!/i.test(label)), true);
    assert.equal(labels.some((label) => /armadillos/i.test(label)), true);
    assert.equal(labels.some((label) => /first letter/i.test(label)), true);
    assert.equal(labels.some((label) => /white seal/i.test(label)), true);
    assert.equal(labels.some((label) => /mowgli's song/i.test(label) && /white seal/i.test(label)), false);
    const tiger = folio.chapters.find((chapter) => /tiger/i.test(chapter.title));
    const seal = folio.chapters.find((chapter) => /white seal/i.test(chapter.title));
    const letter = folio.chapters.find((chapter) => /first letter/i.test(chapter.title));
    assert.match((tiger?.blocks || []).flatMap((block) => block.runs || []).join(" "), /tiger stays/);
    assert.equal((tiger?.blocks || []).flatMap((block) => block.runs || []).join(" ").includes("seal stays"), false);
    assert.match((seal?.blocks || []).flatMap((block) => block.runs || []).join(" "), /seal stays/);
    assert.match((letter?.blocks || []).flatMap((block) => block.runs || []).join(" "), /letter stays/);
  });

  it("does not take a publisher's list for the chapters", () => {
    const lines: Line[] = [
      line("Male .......... 3", 2, 680),
      line("One Act. By Mrs. Planche .......... 5", 2, 660),
      line("Female characters .......... 24", 2, 640),
      line("Female .......... 29", 2, 620),
      line("A preface stays in front.", 1, 400),
    ];
    for (const page of [3, 5, 24, 29]) lines.push(line(String(page), page, 20));
    lines.push(line("STAVE ONE.", 5, 640, { h: 16 }));
    lines.push(line("Marley was dead to begin with today.", 5, 600));
    lines.push(line("The register of his burial stays in the first stave.", 5, 580));
    lines.push(line("STAVE TWO.", 20, 640, { h: 16 }));
    lines.push(line("20", 20, 20));
    lines.push(line("The second stave stays in its own chapter.", 20, 600));
    const folio = assembleFolio(lines, { title: "Carol", subtitle: "", sourceName: "c.pdf", emptyMessage: "empty", skipEpub: true });
    const labels = folio.toc.map((item) => item.label);
    assert.equal(labels.includes("Male"), false);
    assert.equal(labels.includes("Female"), false);
    assert.equal(labels.some((label) => /planche/i.test(label)), false);
    assert.equal(labels.some((label) => /stave one/i.test(label)), true);
    assert.equal(labels.some((label) => /stave two/i.test(label)), true);
    const first = folio.chapters.find((chapter) => /stave one/i.test(chapter.title));
    const second = folio.chapters.find((chapter) => /stave two/i.test(chapter.title));
    assert.match((first?.blocks || []).flatMap((block) => block.runs || []).join(" "), /dead to begin/);
    assert.match((second?.blocks || []).flatMap((block) => block.runs || []).join(" "), /second stave stays/);
  });
});

describe("doubtful pages", () => {
  const folio = {
    title: "Body",
    subtitle: "",
    author: "",
    stats: { hyphensRejoined: 0, headersRemoved: 0, chapters: 1 },
    toc: [],
    chapters: [
      {
        id: "c01",
        title: "Chapter",
        page: 1,
        blocks: [
          { t: "p", src: 2, runs: ["The page before stays."] },
          { t: "p", src: 3, runs: ["x7 ## q q q !! 1l"] },
          { t: "p", src: 4, runs: ["The page after stays."] },
        ],
      },
    ],
    doubt: [
      { page: 3, sample: "x7" },
      { page: 9, sample: "later" },
    ],
  };

  it("replaces one doubtful page and leaves the others", () => {
    const next = applyPageReading(folio, 3, "The corrected page stays here.");
    const text = next.chapters[0].blocks.flatMap((block) => block.runs || []).join(" ");
    assert.match(text, /corrected page/);
    assert.equal(text.includes("1l"), false);
    assert.match(text, /page before/);
    assert.match(text, /page after/);
    assert.deepEqual(next.doubt, [{ page: 9, sample: "later" }]);
    assert.equal(keepDoubtPage(next, 9).doubt, undefined);
  });

  it("leaves a short title and a real sentence, and flags a broken page", () => {
    assert.equal(looksDoubtful("Chapter I"), false);
    assert.equal(looksDoubtful("The mind is the forerunner of all things and it stays a sentence."), false);
    assert.equal(looksDoubtful(`${"x7 ## q q q !! 1l 1l ".repeat(6)}broken page`), true);
    const list = { has: (word: string) => word === "the" || word === "page" || word === "stays" };
    const quiet = {
      ...folio,
      chapters: [{ ...folio.chapters[0], blocks: [{ t: "p", src: 3, runs: ["The page stays."] }] }],
    };
    assert.equal(correctPageWords(quiet, 3, list), null);
  });
});

describe("plain reading", () => {
  it("leaves a split word until a word list is used", () => {
    const lines: Line[] = [line("The con-", 1, 640), line("scious mind stays.", 1, 620)];
    const plain = assembleFolio(lines, { title: "Plain", subtitle: "", sourceName: "plain.pdf", emptyMessage: "empty", skipEpub: true });
    const plainText = plain.chapters.flatMap((chapter) => chapter.blocks).flatMap((block) => block.runs || []).filter((run) => typeof run === "string").join(" ");
    assert.match(plainText, /con-/);
    assert.equal(plain.stats.hyphensRejoined, 0);
    const fixed = assembleFolio(lines, {
      title: "Plain",
      subtitle: "",
      sourceName: "plain.pdf",
      emptyMessage: "empty",
      skipEpub: true,
      lexicon: { has: (word) => word === "conscious" || word === "mind" || word === "stays" },
    });
    const fixedText = fixed.chapters.flatMap((chapter) => chapter.blocks).flatMap((block) => block.runs || []).filter((run) => typeof run === "string").join(" ");
    assert.match(fixedText, /conscious/);
    assert.equal(fixed.stats.hyphensRejoined, 1);
  });

  it("follows the body when a contents list does not open the chapters", () => {
    const lines: Line[] = [];
    for (let n = 1; n <= 4; n++) {
      const page = 10 + n;
      lines.push(line(`CHAPTER ${["I", "II", "III", "IV"][n - 1]}`, page, 700, { h: 16, x0: 250, x1: 370 }));
      lines.push(line(`The body of chapter ${n} stays on its own page here.`, page, 640));
    }
    const folio = assembleFolio(lines, {
      title: "Body",
      subtitle: "",
      sourceName: "body.pdf",
      emptyMessage: "empty",
      skipEpub: true,
      outline: [1, 2, 3, 4].map((n) => ({ label: `Chapter ${n} - Missing`, page: 1, children: [] })),
    });
    const text = (title: RegExp) =>
      (folio.chapters.find((chapter) => title.test(chapter.title))?.blocks || [])
        .flatMap((block) => block.runs || [])
        .filter((run) => typeof run === "string")
        .join(" ");
    assert.match(text(/^Chapter I\b/), /chapter 1 stays/);
    assert.doesNotMatch(text(/^Chapter I\b/), /chapter 2 stays/);
    assert.equal(folio.chapters.some((chapter) => /Missing/.test(chapter.title)), false);
  });

  it("keeps an interior heading inside a lecture", () => {
    const lines: Line[] = [];
    for (const [n, roman, page] of [
      ["1", "I", 3],
      ["2", "II", 5],
      ["3", "III", 7],
    ] as const) {
      lines.push(line(String(page), page, 20));
      lines.push(line(`LECTURE ${roman}`, page, 700, { h: 18, x0: 250, x1: 370 }));
      lines.push(line(`THE SUBJECT OF LECTURE ${n}`, page, 670, { h: 14, x0: 150, x1: 470 }));
      lines.push(line(`The body of lecture ${n} stays on its own page here.`, page, 600));
      lines.push(line("THE INNER HEADING", page, 540, { h: 20, x0: 200, x1: 420 }));
      lines.push(line(`The inner heading of lecture ${n} stays in the lecture.`, page, 500));
    }
    const folio = assembleFolio(lines, { title: "Lectures", subtitle: "", sourceName: "lectures.pdf", emptyMessage: "empty", skipEpub: true });
    const titles = folio.chapters.map((chapter) => chapter.title);
    assert.equal(titles.some((title) => /inner heading/i.test(title)), false);
    assert.ok(titles.some((title) => /^Lecture I\b/.test(title)), titles.join(" | "));
    assert.ok(titles.some((title) => /^Lecture II\b/.test(title)), titles.join(" | "));
    assert.ok(titles.some((title) => /^Lecture III\b/.test(title)), titles.join(" | "));
    const text = (title: RegExp) =>
      (folio.chapters.find((chapter) => title.test(chapter.title))?.blocks || [])
        .flatMap((block) => block.runs || [])
        .filter((run) => typeof run === "string")
        .join(" ");
    assert.match(text(/^Lecture I\b/), /inner heading of lecture 1/);
    assert.doesNotMatch(text(/^Lecture I\b/), /lecture 2 stays/);
  });

  it("reads a numbered contents list that has no page numbers", () => {
    const lines: Line[] = [line("Contents", 2, 740)];
    const titles = [
      "Implications of a Catholic Practice",
      "Theological Premises for the Person",
      "Christian Advantages for Practice",
      "Modern Personality Theories Today",
      "Basic Psychological Support Today",
      "Integrated Laminate of the Person",
      "Methodology and Presuppositions Today",
      "Personal Wholeness and Unity Today",
    ];
    lines.push(line("Part I. The Opening", 2, 720));
    titles.forEach((title, index) => {
      lines.push(line(`${index + 1}. ${title}`, 2, 700 - index * 18));
    });
    lines.push(line("Chapter 2 - Theological Premises for the Person", 6, 700, { h: 18, x0: 80, x1: 520 }));
    lines.push(line("The body of the second chapter stays here in full.", 6, 640));
    for (let n = 0; n < 12; n++) lines.push(line("of our skills allowing us to recognize other", 8, 700 - n * 16));
    const folio = assembleFolio(lines, { title: "Meta", subtitle: "", sourceName: "meta.pdf", emptyMessage: "empty", skipEpub: true });
    const shown = (folio.chapters.find((chapter) => chapter.id === "contents")?.blocks || [])
      .filter((block) => block.t === "toc-entry")
      .map((block) => block.s || "");
    assert.ok(shown.some((label) => label.startsWith("1. Implications")), shown.join(" | "));
    assert.ok(shown.some((label) => /Part I/.test(label)), shown.join(" | "));
    assert.equal(folio.chapters.some((chapter) => /of our skills/.test(chapter.title)), false);
    const linked = folio.chapters.find((chapter) => chapter.id === "contents")?.blocks.find((block) => /Theological Premises/.test(block.s || ""));
    assert.ok(linked?.id, shown.join(" | "));
    const host = folio.chapters.find((chapter) => chapter.id === linked?.id);
    assert.match((host?.blocks || []).flatMap((block) => block.runs || []).join(" "), /second chapter stays/);
  });

  it("keeps a wrapped contents author and does not link an excerpt", () => {
    const lines: Line[] = [line("Contents", 2, 740, { x0: 60 })];
    lines.push(line("Part I. The Opening", 2, 720, { x0: 60 }));
    lines.push(line("1. Implications of a Catholic Christian Meta-Model of the Person for Mental Health Practice: Orientation and", 2, 700, { x0: 60, x1: 520 }));
    lines.push(line("Introductory Comments. W. J. Nordling, P. C. Vitz, C. S. Titus, & the DMU Group", 2, 682, { x0: 99, x1: 460 }));
    lines.push(line("2. Theological, Philosophical, and Psychological Premises for a Catholic Christian Meta-Model of the Person.", 2, 660, { x0: 60, x1: 520 }));
    lines.push(line("C. S. Titus, P. C. Vitz, W. J. Nordling, & the DMU Group", 2, 642, { x0: 96, x1: 420 }));
    lines.push(line("3. Man and Woman", 2, 620, { x0: 60, x1: 200 }));
    lines.push(line("C. Gross, L. Klewicki, P. C. Vitz, & C. S. Titus", 2, 602, { x0: 98, x1: 360 }));
    lines.push(line("4. Ful illed through Vocation. C. S. Titus", 2, 580, { x0: 60, x1: 400 }));
    for (let n = 5; n <= 8; n++) lines.push(line(`${n}. A Later Chapter About Practice`, 2, 560 - n * 16, { x0: 60, x1: 360 }));
    lines.push(line("The following text identifies four ways that the Catholic Christian Meta-Model of the Person", 5, 700));
    lines.push(line("(Excerpt from Chapter 1)", 5, 670));
    lines.push(line("The Psychological Premises of the Person are III. The person, with the help of others,", 4, 700));
    lines.push(line("consistent with the Theological and Philosophical premises of the model.", 4, 680));
    lines.push(line("Psychological Premises of the Person", 6, 700, { h: 16, x0: 80, x1: 480 }));
    lines.push(line("(Excerpt from Chapter 2)", 6, 670));
    lines.push(line("Chapter 2 - Theological, Philosophical, and Psychological Premises", 9, 700, { h: 18, x0: 80, x1: 540 }));
    lines.push(line("The body of the second chapter stays here in full.", 9, 640));
    for (let n = 0; n < 12; n++) lines.push(line("of our skills allowing us to recognize other", 8, 700 - n * 16));
    const folio = assembleFolio(lines, { title: "Meta", subtitle: "", sourceName: "meta.pdf", emptyMessage: "empty", skipEpub: true });
    const entries = (folio.chapters.find((chapter) => chapter.id === "contents")?.blocks || []).filter((block) => block.t === "toc-entry");
    const label = (start: RegExp) => entries.find((block) => start.test(block.s || ""));
    const first = label(/^1\. /);
    const second = label(/^2\. /);
    const third = label(/^3\. /);
    assert.match(first?.s || "", /DMU Group$/);
    assert.equal(first?.id, undefined);
    assert.match(second?.s || "", /DMU Group$/);
    assert.match(third?.s || "", /C\. Gross/);
    assert.match(label(/^4\. /)?.s || "", /Fulfilled through Vocation/);
    const host = folio.chapters.find((chapter) => chapter.id === second?.id);
    assert.match(host?.title || "", /^Chapter 2\b/);
    assert.match((host?.blocks || []).flatMap((block) => block.runs || []).join(" "), /second chapter stays/);
    assert.equal(folio.chapters.some((chapter) => /Excerpt from Chapter/.test(chapter.title)), false);
  });
});

describe("links and pictures", () => {
  it("unwraps a redirect and refuses a script address", () => {
    assert.equal(safeHref("https://www.google.com/url?q=http%3A%2F%2Flogeion.uchicago.edu%2F&sa=D&usg=abc"), "http://logeion.uchicago.edu/");
    assert.equal(safeHref("javascript:alert(1)"), "");
    assert.equal(safeHref("https://www.google.com/url?q=javascript%3Aalert(1)"), "");
  });

  it("links only the words the rectangle covers", () => {
    const glyphs = paintLinks(
      [
        {
          str: "Logeion - many dictionaries in usable format",
          transform: [11, 0, 0, 11, 108, 64],
          width: 420,
          height: 11,
        },
      ],
      [{ x0: 108, y0: 60, x1: 160, y1: 76, href: "https://logeion.uchicago.edu/" }],
    );
    const linked = glyphs.filter((glyph) => glyph.href);
    assert.equal(linked.length, 1);
    assert.match(linked[0].str, /Logeion/);
    assert.doesNotMatch(linked[0].str, /dictionaries/);
    const line = cluster(glyphs)[0];
    assert.match(line?.spans?.find((span) => span.href)?.text || "", /Logeion/);
    assert.equal(line?.spans?.some((span) => !span.href && /dictionaries/.test(span.text)), true);
    const above = paintLinks(
      [
        { str: "Beginner vocabulary", transform: [13, 0, 0, 13, 124, 77], width: 160, height: 13 },
        { str: "Logeion is a dictionary", transform: [11, 0, 0, 11, 108, 64], width: 180, height: 11 },
      ],
      [
        { x0: 124, y0: 73.5, x1: 300, y1: 89, href: "folio:16" },
        { x0: 108, y0: 60.75, x1: 151, y1: 75, href: "http://logeion.uchicago.edu/" },
      ],
    );
    assert.equal(above.find((glyph) => /Beginner/.test(glyph.str))?.href, "folio:16");
    assert.equal(above.find((glyph) => /Logeion/.test(glyph.str))?.href, "http://logeion.uchicago.edu/");
  });

  it("keeps a linked title and a small picture, and drops a repeated running head", () => {
    const reading = line("Logeion is the first dictionary.", 1, 400, { x0: 72, x1: 420 });
    reading.spans = [
      { text: "Logeion", href: "https://logeion.uchicago.edu/" },
      { text: "is the first dictionary." },
    ];
    const picture = line(" ", 1, 260, { x0: 80, x1: 200, h: 120 });
    picture.plate = { data: "data:image/png;base64,AAAA", w: 48, h: 48 };
    const folio = assembleFolio([reading, picture], { title: "Links", subtitle: "", sourceName: "links.pdf", emptyMessage: "empty", skipEpub: true });
    const blocks = folio.chapters.flatMap((chapter) => chapter.blocks);
    const linked = blocks.flatMap((block) => block.runs || []).find((run) => typeof run === "object" && run && "href" in run);
    assert.equal(linked && "href" in linked ? linked.href : "", "https://logeion.uchicago.edu/");
    assert.match(linked && "a" in linked ? linked.a : "", /Logeion/);
    assert.equal(blocks.some((block) => block.t === "img" && block.w === 48), true);
    const head: ImageUse = { page: 1, x: 20, y: 760, w: 500, h: 30, nativeW: 100, nativeH: 10, pageH: 800 };
    const icon: ImageUse = { page: 1, x: 80, y: 400, w: 16, h: 16, nativeW: 16, nativeH: 16, pageH: 800 };
    const images: PdfImage[] = [
      { w: 100, h: 10, url: "data:image/jpeg;base64,QQ" },
      { w: 16, h: 16, url: "data:image/png;base64,QQ" },
    ];
    const uses = [1, 2, 3, 4, 5].map((page) => ({ ...head, page }));
    const kept = contentPlates([...uses, icon], images, 5);
    assert.deepEqual(kept.map((plate) => plate.w), [16]);
  });

  it("keeps the space between a link and the words beside it", () => {
    const reading = line("Gaffiot and LaNe mark length.", 1, 400);
    reading.spans = [
      { text: "Gaffiot ", href: "https://example.com/gaffiot" },
      { text: "and " },
      { text: "LaNe ", href: "https://example.com/lane" },
      { text: "mark length." },
    ];
    const folio = assembleFolio([reading], { title: "Links", subtitle: "", sourceName: "links.pdf", emptyMessage: "empty", skipEpub: true });
    const text = folio.chapters.flatMap((chapter) => chapter.blocks).flatMap((block) => block.runs || []).map((run) => runText(run)).join("");
    assert.equal(text, "Gaffiot and LaNe mark length.");
    const upper = line("Beginner vocabulary lists here", 1, 80);
    upper.spans = [{ text: "Beginner vocabulary lists here", href: "folio:16" }];
    const lower = line("Logeion is a dictionary.", 1, 72);
    lower.spans = [
      { text: "Logeion ", href: "http://logeion.uchicago.edu/" },
      { text: "is a dictionary." },
    ];
    const joined = assembleFolio([upper, lower], { title: "Links", subtitle: "", sourceName: "links.pdf", emptyMessage: "empty", skipEpub: true });
    const paras = joined.chapters.flatMap((chapter) => chapter.blocks).filter((block) => block.t === "p").map((block) => (block.runs || []).map((run) => runText(run)).join(""));
    assert.equal(paras.some((para) => /here Logeion is a dictionary/.test(para)), true);
  });

  it("reads a jpeg and a compressed gray picture out of a file", () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
    const gray = zlibSync(Uint8Array.of(255));
    const dict = (body: string, stream: Uint8Array) => {
      const head = new TextEncoder().encode(`${body}/Length ${stream.length}>>stream\n`);
      const tail = new TextEncoder().encode("\nendstream endobj\n");
      const out = new Uint8Array(head.length + stream.length + tail.length);
      out.set(head);
      out.set(stream, head.length);
      out.set(tail, head.length + stream.length);
      return out;
    };
    const a = dict("<</Subtype/Image/Width 1/Height 1/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode", jpeg);
    const b = dict("<</Subtype/Image/Width 1/Height 1/ColorSpace/DeviceGray/BitsPerComponent 8/Filter/FlateDecode", gray);
    const file = new Uint8Array(a.length + b.length);
    file.set(a);
    file.set(b, a.length);
    const images = imagesInPdf(file);
    assert.equal(images.length, 2);
    assert.match(images[0].url, /^data:image\/jpeg;base64,/);
    assert.match(images[1].url, /^data:image\/png;base64,/);
    const packed = epubArchive(
      {
        title: "Pictures",
        subtitle: "",
        author: "",
        stats: { hyphensRejoined: 0, headersRemoved: 0, chapters: 1 },
        toc: [{ id: "c01", label: "Pictures", page: 1, children: [] }],
        chapters: [
          {
            id: "c01",
            title: "Pictures",
            page: 1,
            blocks: [
              { t: "h1", id: "c01", s: "Pictures", page: 1, src: 1 },
              { t: "p", runs: [{ a: "Logeion", href: "https://logeion.uchicago.edu/" }, " stays."], page: 1, src: 1 },
              { t: "img", img: images[0].url, w: 12, page: 1, src: 1 },
            ],
          },
        ],
      },
      "pictures.pdf",
    );
    const opened = unzipSync(packed);
    const xhtml = new TextDecoder().decode(opened["OEBPS/text/c01.xhtml"]);
    assert.match(xhtml, /href="https:\/\/logeion\.uchicago\.edu\/"/);
    assert.match(xhtml, /src="\.\.\/img\/p1\.jpg"/);
    assert.ok(opened["OEBPS/img/p1.jpg"]?.length);
    assert.match(runText({ a: "Logeion", href: "https://logeion.uchicago.edu/" }), /Logeion/);
  });
});

describe("verse and columns", () => {
  it("keeps a printed poem as lines", () => {
    const rows: [string, number, number, number][] = [
      ["KABIR'S POEMS", 429, 79, 196],
      ["I. 13. mo ko kahdn dhinro bande", 387, 52, 227],
      ["SERVANT, where dost thou", 370, 76, 240],
      ["seek Me?", 355, 76, 121],
      ["Lo! I am beside thee.", 340, 40, 152],
      ["I am neither in temple nor in mosque:", 325, 40, 238],
      ["I am neither in Kaaba nor in", 310, 64, 242],
      ["Kailash:", 295, 64, 104],
      ["Neither am I in rites and ceremonies,", 280, 40, 238],
      ["nor in Yoga and renunciation.", 266, 63, 216],
      ["If thou art a true seeker, thou shalt at", 251, 40, 241],
      ["once see Me: thou shalt meet Me", 236, 63, 239],
      ["in a moment of time.", 221, 63, 170],
      ["Kabir says, “O Sadhu! God is the", 207, 40, 240],
      ["breath of all breath.”", 192, 63, 171],
    ];
    const lines = rows.map(([text, y, x0, x1]) => line(text, 53, y, { x0, x1, h: 11, pageW: 317, pageH: 516 }));
    const folio = assembleFolio(lines, { title: "Kabir", subtitle: "", sourceName: "kabir.pdf", emptyMessage: "empty", skipEpub: true });
    const texts = folio.chapters.flatMap((chapter) => chapter.blocks).map((block) => (block.s || (block.runs || []).map(runText).join(" ")).replace(/\s+/g, " ").trim());
    assert.equal(texts.includes("seek Me?"), true);
    assert.equal(texts.includes("Kailash:"), true);
    assert.equal(texts.some((text) => text.includes("seek Me?") && text.includes("beside thee")), false);
    assert.match(folio.warning || "", /verse/);
    const prose = Array.from({ length: 10 }, (_, n) =>
      line(`The introduction keeps this full line of prose on the page, sentence ${n}.`, 2, 700 - n * 14, { x0: 76, x1: 280, h: 11, pageW: 317, pageH: 516 }),
    );
    const book = assembleFolio(prose, { title: "Prose", subtitle: "", sourceName: "p.pdf", emptyMessage: "empty", skipEpub: true });
    const joined = book.chapters.flatMap((chapter) => chapter.blocks).map((block) => (block.runs || []).map(runText).join(" ")).join(" ");
    assert.match(joined, /sentence 0[\s\S]*sentence 3/);
    assert.doesNotMatch(book.warning || "", /verse/);
  });

  it("reads a column gutter down the page", () => {
    const items: { str: string; transform: number[]; width: number; height: number }[] = [];
    for (let n = 0; n < 8; n++) {
      const y = 700 - n * 14;
      // Word spaces of 6pt and a gutter of 12.6pt, as on a 1911 encyclopedia page.
      const left = [
        [`Left${n}`, 36, 40],
        ["sentence", 82, 52],
        ["stays", 140, 36],
        ["here", 182, 28],
      ] as const;
      const right = [
        [`Right${n}`, 222.6, 44],
        ["column", 272.6, 48],
        ["follows", 326.6, 46],
        ["after", 378.6, 34],
      ] as const;
      for (const [str, x, width] of [...left, ...right]) items.push({ str, transform: [10, 0, 0, 10, x, y], width, height: 10 });
    }
    const lines = cluster(items).map((ln) => ({ ...ln, page: 1, pageH: 792, pageW: 560, h: ln.h || 10 }));
    const folio = assembleFolio(lines, { title: "Columns", subtitle: "", sourceName: "eb.pdf", emptyMessage: "empty", skipEpub: true });
    const blocks = folio.chapters.flatMap((chapter) => chapter.blocks);
    const textOf = (block: (typeof blocks)[number]) => (block.runs || []).map(runText).join(" ");
    const text = blocks.map(textOf).join(" ");
    assert.ok(text.indexOf("Left0") < text.indexOf("Left7"));
    assert.ok(text.indexOf("Left7") < text.indexOf("Right0"));
    assert.equal(blocks.some((block) => textOf(block).includes("here Right0")), false);
    assert.match(folio.warning || "", /column/);
  });

  it("keeps a citation from becoming a section", () => {
    const lines: Line[] = [];
    for (let n = 0; n < 5; n++) lines.push(line(`The river keeps this full sentence number ${n} in the paragraph.`, 1, 720 - n * 14));
    lines.push(line("d. Kant. Argau (fine illustrated work on castles), Aarau, 2 vols.,", 1, 620));
    lines.push(line("E. Zschokke, Geschichte des Aargaus, Aarau, 1903.", 1, 560));
    for (let n = 0; n < 4; n++) lines.push(line(`The town kept its harbour after that note, sentence ${n}.`, 1, 500 - n * 14));
    const folio = assembleFolio(lines, { title: "Cite", subtitle: "", sourceName: "c.pdf", emptyMessage: "empty", skipEpub: true });
    const blocks = folio.chapters.flatMap((chapter) => chapter.blocks);
    const heads = blocks.filter((block) => block.t === "h2").map((block) => block.s || "");
    assert.equal(heads.some((label) => /Kant|Zschokke/.test(label)), false);
    const prose = blocks.filter((block) => block.t === "p").map((block) => (block.runs || []).map(runText).join(" ")).join(" ");
    assert.match(prose, /Kant/);
    assert.match(prose, /Zschokke/);
  });

  it("does not drop a hyphen into a fragment from the other column", () => {
    const items: { str: string; transform: number[]; width: number; height: number }[] = [];
    for (let n = 0; n < 8; n++) {
      const y = 700 - n * 14;
      const left = [
        [`Left${n}`, 36, 48],
        ["of", 90, 18],
        [n === 3 ? "con-" : "words", 114, 127],
      ] as const;
      const right =
        n === 3
          ? ([["from", 253, 28]] as const)
          : ([
              [`Right${n}`, 253, 48],
              ["column", 307, 50],
              ["follows", 363, 48],
              ["after", 417, 36],
            ] as const);
      for (const [str, x, width] of [...left, ...right]) items.push({ str, transform: [10, 0, 0, 10, x, y], width, height: 10 });
    }
    items.push({ str: "struction", transform: [10, 0, 0, 10, 36, 651], width: 70, height: 10 });
    const lines = cluster(items).map((ln) => ({ ...ln, page: 1, pageH: 792, pageW: 560, h: ln.h || 10 }));
    const folio = assembleFolio(lines, { title: "Columns", subtitle: "", sourceName: "eb.pdf", emptyMessage: "empty", skipEpub: true });
    const blocks = folio.chapters.flatMap((chapter) => chapter.blocks);
    const textOf = (block: (typeof blocks)[number]) => (block.runs || []).map(runText).join(" ");
    assert.equal(blocks.some((block) => textOf(block).includes("con- from")), false);
    assert.match(blocks.map(textOf).join(" "), /construction|con- struction/);
  });

  it("keeps a lettered plan label in the sentence", () => {
    const lines: Line[] = [];
    for (let n = 0; n < 4; n++) lines.push(line(`The abbey kept this sentence of the description ${n}.`, 1, 720 - n * 14));
    lines.push(line("C. Corridor, with cells on each side. The general appearance of", 1, 620));
    lines.push(line("A. DEFINITION OF SOUL", 1, 560, { h: 13 }));
    for (let n = 0; n < 3; n++) lines.push(line(`The cloister stayed in the paragraph after the label ${n}.`, 1, 500 - n * 14));
    const folio = assembleFolio(lines, { title: "Abbey", subtitle: "", sourceName: "a.pdf", emptyMessage: "empty", skipEpub: true });
    const blocks = folio.chapters.flatMap((chapter) => chapter.blocks);
    const heads = blocks.filter((block) => block.t === "h2").map((block) => block.s || "");
    assert.equal(heads.some((label) => /Corridor/.test(label)), false);
    assert.ok(heads.some((label) => /definition of soul/i.test(label)));
    const prose = blocks.filter((block) => block.t === "p").map((block) => (block.runs || []).map(runText).join(" ")).join(" ");
    assert.match(prose, /Corridor/);
  });

  it("keeps a plate key from becoming sections", () => {
    const lines: Line[] = [];
    for (let n = 0; n < 3; n++) lines.push(line(`The plan of the abbey is described in sentence ${n}.`, 1, 720 - n * 14));
    const keys = [
      "C. Corridor, with cells on each side.",
      "D. Staircase.",
      "O. Sacristy and vestry.",
      "R. Bakehouse for sacramental",
    ];
    keys.forEach((text, n) => lines.push(line(text, 1, 640 - n * 36)));
    for (let n = 0; n < 3; n++) lines.push(line(`The cloister note stays in the prose ${n}.`, 1, 460 - n * 14));
    const folio = assembleFolio(lines, { title: "Plan", subtitle: "", sourceName: "plan.pdf", emptyMessage: "empty", skipEpub: true });
    const heads = folio.chapters.flatMap((chapter) => chapter.blocks).filter((block) => block.t === "h2").map((block) => block.s || "");
    assert.equal(heads.some((label) => /Bakehouse|Corridor|Sacristy/.test(label)), false);
  });

  it("reads a nearly full poem line by line", () => {
    const rows: [string, number][] = [
      ["makes me to hear the Unstruck", 275],
      ["Music:", 133],
      ["He shows joy and sorrow to be one", 264],
      ["He fills all utterance with love.", 248],
      ["Kabir says the seeker has no fear", 278],
      ["who has such a Guru to lead him", 271],
      ["to the shelter of safety today", 236],
      ["HE shadows of evening fall thick", 277],
      ["and deep, and the darkness of love", 270],
      ["envelops the body and the mind.", 262],
      ["Open the window to the west now", 278],
      ["lost in the sky of love", 214],
      ["Drink the sweet honey of the heart", 274],
      ["Receive the waves in your body", 268],
      ["splendour is in the region of the", 255],
      ["sea!", 121],
    ];
    const lines = rows.map(([text, x1], n) => line(text, 80, 420 - n * 14, { x0: 70, x1, h: 11, pageW: 317, pageH: 516 }));
    const folio = assembleFolio(lines, { title: "Kabir", subtitle: "", sourceName: "kabir.pdf", emptyMessage: "empty", skipEpub: true });
    const blocks = folio.chapters.flatMap((chapter) => chapter.blocks);
    const textOf = (block: (typeof blocks)[number]) => ((block.s || (block.runs || []).map(runText).join(" ")).replace(/\s+/g, " ").trim());
    assert.match(folio.warning || "", /verse/);
    const music = blocks.find((block) => textOf(block) === "Music:");
    assert.equal(music ? textOf(music) : "", "Music:");
    assert.equal(blocks.some((block) => textOf(block).includes("Music:") && textOf(block).includes("He shows")), false);
  });

  it("keeps a play's speeches apart", () => {
    const rows: [string, number, number, number][] = [
      ["Nora. There is a crown. No, keep the change.", 400, 52, 251],
      ["[The Porter thanks her and goes. Nora shuts the door.", 386, 43, 278],
      ["She continues smiling as she takes off her outdoor things.]", 372, 61, 220],
      ["Nora. Yes, he is at home.", 358, 51, 159],
      ["Helmer (in his room). Is that my lark twittering there?", 344, 51, 277],
      ["Nora. Just this minute. (Hides the bag of macaroons", 330, 51, 278],
      ["in her pocket.) Come here, Torvald, and see what I bought.", 316, 41, 200],
      ["Helmer. Don't interrupt me. (A little later he opens", 302, 51, 277],
      ["the door and looks in, pen in hand.)", 288, 41, 180],
      ["Nora. Why, Torvald, surely we can afford to launch", 274, 50, 277],
      ["out a little now that Christmas is here.", 260, 41, 190],
      ["Helmer. Come, come; we can't afford to squander.", 246, 50, 260],
      ["Nora. Oh yes, Torvald, do let us squander a little.", 232, 50, 270],
      ["Helmer. Nora! Still my little featherbrain.", 218, 50, 240],
    ];
    const lines = rows.map(([text, y, x0, x1]) => line(text, 12, y, { x0, x1, h: 7, pageW: 321, pageH: 440 }));
    const folio = assembleFolio(lines, { title: "Doll", subtitle: "", sourceName: "doll.pdf", emptyMessage: "empty", skipEpub: true });
    const blocks = folio.chapters.flatMap((chapter) => chapter.blocks);
    const textOf = (block: (typeof blocks)[number]) => ((block.s || (block.runs || []).map(runText).join(" ")).replace(/\s+/g, " ").trim());
    const texts = blocks.map(textOf);
    assert.doesNotMatch(folio.warning || "", /verse/);
    assert.equal(texts.some((text) => text.includes("[The Porter thanks her")), true);
    assert.equal(texts.some((text) => text.includes("outdoor things.]")), true);
    assert.equal(texts.some((text) => text.includes("Hides the bag") && text.includes("in her pocket")), true);
    assert.equal(texts.some((text) => text.includes("Don't interrupt") && text.includes("pen in hand")), true);
    assert.equal(texts.some((text) => text.includes("lark twittering") && text.includes("Just this minute")), false);
    assert.equal(texts.some((text) => text.includes("keep the change") && text.includes("Porter thanks")), false);
  });

  it("keeps a capital-letter speech with its next line", () => {
    const rows: [string, number, number, number][] = [
      ["NORA. There is a crown. No, keep the change.", 400, 52, 251],
      ["HELMER. Is that my lark twittering there?", 372, 51, 277],
      ["NORA. Just this minute. Come here, Torvald,", 344, 51, 278],
      ["and see what I have been buying.", 330, 41, 200],
      ["HELMER. Don't interrupt me.", 316, 51, 220],
      ["NORA. Why, Torvald, we can afford it.", 302, 50, 250],
      ["HELMER. Come, come; we can't afford to squander.", 288, 50, 270],
      ["NORA. Oh yes, do let us squander a little.", 274, 50, 260],
      ["HELMER. Nora! Still my little featherbrain.", 260, 50, 240],
      ["NORA. Yes, he is at home.", 246, 51, 159],
      ["HELMER. When did the squirrel get home?", 232, 51, 250],
      ["NORA. Yes!", 218, 51, 99],
      ["HELMER. Don't interrupt the work.", 204, 51, 230],
      ["NORA. I only came to show you this.", 190, 50, 240],
    ];
    const lines = rows.map(([text, y, x0, x1]) => line(text, 12, y, { x0, x1, h: 7, pageW: 321, pageH: 440 }));
    const folio = assembleFolio(lines, { title: "Doll", subtitle: "", sourceName: "doll.pdf", emptyMessage: "empty", skipEpub: true });
    const blocks = folio.chapters.flatMap((chapter) => chapter.blocks);
    const textOf = (block: (typeof blocks)[number]) => ((block.s || (block.runs || []).map(runText).join(" ")).replace(/\s+/g, " ").trim());
    const texts = blocks.map(textOf);
    assert.doesNotMatch(folio.warning || "", /verse/);
    assert.equal(texts.some((text) => text.includes("Come here, Torvald") && text.includes("been buying")), true);
    assert.equal(texts.some((text) => text.includes("lark twittering") && text.includes("Just this minute")), false);
  });

  it("reads a tight poem line by line", () => {
    const page = { h: 11, pageW: 333, pageH: 527 };
    const rows: [string, number, number][] = [
      ["They are angry, for they do not want", 98, 298],
      ["me to go, and they say she thinks", 122, 299],
      ["she has gained such dominion", 122, 300],
      ["over her husband that she wishes", 122, 300],
      ["and therefore she is impatient", 122, 299],
      ["to go to him.", 122, 180],
      ["Dear friend, lift my veil lightly now", 98, 298],
      ["for this is the night of love.", 122, 265],
      ["Kabir says my heart is eager", 98, 299],
      ["to meet my lover on the bed.", 122, 290],
      ["LXXXVI", 173, 218],
      ["III. 96. jiv mahal men Siv pahunwa", 98, 297],
      ["Do not act the part of a madman", 98, 299],
      ["for the night is thickening fast.", 122, 266],
      ["He has awaited me for ages", 98, 300],
      ["and the morning is already here.", 122, 280],
    ];
    const lines = rows.map(([text, x0, x1], n) => line(text, 140, 460 - n * 15, { ...page, x0, x1 }));
    const folio = assembleFolio(lines, { title: "Kabir", subtitle: "", sourceName: "kabir.pdf", emptyMessage: "empty", skipEpub: true });
    const blocks = folio.chapters.flatMap((chapter) => chapter.blocks);
    const textOf = (block: (typeof blocks)[number]) => ((block.s || (block.runs || []).map(runText).join(" ")).replace(/\s+/g, " ").trim());
    assert.match(folio.warning || "", /verse/);
    assert.equal(blocks.some((block) => textOf(block) === "me to go, and they say she thinks"), true);
    assert.equal(blocks.some((block) => textOf(block).includes("do not want") && textOf(block).includes("me to go")), false);
    const prose = Array.from({ length: 14 }, (_, n) =>
      line(`The introduction keeps this full line of prose on the page, sentence ${n}.`, 2, 700 - n * 14, { x0: 89, x1: 290, h: 11, pageW: 333, pageH: 527 }),
    );
    const book = assembleFolio(prose, { title: "Prose", subtitle: "", sourceName: "p.pdf", emptyMessage: "empty", skipEpub: true });
    const joined = book.chapters.flatMap((chapter) => chapter.blocks).map((block) => (block.runs || []).map(runText).join(" ")).join(" ");
    assert.match(joined, /sentence 0[\s\S]*sentence 3/);
    assert.doesNotMatch(book.warning || "", /verse/);
  });

  it("keeps a contributor with the articles signed", () => {
    const page = { h: 8, pageW: 553, pageH: 744 };
    const lines: Line[] = [
      line("c. F. R. Charles F. Richardson, Ph.D.", 25, 700, { ...page, x0: 12, x1: 460 }),
      line("Professor of English, Dartmouth College.", 25, 688, { ...page, x0: 93, x1: 460 }),
      line("c. Pf. Christian Pfister, D. es L. , f", 25, 660, { ...page, x0: 12, x1: 420 }),
      line("Professor at the Sorbonne, Paris. Author of Alcuin.", 25, 648, { ...page, x0: 93, x1: 450 }),
    ];
    const folio = assembleFolio(lines, { title: "Initials", subtitle: "", sourceName: "eb.pdf", emptyMessage: "empty", skipEpub: true });
    const blocks = folio.chapters.flatMap((chapter) => chapter.blocks);
    const textOf = (block: (typeof blocks)[number]) => ((block.s || (block.runs || []).map(runText).join(" ")).replace(/\s+/g, " ").trim());
    const heads = blocks.filter((block) => block.t === "h2").map(textOf);
    assert.equal(heads.some((label) => /Pfister/.test(label)), false);
    const prose = blocks.filter((block) => block.t === "p").map(textOf);
    assert.equal(prose.some((text) => text.includes("Richardson") && text.includes("Dartmouth")), true);
    assert.equal(prose.some((text) => text.includes("Richardson") && text.includes("Pfister")), false);
    assert.equal(prose.some((text) => text.includes("Pfister")), true);
    assert.equal(prose.some((text) => text.includes("Sorbonne")), true);
  });

  it("does not glue a two-piece line across the gutter", () => {
    const items: { str: string; transform: number[]; width: number; height: number }[] = [];
    for (let n = 0; n < 8; n++) {
      const y = 700 - n * 14;
      const left =
        n === 3
          ? ([["in kind.", 36, 48]] as const)
          : ([
              [`Left${n}`, 36, 48],
              ["sentence", 90, 52],
              ["stays", 148, 36],
              ["here", 190, 28],
            ] as const);
      const right =
        n === 3
          ? ([["known quantity", 300, 90]] as const)
          : ([
              [`Right${n}`, 300, 48],
              ["column", 354, 48],
              ["follows", 408, 46],
              ["after", 460, 34],
            ] as const);
      for (const [str, x, width] of [...left, ...right]) items.push({ str, transform: [10, 0, 0, 10, x, y], width, height: 10 });
    }
    const lines = cluster(items).map((ln) => ({ ...ln, page: 1, pageH: 792, pageW: 560, h: ln.h || 10 }));
    const folio = assembleFolio(lines, { title: "Columns", subtitle: "", sourceName: "eb.pdf", emptyMessage: "empty", skipEpub: true });
    const blocks = folio.chapters.flatMap((chapter) => chapter.blocks);
    const textOf = (block: (typeof blocks)[number]) => (block.runs || []).map(runText).join(" ");
    assert.equal(blocks.some((block) => textOf(block).includes("kind. known")), false);
    const text = blocks.map(textOf).join(" ");
    assert.ok(text.indexOf("in kind.") < text.indexOf("known quantity"));
    assert.ok(text.indexOf("Left7") < text.indexOf("Right0"));
  });

  it("splits a tight gutter even when the line has a double period", () => {
    const items: { str: string; transform: number[]; width: number; height: number }[] = [];
    for (let n = 0; n < 10; n++) {
      const y = 680 - n * 13;
      if (n === 4) {
        items.push({ str: "by the Zoroastrian eschatology.", transform: [9, 0, 0, 9, 28, y], width: 130, height: 9 });
        items.push({ str: ". But allegory was far from", transform: [9, 0, 0, 9, 161, y], width: 88, height: 9 });
        items.push({ str: "more convenient to write", transform: [9, 0, 0, 9, 258, y], width: 120, height: 9 });
        items.push({ str: "the name", transform: [9, 0, 0, 9, 382, y], width: 52, height: 9 });
        continue;
      }
      let x = 28;
      for (const [str, width] of [
        [`Left${n}`, 42],
        ["sentence", 54],
        ["stays", 36],
        ["whole", 40],
        ["here", 30],
      ] as const) {
        items.push({ str, transform: [9, 0, 0, 9, x, y], width, height: 9 });
        x += width + 3.2;
      }
      x = 258;
      for (const [str, width] of [
        [`Right${n}`, 48],
        ["column", 48],
        ["follows", 48],
        ["after", 36],
      ] as const) {
        items.push({ str, transform: [9, 0, 0, 9, x, y], width, height: 9 });
        x += width + 3.2;
      }
    }
    const lines = cluster(items).map((ln) => ({ ...ln, page: 1, pageH: 792, pageW: 560, h: ln.h || 9 }));
    const folio = assembleFolio(lines, { title: "Columns", subtitle: "", sourceName: "eb.pdf", emptyMessage: "empty", skipEpub: true });
    const blocks = folio.chapters.flatMap((chapter) => chapter.blocks);
    const textOf = (block: (typeof blocks)[number]) => (block.runs || []).map(runText).join(" ");
    const text = blocks.map(textOf).join(" ");
    assert.equal(blocks.some((block) => textOf(block).includes("from more")), false);
    assert.ok(text.indexOf("eschatology") < text.indexOf("more convenient"));
    assert.ok(text.indexOf("Left0") < text.indexOf("Right0"));
  });

  it("starts an encyclopedia entry and a column paragraph on their own", () => {
    const page = { h: 9, pageW: 545, pageH: 743 };
    const left: [string, number, number][] = [
      ["The article before this one keeps its own sentence here.", 12, 250],
      ["Another full line of that article stays in the column.", 12, 252],
      ["A third line of the article is still the same paragraph.", 12, 248],
      ["System der Rechtsphilosophie (Munich, 1904).", 13, 200],
      ["ABOUKIR, a village on the Mediterranean coast of Egypt,", 21, 250],
      ["145 m. N.E. of Alexandria by rail, containing a castle.", 13, 248],
      ["The battle ended there.", 12, 140],
      ["The next paragraph starts after that short line.", 22, 250],
      ["It continues on the following line of the column.", 12, 246],
      ["ABOUT, EDMOND FRANCOIS, the French writer, was born then.", 12, 250],
    ];
    const right: [string, number, number][] = [
      ["Right article opens with a full line of its own here.", 275, 520],
      ["The right column continues under that opening line.", 275, 518],
      ["A further sentence keeps the right column together.", 275, 516],
      ["One more full line belongs to the same right article.", 275, 514],
      ["Short close.", 275, 340],
      ["Indented follow up stays with its own paragraph here.", 286, 518],
      ["And the rest of that paragraph remains beside it.", 275, 510],
      ["More of the right column is read after the left one.", 275, 514],
      ["The last right line stays in the right column alone.", 275, 500],
      ["A final sentence keeps the column from looking short.", 275, 508],
    ];
    const lines = [...left, ...right].map(([text, x0, x1], n) =>
      line(text, 1, 640 - (n % left.length) * 14, { ...page, x0, x1 }),
    );
    const folio = assembleFolio(lines, { title: "Entries", subtitle: "", sourceName: "eb.pdf", emptyMessage: "empty", skipEpub: true });
    const blocks = folio.chapters.flatMap((chapter) => chapter.blocks);
    const textOf = (block: (typeof blocks)[number]) => (block.runs || []).map(runText).join(" ").replace(/\s+/g, " ");
    const texts = blocks.map(textOf);
    assert.equal(texts.some((text) => text.includes("1904") && text.includes("ABOUKIR")), false);
    assert.equal(texts.some((text) => text.includes("ABOUKIR") && text.includes("Alexandria")), true);
    assert.equal(texts.some((text) => text.includes("battle ended") && text.includes("next paragraph")), false);
    assert.equal(texts.some((text) => text.includes("following line") && text.includes("ABOUT")), false);
    assert.equal(texts.some((text) => text.includes("ABOUT") && text.includes("French writer")), true);
    assert.equal(texts.some((text) => text.includes("Short close") && text.includes("Indented follow")), false);
    const text = texts.join(" ");
    assert.ok(text.indexOf("ABOUKIR") < text.indexOf("Right article"));
  });

  it("sets body-size footnotes apart at the foot of a column", () => {
    const page = { h: 9, pageW: 545, pageH: 743 };
    const rows: [string, number, number, number][] = [
      ["The myth of the first man stays in the article here.", 13, 250, 620],
      ["A second line of that article keeps the same column.", 13, 252, 606],
      ["A third line is still the body of the article itself.", 13, 248, 592],
      ["sacred mountain, see Cosmogony.", 13, 160, 578],
      ["1 Note the food and drink of the gods in the story.", 21, 250, 160],
      ["(or Adamu?) myth.", 14, 100, 146],
      ["4 See Cheyne, Genesis and Exodus.", 21, 200, 132],
      ["To these illustrations it is unsafe to add a scene.", 275, 520, 620],
      ["preserved in the museum, representing two figures.", 275, 518, 606],
      ["A third right line keeps the article above the notes.", 275, 516, 592],
      ["The scene was never found in the museum records.", 275, 500, 578],
      ["6 See Jastrow, Rel. of Bab. and Ass. the citation.", 283, 520, 160],
      ["7 The wisdom was probably to qualify him as ruler.", 283, 510, 146],
    ];
    const lines = rows.map(([text, x0, x1, y]) => line(text, 1, y, { ...page, x0, x1 }));
    const folio = assembleFolio(lines, { title: "Notes", subtitle: "", sourceName: "eb.pdf", emptyMessage: "empty", skipEpub: true });
    const blocks = folio.chapters.flatMap((chapter) => chapter.blocks);
    const textOf = (block: (typeof blocks)[number]) => (block.runs || []).map(runText).join(" ").replace(/\s+/g, " ");
    assert.match(folio.warning || "", /Notes/);
    assert.equal(blocks.some((block) => textOf(block).includes("illustrations") && textOf(block).includes("Jastrow")), false);
    assert.equal(blocks.some((block) => textOf(block).includes("Cosmogony") && textOf(block).includes("Note the food")), false);
    const food = blocks.find((block) => textOf(block).includes("Note the food"));
    assert.equal(food?.kind, "note");
    assert.match(textOf(food!), /Adamu/);
    assert.doesNotMatch(textOf(food!), /Cheyne/);
    const cited = blocks.find((block) => textOf(block).includes("Jastrow"));
    assert.equal(cited?.kind, "note");
    const alone = [
      line("A numbered remark stays in the article itself.", 2, 600, { ...page, x0: 13, x1: 250 }),
      line("The second line of that article is still prose.", 2, 586, { ...page, x0: 13, x1: 250 }),
      line("The third line of that article is still prose.", 2, 572, { ...page, x0: 13, x1: 250 }),
      line("The fourth line of that article is still prose.", 2, 558, { ...page, x0: 13, x1: 248 }),
      line("1 He continued the article rather than a footnote here.", 2, 150, { ...page, x0: 13, x1: 250 }),
      line("Right column keeps this sentence in the article.", 2, 600, { ...page, x0: 275, x1: 520 }),
      line("The right column continues with ordinary prose.", 2, 586, { ...page, x0: 275, x1: 518 }),
      line("Another right line is still part of the article.", 2, 572, { ...page, x0: 275, x1: 516 }),
      line("The last right line closes the article in prose.", 2, 558, { ...page, x0: 275, x1: 510 }),
    ];
    const book = assembleFolio(alone, { title: "List", subtitle: "", sourceName: "p.pdf", emptyMessage: "empty", skipEpub: true });
    const prose = book.chapters.flatMap((chapter) => chapter.blocks);
    const one = prose.find((block) => textOf(block).includes("He continued"));
    assert.notEqual(one?.kind, "note");
    assert.doesNotMatch(book.warning || "", /Notes/);
  });

  it("reads a page of talk as prose, not as a poem", () => {
    const page = { h: 9, pageW: 307, pageH: 488 };
    const rows: [string, number, number][] = [
      ["it would have been she, and that his marriage might have", 35, 287],
      ["changed his whole life, but now it is too late.", 35, 190],
      ["When we were taking coffee I told them the story", 48, 287],
      ["of the treasure which we had brought into the house", 35, 287],
      ["on that particular night.", 35, 160],
      ["Mary and Arthur were much interested to hear it", 35, 287],
      ["but I thought it better not to disturb it.", 35, 188],
      ["He followed me to my room that night after dinner", 35, 287],
      ["and asked me for the money.", 35, 168],
      ["I told him I had already been far too generous", 35, 287],
      ["with him for many years.", 35, 160],
      ["The next morning the coronet was gone from its case", 35, 287],
      ["and the household was in an uproar.", 35, 176],
      ["Holmes listened and did not interrupt the account", 35, 287],
      ["until the whole miserable story was told to him", 35, 287],
      ["before anyone else had touched the room.", 35, 184],
    ];
    const lines = rows.map(([text, x0, x1], n) => line(text, 1, 460 - n * 13, { ...page, x0, x1 }));
    const folio = assembleFolio(lines, { title: "Holmes", subtitle: "", sourceName: "holmes.pdf", emptyMessage: "empty", skipEpub: true });
    const blocks = folio.chapters.flatMap((chapter) => chapter.blocks);
    const textOf = (block: (typeof blocks)[number]) => (block.runs || []).map(runText).join(" ").replace(/\s+/g, " ");
    assert.doesNotMatch(folio.warning || "", /verse/);
    assert.equal(blocks.some((block) => textOf(block).includes("might have") && textOf(block).includes("changed his whole")), true);
    assert.equal(blocks.some((block) => textOf(block).includes("too late") && textOf(block).includes("taking coffee")), false);
  });

  it("opens a column break when only some lines cross it", () => {
    const page = { h: 9, pageW: 545, pageH: 743 };
    const lines: Line[] = [];
    for (let n = 0; n < 16; n++) {
      lines.push(line(`Left column keeps sentence ${n} on its own side.`, 1, 680 - n * 12, { ...page, x0: 13, x1: 248 }));
      lines.push(line(`Right column keeps sentence ${n} on its own side.`, 1, 680 - n * 12, { ...page, x0: 275, x1: 510 }));
    }
    for (let n = 0; n < 12; n++) {
      const left = n === 3 ? "stretching down to and even across the" : `Left crossing line ${n} stays here`;
      const right = n === 3 ? "position above the chapter house" : `Right crossing line ${n} stays here`;
      lines.push({
        text: `${left} ${right}`,
        y: 640 - n * 12,
        x0: 13,
        x1: 520,
        h: 9,
        page: 1,
        pageH: 743,
        pageW: 545,
        seams: [{ x0: 250, x1: 274, left, right, leftX0: 13, leftX1: 248, rightX0: 275, rightX1: 520 }],
      });
    }
    const folio = assembleFolio(lines, { title: "Abbey", subtitle: "", sourceName: "eb.pdf", emptyMessage: "empty", skipEpub: true });
    const blocks = folio.chapters.flatMap((chapter) => chapter.blocks);
    const textOf = (block: (typeof blocks)[number]) => (block.runs || []).map(runText).join(" ");
    assert.match(folio.warning || "", /column/);
    assert.equal(blocks.some((block) => textOf(block).includes("across the position")), false);
    const text = blocks.map(textOf).join(" ");
    assert.ok(text.indexOf("across the") < text.indexOf("position above"));
  });

  it("does not make a line that already holds a sentence into a heading", () => {
    const lines: Line[] = [
      line("Past President of Architectural Association. Associate and Fellow of King's", 1, 500),
      line("College, London. Editor of the history of the building.", 1, 486),
      line("The article continues in ordinary prose after that note.", 1, 460),
    ];
    const folio = assembleFolio(lines, { title: "Initials", subtitle: "", sourceName: "eb.pdf", emptyMessage: "empty", skipEpub: true });
    const heads = folio.chapters.flatMap((chapter) => chapter.blocks).filter((block) => block.t === "h2").map((block) => block.s || "");
    assert.equal(heads.some((label) => /President|College/.test(label)), false);
  });

  it("reads a typed letter as prose and keeps a buried name in the sentence", () => {
    const page = { h: 12, pageW: 627, pageH: 792 };
    const rows: [string, number, number, number][] = [
      ["The North Nassau Mental Health Center", 103, 513, 740],
      ["May 9, 1968", 384, 463, 700],
      ["Professor Linus Pauling", 112, 274, 660],
      ["La Jolla, California 92037", 113, 299, 632],
      ["Dear Professor Pauling:", 112, 280, 600],
      ["As one of the psychiatrist who has been using ortho-", 150, 525, 560],
      ["molecular psychiatry for several years in the field of", 112, 520, 546],
      ["schizophrenia, I greatly enjoyed your article in the April", 112, 533, 532],
      ["19th issue of Science. I would like to obtain reprints", 112, 522, 518],
      ["for the Staff so that I could use twenty reprints if they are", 112, 540, 504],
      ["Thomas, and yon - and perhaps Dr. Cameron - will come too.", 112, 530, 490],
      ["available.", 112, 180, 476],
      ["Please bill us for the costs involved.", 150, 430, 430],
      ["Sincerely,", 360, 450, 220],
      ["Linus Pauling", 250, 380, 180],
    ];
    const lines = rows.map(([text, x0, x1, y]) => line(text, 1, y, { ...page, x0, x1 }));
    const folio = assembleFolio(lines, { title: "Letter", subtitle: "", sourceName: "letter.pdf", emptyMessage: "empty", skipEpub: true });
    const blocks = folio.chapters.flatMap((chapter) => chapter.blocks);
    const textOf = (block: (typeof blocks)[number]) => ((block.s || (block.runs || []).map(runText).join(" ")).replace(/\s+/g, " ").trim());
    const heads = blocks.filter((block) => block.t === "h2").map(textOf);
    assert.doesNotMatch(folio.warning || "", /verse/);
    assert.equal(heads.some((label) => /92037|California|Pauling/.test(label)), false);
    const body = blocks.map(textOf).find((text) => text.includes("molecular"));
    assert.match(body || "", /ortho- molecular|orthomolecular/);
    assert.match(body || "", /Dr\. Cameron/);
    assert.doesNotMatch(body || "", /Please bill/);
  });

  it("joins a typewriter line whose word boxes overlap", () => {
    const y = 472;
    const items = [
      ["Under separate cover I", 125, 147],
      ["am sending you", 265, 93],
      ["the", 365, 20],
      ["twenty reprints", 391, 100],
      ["of my paper", 478, 71],
    ].map(([str, x, width]) => ({ str: String(str), transform: [10, 0, 0, 10, Number(x), y], width: Number(width), height: 10 }));
    const lines = cluster(items);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].text, "Under separate cover I am sending you the twenty reprints of my paper");
  });

  it("keeps a transcript speech with its speaker", () => {
    const page = { h: 12, pageW: 630, pageH: 794 };
    const rows: [string, number, number, number][] = [
      ["NOT FOR WOMEN ONLY", 250, 420, 740],
      ["BARBARA WALTERS: I'm Barbara Walters and welcome to our program today.", 139, 560, 700],
      ["all this week we are discussing vitamins and what they do for you.", 100, 546, 686],
      ["what specific good or harm do they do you on this show today.", 101, 545, 672],
      ["yesterday we were talking about vitamin C and whether it prevents colds.", 101, 560, 658],
      ["the man who leads that work is here with the rest of the panel.", 100, 540, 644],
      ["MS WALTERS; Physical chemist, all right. Dr. Linus Pauling is here.", 136, 560, 600],
      ["Pauling is a physical chemist and one of America's foremost scientists.", 98, 560, 586],
      ["DR PAULING; Well there is no doubt that it helps preserve the vessels.", 140, 580, 540],
      ["the evidence is especially good for the peripheral arteries of the body.", 102, 580, 526],
    ];
    const lines = rows.map(([text, x0, x1, y]) => line(text, 1, y, { ...page, x0, x1 }));
    const folio = assembleFolio(lines, { title: "Show", subtitle: "", sourceName: "show.pdf", emptyMessage: "empty", skipEpub: true });
    const blocks = folio.chapters.flatMap((chapter) => chapter.blocks);
    const textOf = (block: (typeof blocks)[number]) => (block.runs || []).map(runText).join(" ").replace(/\s+/g, " ");
    assert.doesNotMatch(folio.warning || "", /verse/);
    assert.equal(blocks.some((block) => textOf(block).includes("welcome to our") && textOf(block).includes("all this week")), true);
    assert.equal(blocks.some((block) => textOf(block).includes("Physical chemist") && textOf(block).includes("foremost scientists")), true);
    assert.equal(blocks.some((block) => textOf(block).includes("Physical chemist") && textOf(block).includes("DR PAULING")), false);
    assert.equal(blocks.some((block) => textOf(block).includes("no doubt") && textOf(block).includes("peripheral arteries")), true);
  });

  it("keeps an itinerary day and reads the clock across the row", () => {
    const page = { h: 11, pageW: 624, pageH: 791 };
    const row = (left: string, right: string, y: number): Line => ({
      text: `${left} ${right}`,
      y,
      x0: 40,
      x1: 560,
      h: 11,
      page: 1,
      pageH: 791,
      pageW: 624,
      cells: [
        { text: left, x0: 40, x1: 280 },
        { text: right, x0: 360, x1: 560 },
      ],
    });
    const lines: Line[] = [
      line("Thursday - March 7", 1, 700, page),
      line("Monday - March 11", 1, 680, page),
      line("Tuesday - March 12", 1, 660, page),
      line("Wednesday - March 13", 1, 640, page),
      row("Leave SF 8:45 a.m.", "United F1 #50", 600),
      row("Arrive Washington 4:40 p.m.", "Hilton Hotel", 580),
      row("Meeting at Sloan-Kettering", "2:00 to 4:00 p.m.", 540),
      row("Leave LaGuardia", "11:40 a.m.", 500),
      line("Friday - March 15", 1, 460, page),
    ];
    const folio = assembleFolio(lines, { title: "Trip", subtitle: "", sourceName: "trip.pdf", emptyMessage: "empty", skipEpub: true });
    const blocks = folio.chapters.flatMap((chapter) => chapter.blocks);
    const textOf = (block: (typeof blocks)[number]) => {
      if (block.t === "table") return `TABLE ${(block.headers || []).join(" ")} ${(block.rows || []).flat().join(" ")}`;
      return (block.runs || []).map(runText).join(" ");
    };
    const text = blocks.map(textOf).join(" ");
    assert.doesNotMatch(folio.warning || "", /column|table/);
    assert.match(text, /Thursday - March 7/);
    assert.match(text, /Wednesday - March 13/);
    assert.match(text, /Friday - March 15/);
    assert.match(text, /LaGuardia/);
    assert.match(text, /11:40/);
    assert.match(text, /#50/);
    assert.equal(contentsEntry({ text: "Thursday - March 7" }), null);
    assert.equal(contentsEntry({ text: "April 12, 1972" }), null);
    const listed = contentsEntry({ text: "Sunday, March 3 .... 12" });
    assert.equal(listed?.token, "12");
    assert.match(listed?.title || "", /Sunday, March 3/);
  });

  it("does not make a column of stray letters into a table", () => {
    const cells = (texts: string[], y: number): Line => ({
      text: texts.join(" "),
      y,
      x0: 80,
      x1: 560,
      h: 11,
      page: 1,
      pageH: 792,
      pageW: 624,
      cells: texts.map((text, index) => ({ text, x0: index === 0 ? 80 : 540, x1: index === 0 ? 500 : 560 })),
    });
    const lines: Line[] = [
      line("OFFICE MEMORANDUM", 1, 740, { x0: 80, x1: 400 }),
      cells(["I do not have any information beyond that given in the letter from him.", "z"], 640),
      cells(["Dr. Hawkins discussed this matter with the school when he was here today.", "o"], 626),
      cells(["The impression was of a considerable number of people on that program.", "c"], 612),
    ];
    const folio = assembleFolio(lines, { title: "Memo", subtitle: "", sourceName: "memo.pdf", emptyMessage: "empty", skipEpub: true });
    const blocks = folio.chapters.flatMap((chapter) => chapter.blocks);
    assert.equal(blocks.some((block) => block.t === "table"), false);
    const text = blocks.flatMap((block) => block.runs || []).map(runText).join(" ");
    assert.match(text, /considerable number/);
  });

  it("reads a centered typewritten section as a heading", () => {
    const page = { h: 12, pageW: 612, pageH: 792 };
    const body = [
      "Since late 1966, our research friends have been trying to collect clinical",
      "impressions of what can be seen subjectively and described by a physician.",
      "Another full line of this report stays with the paragraph above it here.",
      "And one more line keeps the page from looking like a short note today.",
      "The next sentence of the report continues in the same typewritten measure.",
      "A further line of ordinary prose belongs to that same opening paragraph.",
    ];
    const lines: Line[] = [
      line("THE B-3 THERAPY", 5, 760, { ...page, x0: 230, x1: 390 }),
      line("PROMISING EVENTS IN THE B-3 FIELD (1966-1967)", 5, 680, { ...page, x0: 70, x1: 540 }),
      ...body.map((text, n) => line(text, 5, 640 - n * 14, { ...page, x0: 72, x1: n === 1 ? 500 : 548 })),
    ];
    const folio = assembleFolio(lines, { title: "B-3", subtitle: "", sourceName: "b3.pdf", emptyMessage: "empty", skipEpub: true });
    const blocks = folio.chapters.flatMap((chapter) => chapter.blocks);
    const textOf = (block: (typeof blocks)[number]) => ((block.s || (block.runs || []).map(runText).join(" ")).replace(/\s+/g, " ").trim());
    const heads = blocks.filter((block) => block.t === "h2").map(textOf);
    assert.equal(heads.some((label) => /B-3 Therapy/.test(label)), false);
    assert.equal(heads.some((label) => /Promising Events/.test(label) && /1966/.test(label)), true);
    assert.equal(blocks.some((block) => textOf(block).includes("Since late") && textOf(block).includes("impressions of")), true);
    assert.equal(blocks.some((block) => textOf(block).includes("Promising") && textOf(block).includes("Since late")), false);
  });

  it("reads a topical index whose pages are ranges", () => {
    const page = { h: 12, pageW: 612, pageH: 792 };
    const lines: Line[] = [
      line("TOPICAL INDEX", 1, 700, { ...page, x0: 230, x1: 390 }),
      line("1. Expansion of B-3 Therapy, 1966-67 . . . . . 1 – 2", 1, 660, { ...page, x0: 72, x1: 540 }),
      line("2. Promising Events In the B-3 Field – 1966-67 . . . . 3 – 5", 1, 640, { ...page, x0: 72, x1: 540 }),
      line("3. Safety, Dosage and Side Effects . . . . . . . . 6 – 9", 1, 620, { ...page, x0: 72, x1: 540 }),
      line("4. Alcoholism – Report of Dr. Russell Smith", 1, 600, { ...page, x0: 72, x1: 480 }),
      line("507 cases. (Brighton Hospital, Detroit;", 1, 584, { ...page, x0: 96, x1: 420 }),
      line("Guest House, Lake Orion, Mich.) . . . . . . 10 – 13", 1, 568, { ...page, x0: 96, x1: 540 }),
    ];
    const prose = [
      "Since late 1966, our research friends have been trying to collect clinical",
      "impressions of what can be seen subjectively and described by a physician.",
      "Another full line of this report stays with the paragraph above it here.",
      "And one more line keeps the page from looking like a short note today.",
    ];
    for (let n = 1; n <= 13; n++) {
      const file = n + 1;
      lines.push(line("THE B-3 THERAPY", file, 760, { ...page, x0: 230, x1: 390 }));
      lines.push(line(`- ${n} -`, file, 24, { ...page, x0: 280, x1: 330 }));
      if (n === 3) lines.push(line("PROMISING EVENTS IN THE B-3 FIELD (1966-1967)", file, 680, { ...page, x0: 70, x1: 540 }));
      if (n === 6) lines.push(line("SAFETY - DOSAGE - SIDE EFFECTS", file, 680, { ...page, x0: 120, x1: 490 }));
      if (n === 1 || n === 3 || n === 6 || n === 10) prose.forEach((text, index) => lines.push(line(text, file, 640 - index * 16, { ...page, x0: 72, x1: 540 })));
    }
    const ranged = contentsEntry({ text: "1. Expansion of B-3 Therapy, 1966-67 . . . . . 1 – 2" });
    assert.equal(ranged?.token, "1");
    assert.match(ranged?.title || "", /Expansion of B-3 Therapy, 1966-67/);
    assert.doesNotMatch(ranged?.title || "", /1 – 2|1-2/);
    assert.equal(contentsEntry({ text: "3. Safety, Dosage and Side Effects .... 6-9" })?.token, "6");
    assert.equal(contentsEntry({ text: "Thursday - March 7" }), null);
    const folio = assembleFolio(lines, { title: "B-3", subtitle: "", sourceName: "b3.pdf", emptyMessage: "empty", skipEpub: true });
    const labels = folio.toc.map((item) => `${item.label} @${item.page}`);
    assert.ok(labels.some((label) => /Expansion of B-3 Therapy/.test(label) && /@1$/.test(label)));
    assert.ok(labels.some((label) => /Promising Events/.test(label) && /@3$/.test(label)));
    assert.ok(labels.some((label) => /Safety, Dosage and Side Effects/.test(label) && /@6$/.test(label)));
    assert.ok(labels.some((label) => /Alcoholism/.test(label) && /Guest House/.test(label) && /@10$/.test(label)));
    assert.equal(labels.some((label) => /THE B-3 THERAPY|B-3 Therapy @/.test(label)), false);
    assert.doesNotMatch(folio.warning || "", /verse/);
    const reading = folio.chapters.flatMap((chapter) => chapter.blocks).map((block) => block.s || (block.runs || []).map(runText).join(" ")).join(" ");
    assert.match(reading, /Since late 1966/);
    assert.doesNotMatch(reading, /1 – 2/);
  });

  it("reads a study guide's questions as prose and keeps the next section", () => {
    const page = { h: 12, pageW: 612, pageH: 792 };
    const lines: Line[] = [
      line("Power vs. Force", 1, 760, { ...page, x0: 72, x1: 190 }),
      line("18", 1, 760, { ...page, x0: 540, x1: 558 }),
      line("Chapter Six", 1, 710, { ...page, x0: 250, x1: 370 }),
      line("Section I", 1, 688, { ...page, x0: 270, x1: 350 }),
      line("1. Why is the critical point of integrity at 200 so", 1, 650, { ...page, x0: 72, x1: 470 }),
      line("important to the rest of this study?", 1, 634, { ...page, x0: 72, x1: 300 }),
      line("2. What is the basic principle?", 1, 600, { ...page, x0: 72, x1: 250 }),
      line("3. How does power differ from force in the world?", 1, 572, { ...page, x0: 72, x1: 430 }),
      line("4. What does calibration measure?", 1, 544, { ...page, x0: 72, x1: 290 }),
      line("Section II", 1, 500, { ...page, x0: 72, x1: 160 }),
      line("5. Where does integrity begin?", 1, 468, { ...page, x0: 72, x1: 260 }),
      line("6. What is the role of context?", 1, 440, { ...page, x0: 72, x1: 280 }),
      line("7. How is truth recognized by the reader?", 1, 412, { ...page, x0: 72, x1: 370 }),
      line("8. What follows from willingness?", 1, 384, { ...page, x0: 72, x1: 280 }),
    ];
    const folio = assembleFolio(lines, { title: "Guide", subtitle: "", sourceName: "guide.pdf", emptyMessage: "empty", skipEpub: true });
    const blocks = folio.chapters.flatMap((chapter) => chapter.blocks);
    const textOf = (block: (typeof blocks)[number]) => ((block.s || (block.runs || []).map(runText).join(" ")).replace(/\s+/g, " ").trim());
    const labels = folio.toc.map((item) => item.label);
    assert.equal(labels.some((label) => /Why is the critical point/.test(label)), false);
    assert.match(labels.join(" "), /Chapter Six/);
    assert.equal(blocks.some((block) => block.t === "h2" && /Section I/.test(textOf(block))), true);
    assert.equal(blocks.some((block) => block.t === "h2" && /Section II/.test(textOf(block))), true);
    const body = blocks.filter((block) => block.t === "p").map(textOf);
    assert.equal(body.some((text) => /critical point of integrity/.test(text) && /rest of this study/.test(text)), true);
    assert.equal(body.some((text) => /critical point/.test(text) && /basic principle/.test(text)), false);
    assert.equal(body.filter((text) => /^\d+\./.test(text)).length, 8);
    assert.doesNotMatch(folio.warning || "", /verse/);
  });

  it("keeps an interview question apart from its answer", () => {
    const page = { h: 12, pageW: 612, pageH: 792 };
    const lines: Line[] = [];
    for (let n = 0; n < 4; n++) {
      lines.push(line(`Q. Left question ${n} about the meaning of power?`, 1, 700 - n * 48, { ...page, x0: 40, x1: 270 }));
      lines.push(line(`A. Left answer ${n} stays on this side of the sheet.`, 1, 684 - n * 48, { ...page, x0: 40, x1: 280 }));
      lines.push(line(`Q. Right question ${n} about the meaning of force?`, 1, 698 - n * 48, { ...page, x0: 340, x1: 570 }));
      lines.push(line(`A. Right answer ${n} stays on the other side of the sheet.`, 1, 682 - n * 48, { ...page, x0: 340, x1: 580 }));
    }
    const folio = assembleFolio(lines, { title: "Interview", subtitle: "", sourceName: "interview.pdf", emptyMessage: "empty", skipEpub: true });
    const blocks = folio.chapters.flatMap((chapter) => chapter.blocks);
    const textOf = (block: (typeof blocks)[number]) => ((block.s || (block.runs || []).map(runText).join(" ")).replace(/\s+/g, " ").trim());
    const reading = blocks.map(textOf).join(" ");
    assert.ok(reading.indexOf("Left question 0") < reading.indexOf("Left question 3"));
    assert.ok(reading.indexOf("Left question 3") < reading.indexOf("Right question 0"));
    assert.equal(blocks.some((block) => /Left question 0/.test(textOf(block)) && /Left answer 0/.test(textOf(block))), false);
    assert.doesNotMatch(folio.warning || "", /verse/);
    assert.match(folio.warning || "", /column/);
  });
});


