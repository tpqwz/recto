import { previewPathPrefix } from "@/lib/preview-path-prefix";
import { assembleFolio, cluster, type Folio, type Line, type OutlineItem } from "./assemble";
import { jpegFromRgba } from "./cover";
import { loadLexicon } from "./repair";
import { DEFAULT_SETTINGS, type DeskSettings } from "./settings";

const NO_TEXT = "No text layer in that DjVu. Recto reads the hidden text, not a picture of the page.";
const NO_TEXT_PICTURES = "No text layer in that DjVu. Picture reading is for a PDF.";

type Zone = { x: number; y: number; width: number; height: number; text: string };
type Bookmark = { description?: string; url?: string; children?: Bookmark[] };
type DjVuWorker = {
  createDocument: (buffer: ArrayBuffer, options?: { memoryLimit?: number }) => Promise<void>;
  doc: {
    getPagesQuantity: () => { run: () => Promise<number> };
    isBundled: () => { run: () => Promise<boolean> };
    getPagesSizes: () => { run: () => Promise<Array<{ width: number; height: number; dpi?: number }>> };
    getContents: () => { run: () => Promise<Bookmark[] | null> };
    getPageNumberByUrl: (url: string) => unknown;
    getPage: (n: number) => {
      getNormalizedTextZones: () => unknown;
      getText: () => unknown;
      getImageData: () => unknown;
    };
  };
  run: (...tasks: unknown[]) => Promise<unknown>;
  terminate: () => void;
};

type DjVuNS = { Worker: new () => DjVuWorker };

let loading: Promise<DjVuNS> | null = null;

function loadDjVu() {
  const host = window as Window & { DjVu?: DjVuNS };
  if (host.DjVu?.Worker) return Promise.resolve(host.DjVu);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const prefix = previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
    script.src = `${prefix}/vendor/djvu.js`;
    script.onload = () => (host.DjVu?.Worker ? resolve(host.DjVu) : reject(new Error("Could not load the DjVu reader.")));
    script.onerror = () => reject(new Error("Could not load the DjVu reader."));
    document.head.appendChild(script);
  });
  return loading;
}

function asList(count: number, result: unknown) {
  if (count === 1) return [result];
  return Array.isArray(result) ? result : [result];
}

function titleFromName(filename: string) {
  return filename.replace(/\.(djvu|djv)$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim() || "Opened book";
}

async function readOutline(worker: DjVuWorker, pageCount: number): Promise<OutlineItem[]> {
  const contents = (await worker.run(worker.doc.getContents())) as Bookmark[] | null;
  if (!Array.isArray(contents) || !contents.length) return [];
  const flat: Bookmark[] = [];
  const walk = (nodes: Bookmark[], depth: number) => {
    for (const node of nodes) {
      flat.push(node);
      if (depth < 1 && node.children?.length) walk(node.children, depth + 1);
    }
  };
  walk(contents.slice(0, 400), 0);
  const urls = flat.map((node) => (node.url && node.url.startsWith("#") ? node.url : "#"));
  const found = asList(urls.length, await worker.run(...urls.map((url) => worker.doc.getPageNumberByUrl(url)))) as Array<number | null>;
  let cursor = 0;
  const build = (nodes: Bookmark[], depth: number): OutlineItem[] =>
    nodes.slice(0, 400).map((node) => {
      const page = found[cursor++];
      const children = depth < 1 && node.children?.length ? build(node.children, depth + 1) : [];
      const label = String(node.description || "").replace(/\s+/g, " ").trim().slice(0, 180);
      const safe = typeof page === "number" && page >= 1 && page <= pageCount ? page : null;
      return { label, page: safe ?? children.find((c) => c.page)?.page ?? null, children };
    });
  return build(contents, 0).filter((item) => item.label);
}

export async function folioFromDjvu(
  data: ArrayBuffer,
  filename: string,
  onStatus?: (s: string) => void,
  settings: DeskSettings = DEFAULT_SETTINGS,
): Promise<Folio> {
  onStatus?.("Opening the DjVu");
  const DjVu = await loadDjVu();
  const worker = new DjVu.Worker();
  try {
    const copy = data.slice(0);
    await worker.createDocument(copy, { memoryLimit: Math.min(512 * 1024 * 1024, Math.max(64 * 1024 * 1024, copy.byteLength * 8)) });
    const bundled = (await worker.run(worker.doc.isBundled())) as boolean;
    if (!bundled) throw new Error("That DjVu is split into separate page files. Open the single bundled file.");
    const lexiconPromise = loadLexicon(previewPathPrefix(window.location.hostname, window.location.pathname) ?? "");
    const quantity = (await worker.run(worker.doc.getPagesQuantity())) as number;
    const sizes = (await worker.run(worker.doc.getPagesSizes())) as Array<{ width: number; height: number }>;
    const lines: Line[] = [];
    const batch = 6;
    for (let start = 1; start <= quantity; start += batch) {
      onStatus?.(`Reading page ${start} of ${quantity}`);
      const nums: number[] = [];
      const tasks: unknown[] = [];
      for (let n = start; n < start + batch && n <= quantity; n++) {
        nums.push(n);
        tasks.push(worker.doc.getPage(n).getNormalizedTextZones());
      }
      const zonesList = asList(nums.length, await worker.run(...tasks)) as Array<Zone[] | null>;
      for (let i = 0; i < nums.length; i++) {
        const n = nums[i];
        const size = sizes[n - 1] || { width: 800, height: 1100 };
        const scale = 800 / (size.height || 1100);
        const pageW = size.width * scale;
        const pageH = size.height * scale;
        const zones = zonesList[i];
        if (zones?.length) {
          const items = zones
            .filter((z) => z && String(z.text || "").trim())
            .map((z) => ({
              str: String(z.text),
              transform: [1, 0, 0, 1, z.x * scale, pageH - (z.y + z.height) * scale],
              width: Math.max(z.width * scale, 1),
              height: Math.max((z.height || 8) * scale, 1),
            }));
          for (const ln of cluster(items)) lines.push({ ...ln, page: n, pageH, pageW });
          continue;
        }
        const text = String((await worker.run(worker.doc.getPage(n).getText())) || "");
        const rows = text.split(/\n/).map((row) => row.trim()).filter(Boolean);
        rows.forEach((row, rowIndex) => {
          lines.push({
            text: row,
            y: pageH - 48 - rowIndex * 16,
            x0: 48,
            x1: Math.max(120, pageW - 48),
            h: 12,
            page: n,
            pageH,
            pageW,
          });
        });
      }
    }
    onStatus?.("Reading the contents");
    const [outline, lexicon] = await Promise.all([readOutline(worker, quantity), lexiconPromise]);
    const folio = assembleFolio(lines, {
      title: titleFromName(filename),
      subtitle: "From a DjVu",
      sourceName: filename,
      outline,
      lexicon,
      emptyMessage: settings.pictures === "empty" ? NO_TEXT_PICTURES : NO_TEXT,
      onStatus,
    });
    folio.origin = { name: filename, kind: "djvu" };
    try {
      const image = (await worker.run(worker.doc.getPage(1).getImageData())) as { width: number; height: number; buffer: ArrayBuffer };
      const pixels = new Uint8ClampedArray(image.width * image.height * 4);
      pixels.set(new Uint8ClampedArray(image.buffer));
      const cover = jpegFromRgba(image.width, image.height, pixels);
      if (cover) folio.cover = cover;
    } catch {
      /* the text still converts when the first page will not draw */
    }
    return folio;
  } finally {
    worker.terminate();
  }
}
