import type { Line } from "./assemble.ts";
import { mergeScriptLines, readablePicture } from "./cases.ts";
import type { OcrKind } from "./settings.ts";
import { loadVision } from "./ocr-vision.ts";
import { loadPp, readPpPage } from "./ocr-pp.ts";
import { looksScrappy, PROBE_ORDER, scriptHits, scriptLabel, type ReaderScript } from "./script.ts";
import { checkpoint } from "./job.ts";

export type PicturePage = {
  n: number;
  pageW: number;
  pageH: number;
  draw: () => Promise<HTMLCanvasElement>;
};

const VISION_FALLBACK = "The vision model did not start. Empty pages were read with PP-OCR.";

function pageText(lines: Line[]) {
  return lines.map((line) => line.text).join(" ");
}

async function readKind(
  kind: OcrKind,
  pages: PicturePage[],
  total: number,
  onStatus: ((s: string) => void) | undefined,
  script: ReaderScript,
) {
  if (kind === "pp") await loadPp(onStatus, script);
  const vision = kind === "vision" ? await loadVision(onStatus) : null;
  const lines: Line[] = [];
  let failed = 0;
  for (const page of pages) {
    checkpoint();
    onStatus?.(
      kind === "vision"
        ? `Vision model, page ${page.n} of ${total}`
        : script === "en"
          ? `PP-OCR, page ${page.n} of ${total}`
          : `${scriptLabel(script)} reader, page ${page.n} of ${total}`,
    );
    try {
      const canvas = await page.draw();
      const found =
        kind === "pp"
          ? await readPpPage(canvas, page.n, page.pageW, page.pageH, script)
          : await vision!.read(canvas, page.n, page.pageW, page.pageH);
      lines.push(...(readablePicture(found) ? found : []));
      canvas.width = 0;
      canvas.height = 0;
    } catch {
      failed++;
    }
  }
  return { lines, failed };
}

function scriptOrder(allowed: readonly ReaderScript[], known: ReaderScript[]) {
  const order: ReaderScript[] = [];
  for (const id of [...known, ...PROBE_ORDER]) {
    if (id === "en" || order.includes(id)) continue;
    if (!allowed.includes(id)) continue;
    order.push(id);
  }
  return order;
}

async function readMixed(
  canvas: HTMLCanvasElement,
  page: PicturePage,
  allowed: readonly ReaderScript[],
  known: ReaderScript[],
  onStatus?: (s: string) => void,
): Promise<{ lines: Line[]; script: ReaderScript }> {
  const useEnglish = allowed.includes("en");
  const english = useEnglish ? await readPpPage(canvas, page.n, page.pageW, page.pageH, "en") : [];
  const enText = pageText(english);
  const enOk = useEnglish && !looksScrappy(enText);
  const order = scriptOrder(allowed, known);
  if (!order.length) return { lines: english, script: "en" };
  const preferred = order.filter((id) => known.includes(id));
  const passes = preferred.length ? preferred : order;
  let lines = english;
  let script: ReaderScript = "en";
  for (const candidate of passes) {
    if (!known.includes(candidate)) {
      onStatus?.(
        enOk
          ? `Trying the ${scriptLabel(candidate)} reader beside English.`
          : `The English reader found scraps. Trying the ${scriptLabel(candidate)} reader.`,
      );
    }
    try {
      const read = await readPpPage(canvas, page.n, page.pageW, page.pageH, candidate);
      const text = pageText(read);
      const hit = candidate === "latin" ? !looksScrappy(text) : scriptHits(text, candidate) >= 8;
      if (!hit) continue;
      if (!known.includes(candidate)) known.push(candidate);
      if (useEnglish && enOk) lines = mergeScriptLines(lines, read, candidate);
      else if (script === "en") lines = read;
      else lines = mergeScriptLines(lines, read, candidate);
      script = candidate;
    } catch {
      /* a reader that will not start leaves the reading already kept */
    }
  }
  return { lines: lines.length ? lines : english, script };
}

export async function readPicturePages(
  pages: PicturePage[],
  total: number,
  kind: OcrKind,
  onStatus?: (s: string) => void,
  hinted: ReaderScript = "en",
  allowed: readonly ReaderScript[] = [],
): Promise<{ lines: Line[]; warning?: string }> {
  let use: OcrKind = kind;
  let warning: string | undefined;
  if (kind === "vision") onStatus?.("Starting the vision model");
  try {
    if (use === "vision") {
      try {
        const read = await readKind("vision", pages, total, onStatus, "en");
        if (!read.lines.length) throw new Error(VISION_FALLBACK);
        if (read.failed) warning = warning || `Could not read the picture of ${read.failed} ${read.failed === 1 ? "page" : "pages"}.`;
        return { lines: read.lines, warning };
      } catch (err) {
        const detail = err instanceof Error && err.message ? err.message : "The vision model did not start.";
        warning = detail.includes("PP-OCR") ? detail : `${detail} Empty pages were read with PP-OCR.`;
        onStatus?.(warning);
        use = "pp";
      }
    }
    const englishOn = allowed.includes("en");
    if (!englishOn && !allowed.some((id) => id !== "en")) {
      const note = "No picture reader is on, so those pages were left unread.";
      onStatus?.(note);
      return { lines: [], warning: warning ? `${warning} ${note}` : note };
    }
    const known: ReaderScript[] = hinted !== "en" && allowed.includes(hinted) ? [hinted] : [];
    const lines: Line[] = [];
    let failed = 0;
    const used = new Set<ReaderScript>();
    for (const page of pages) {
      checkpoint();
      onStatus?.(`PP-OCR, page ${page.n} of ${total}`);
      let canvas: HTMLCanvasElement | null = null;
      try {
        canvas = await page.draw();
        const found = await readMixed(canvas, page, allowed, known, onStatus);
        if (found.script !== "en") {
          onStatus?.(`${scriptLabel(found.script)} reader, page ${page.n} of ${total}`);
          if (!used.has(found.script)) {
            used.add(found.script);
            const note = englishOn
              ? `Picture pages can use the ${scriptLabel(found.script)} reader beside English.`
              : `Picture pages are read with the ${scriptLabel(found.script)} reader.`;
            warning = warning ? `${warning} ${note}` : note;
          }
        }
        lines.push(...(readablePicture(found.lines) ? found.lines : []));
      } catch {
        failed++;
      } finally {
        if (canvas) {
          canvas.width = 0;
          canvas.height = 0;
        }
      }
    }
    if (!lines.length && failed) throw new Error("PP-OCR could not read the pictures of those pages.");
    if (failed) warning = warning || `Could not read the picture of ${failed} ${failed === 1 ? "page" : "pages"}.`;
    return { lines, warning };
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error("Could not read the pictures of those pages.");
  }
}
