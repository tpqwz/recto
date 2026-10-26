import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { previewPathPrefix } from "@/lib/preview-path-prefix";
import { assembleFolio, cluster, runPage, type Folio, type Line, type OutlineItem } from "./assemble";
import { pictureScale } from "./picture";
import { readPicturePages } from "./pictures";
import { jpegFromRgba } from "./cover";
import { loadPdfjs, pdfAssetOptions } from "./pdf-local";
import { loadLexicon } from "./repair";
import { DEFAULT_SETTINGS, type DeskSettings } from "./settings";

export type { Block, Folio, OutlineItem, Run, TocNode } from "./assemble";
export { runPage };

const NO_TEXT = "No text layer in that PDF. Turn on picture reading in Settings, or open a PDF that already has text.";

function assetPrefix() {
  if (typeof window === "undefined") return "";
  return previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
}

function titleFromName(filename: string) {
  return filename.replace(/\.(pdf|djvu|djv)$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim() || "Opened book";
}

async function pageOfDest(doc: PDFDocumentProxy, dest: unknown) {
  try {
    const resolved = typeof dest === "string" ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(resolved) || resolved[0] == null) return null;
    const index = await doc.getPageIndex(resolved[0]);
    return index + 1;
  } catch {
    return null;
  }
}

async function readOutline(doc: PDFDocumentProxy, pageCount: number): Promise<OutlineItem[]> {
  let raw: Awaited<ReturnType<PDFDocumentProxy["getOutline"]>> | null = null;
  try {
    raw = await doc.getOutline();
  } catch {
    return [];
  }
  if (!raw?.length) return [];
  const cache = new Map<string, number | null>();
  const pageOf = async (dest: unknown) => {
    if (dest == null) return null;
    const key = typeof dest === "string" ? `s:${dest}` : JSON.stringify(dest);
    if (cache.has(key)) return cache.get(key) ?? null;
    const page = await pageOfDest(doc, dest);
    const safe = page && page >= 1 && page <= pageCount ? page : null;
    cache.set(key, safe);
    return safe;
  };
  let left = 400;
  type Node = NonNullable<typeof raw>[number];
  async function walk(nodes: Node[], depth: number): Promise<OutlineItem[]> {
    const out: OutlineItem[] = [];
    for (const node of nodes) {
      if (left-- <= 0) break;
      const label = String(node.title || "").replace(/\s+/g, " ").trim().slice(0, 180);
      const page = await pageOf(node.dest);
      const children = depth < 1 && node.items?.length ? await walk(node.items, depth + 1) : [];
      if (!label) continue;
      out.push({ label, page: page ?? children.find((c) => c.page)?.page ?? null, children });
    }
    return out;
  }
  return walk(raw, 0);
}

export async function folioFromPdf(
  data: ArrayBuffer,
  filename: string,
  onStatus?: (s: string) => void,
  settings: DeskSettings = DEFAULT_SETTINGS,
): Promise<Folio> {
  onStatus?.("Opening the PDF");
  const pdfjs = await loadPdfjs();
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), ...pdfAssetOptions() }).promise;
  const lexiconPromise = loadLexicon(assetPrefix());
  const lines: Line[] = [];
  const empty: number[] = [];
  const size = new Map<number, { w: number; h: number }>();
  for (let n = 1; n <= doc.numPages; n++) {
    if (n === 1 || n % 20 === 0) onStatus?.(`Reading page ${n} of ${doc.numPages}`);
    const page = await doc.getPage(n);
    const view = page.getViewport({ scale: 1 });
    size.set(n, { w: view.width, h: view.height });
    const content = await page.getTextContent();
    const clustered = cluster(content.items as { str: string; transform: number[]; width?: number; height?: number }[]);
    if (!clustered.length) empty.push(n);
    for (const ln of clustered) lines.push({ ...ln, page: n, pageH: view.height, pageW: view.width });
  }
  let warning: string | undefined;
  if (empty.length && settings.pictures === "empty") {
    try {
      const read = await readPicturePages(
        empty.map((n) => {
          const box = size.get(n) || { w: 612, h: 792 };
          return {
            n,
            pageW: box.w,
            pageH: box.h,
            draw: async () => {
              const page = await doc.getPage(n);
              const scale = pictureScale(box.w, box.h);
              const viewport = page.getViewport({ scale });
              const canvas = document.createElement("canvas");
              canvas.width = Math.ceil(viewport.width);
              canvas.height = Math.ceil(viewport.height);
              const ctx = canvas.getContext("2d");
              if (!ctx) throw new Error("Could not draw that page.");
              await page.render({ canvas, canvasContext: ctx, viewport }).promise;
              return canvas;
            },
          };
        }),
        doc.numPages,
        settings.kind,
        onStatus,
      );
      lines.push(...read.lines);
      warning = read.warning;
    } catch (err) {
      if (!lines.length) {
        throw err instanceof Error ? err : new Error("Could not read the pictures of those pages.");
      }
      warning = err instanceof Error ? err.message : "Some picture pages could not be read.";
    }
  } else if (settings.kind === "vision") {
    warning =
      settings.pictures === "off"
        ? "Pictures of pages is off, so the vision model was not used."
        : "Every page already had text, so the vision model was not used.";
    onStatus?.(warning);
  }
  let title = titleFromName(filename);
  let author = "";
  try {
    const meta = await doc.getMetadata();
    const info = meta?.info as { Title?: string; Author?: string } | undefined;
    if (info?.Title && String(info.Title).trim()) title = String(info.Title).replace(/\s+/g, " ").trim();
    if (info?.Author) author = String(info.Author).replace(/\s+/g, " ").trim();
  } catch {
    /* a book without a metadata dictionary still converts */
  }
  let cover: string | undefined;
  try {
    const leaf = await doc.getPage(1);
    const base = leaf.getViewport({ scale: 1 });
    const viewport = leaf.getViewport({ scale: Math.min(1.5, 1400 / Math.max(base.width, base.height)) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (ctx) {
      await leaf.render({ canvas, canvasContext: ctx, viewport }).promise;
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      cover = jpegFromRgba(canvas.width, canvas.height, frame.data);
      canvas.width = 0;
      canvas.height = 0;
    }
  } catch {
    /* a book with no drawable first page still converts */
  }
  onStatus?.("Reading the contents");
  const [outline, lexicon] = await Promise.all([readOutline(doc, doc.numPages), lexiconPromise]);
  const folio = assembleFolio(lines, {
    title,
    author,
    subtitle: author ? `${author} · from a PDF` : "From a PDF",
    sourceName: filename,
    outline,
    lexicon,
    emptyMessage:
      settings.pictures === "empty" && empty.length
        ? "No text could be read from that PDF, including the pictures of its pages."
        : NO_TEXT,
    onStatus,
  });
  if (warning) folio.warning = warning;
  if (cover) folio.cover = cover;
  folio.origin = { name: filename, kind: "pdf" };
  return folio;
}

export async function folioFromFile(
  data: ArrayBuffer,
  filename: string,
  onStatus?: (s: string) => void,
  settings: DeskSettings = DEFAULT_SETTINGS,
): Promise<Folio> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".djvu") || lower.endsWith(".djv")) {
    const { folioFromDjvu } = await import("./from-djvu");
    return folioFromDjvu(data, filename, onStatus, settings);
  }
  const head = new Uint8Array(data.slice(0, 5));
  const pdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
  if (lower.endsWith(".pdf") || pdf) return folioFromPdf(data, filename, onStatus);
  throw new Error("Open a PDF or a DjVu file.");
}
