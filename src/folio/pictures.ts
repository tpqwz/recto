import type { Line } from "./assemble.ts";
import type { OcrKind } from "./settings.ts";
import { graphicsChip, loadVision } from "./ocr-vision.ts";
import { loadPp, readPpPage } from "./ocr-pp.ts";

export type PicturePage = {
  n: number;
  pageW: number;
  pageH: number;
  draw: () => Promise<HTMLCanvasElement>;
};

const VISION_FALLBACK = "The vision model did not start. Empty pages were read with PP-OCR.";
const NO_CHIP = "The vision model needs a graphics chip this browser does not offer. Empty pages were read with PP-OCR.";

async function readKind(
  kind: OcrKind,
  pages: PicturePage[],
  total: number,
  onStatus?: (s: string) => void,
) {
  if (kind === "pp") await loadPp(onStatus);
  const vision = kind === "vision" ? await loadVision(onStatus) : null;
  const lines: Line[] = [];
  let failed = 0;
  for (const page of pages) {
    onStatus?.(`Reading the picture of page ${page.n} of ${total}`);
    try {
      const canvas = await page.draw();
      const found =
        kind === "pp"
          ? await readPpPage(canvas, page.n, page.pageW, page.pageH)
          : await vision!.read(canvas, page.n, page.pageW, page.pageH);
      lines.push(...found);
      canvas.width = 0;
      canvas.height = 0;
    } catch {
      failed++;
    }
  }
  return { lines, failed };
}

export async function readPicturePages(
  pages: PicturePage[],
  total: number,
  kind: OcrKind,
  onStatus?: (s: string) => void,
): Promise<{ lines: Line[]; warning?: string }> {
  let use: OcrKind = kind;
  let warning: string | undefined;
  if (kind === "vision" && !(await graphicsChip())) {
    use = "pp";
    warning = NO_CHIP;
  }
  try {
    if (use === "vision") {
      try {
        const read = await readKind("vision", pages, total, onStatus);
        if (!read.lines.length) throw new Error(VISION_FALLBACK);
        if (read.failed) warning = warning || `Could not read the picture of ${read.failed} ${read.failed === 1 ? "page" : "pages"}.`;
        return { lines: read.lines, warning };
      } catch (err) {
        warning = err instanceof Error && err.message ? err.message : VISION_FALLBACK;
        if (!warning.includes("PP-OCR")) warning = VISION_FALLBACK;
        const read = await readKind("pp", pages, total, onStatus);
        if (!read.lines.length && read.failed) throw new Error("PP-OCR could not read the pictures of those pages.");
        return { lines: read.lines, warning };
      }
    }
    const read = await readKind("pp", pages, total, onStatus);
    if (!read.lines.length && read.failed) throw new Error("PP-OCR could not read the pictures of those pages.");
    if (read.failed) warning = `Could not read the picture of ${read.failed} ${read.failed === 1 ? "page" : "pages"}.`;
    return { lines: read.lines, warning };
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error("Could not read the pictures of those pages.");
  }
}
