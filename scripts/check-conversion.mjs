/**
 * Score a text-layer PDF through the same conversion the desk uses,
 * against a text of the same translation. Not part of the desk.
 *   node --experimental-strip-types scripts/check-conversion.mjs <pdf> <reference.txt>
 */
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { pathToFileURL } from "url";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { assembleFolio, cluster } from "../src/folio/assemble.ts";
import { checkSameText, folioText } from "../src/folio/check.ts";

const pdfPath = process.argv[2];
const referencePath = process.argv[3];
if (!pdfPath || !referencePath) {
  console.error("usage: node --experimental-strip-types scripts/check-conversion.mjs <pdf> <reference.txt>");
  process.exit(1);
}

GlobalWorkerOptions.workerSrc = pathToFileURL(
  path.resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs"),
).href;

function lexicon() {
  const gz = path.resolve("public/lexicon.txt.gz");
  if (!fs.existsSync(gz)) return null;
  const text = zlib.gunzipSync(fs.readFileSync(gz)).toString("utf8");
  const words = new Set(text.split(/\s+/).filter((word) => word.length > 1 && word.length < 28));
  return { has: (word) => words.has(word) };
}

const data = new Uint8Array(fs.readFileSync(pdfPath));
const doc = await getDocument({ data, useSystemFonts: true }).promise;
const lines = [];
for (let n = 1; n <= doc.numPages; n++) {
  if (n === 1 || n % 40 === 0 || n === doc.numPages) process.stderr.write(`page ${n}/${doc.numPages}\n`);
  const page = await doc.getPage(n);
  const view = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  for (const ln of cluster(content.items)) {
    lines.push({ ...ln, page: n, pageH: view.height, pageW: view.width });
  }
}
const folio = assembleFolio(lines, {
  title: path.basename(pdfPath),
  subtitle: "check",
  sourceName: path.basename(pdfPath),
  emptyMessage: "No text layer.",
  lexicon: lexicon(),
});
const report = checkSameText(folioText(folio), fs.readFileSync(referencePath, "utf8"));
console.log(JSON.stringify({ pages: doc.numPages, lines: lines.length, stats: folio.stats, chapters: folio.chapters.length, report: report.lines }, null, 2));
