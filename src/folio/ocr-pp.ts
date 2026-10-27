import { previewPathPrefix } from "@/lib/preview-path-prefix";
import { linesFromBoxes, type PictureBox } from "./picture.ts";
import { scriptLabel, type ReaderScript } from "./script.ts";

type PpPredict = {
  predict: (input: HTMLCanvasElement) => Promise<Array<{ items?: Array<{ text?: string; poly?: [number, number][] }> }>>;
};

const READERS: Record<ReaderScript, { file: string; model: string }> = {
  en: { file: "rec.tar", model: "PP-OCRv5_mobile_rec" },
  latin: { file: "latin.tar", model: "latin_PP-OCRv5_mobile_rec" },
  devanagari: { file: "devanagari.tar", model: "devanagari_PP-OCRv5_mobile_rec" },
  arabic: { file: "arabic.tar", model: "arabic_PP-OCRv5_mobile_rec" },
  cyrillic: { file: "cyrillic.tar", model: "cyrillic_PP-OCRv5_mobile_rec" },
  greek: { file: "el.tar", model: "el_PP-OCRv5_mobile_rec" },
  korean: { file: "korean.tar", model: "korean_PP-OCRv5_mobile_rec" },
  thai: { file: "th.tar", model: "th_PP-OCRv5_mobile_rec" },
  tamil: { file: "ta.tar", model: "ta_PP-OCRv5_mobile_rec" },
  telugu: { file: "te.tar", model: "te_PP-OCRv5_mobile_rec" },
};

const READER_CACHE = "recto-readers";
const pending = new Map<ReaderScript, Promise<PpPredict>>();

export async function storeScriptReader(script: ReaderScript) {
  if (script === "en") return;
  if (typeof caches === "undefined") throw new Error("This browser cannot store that reader.");
  const cache = await caches.open(READER_CACHE);
  const url = packaged(`/vendor/ppocr/${READERS[script].file}`);
  if (await cache.match(url)) return;
  const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}store=1`);
  if (!response.ok) throw new Error(`The ${scriptLabel(script)} reader could not be stored (${response.status}).`);
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength) throw new Error(`The ${scriptLabel(script)} reader came back empty.`);
  await cache.put(
    url,
    new Response(bytes, {
      status: 200,
      headers: { "Content-Type": "application/octet-stream", "Content-Length": String(bytes.byteLength) },
    }),
  );
}

export async function dropScriptReader(script: ReaderScript) {
  if (script === "en") return;
  pending.delete(script);
  if (typeof caches === "undefined") return;
  const name = READERS[script].file;
  const keys = await caches.keys();
  for (const key of keys) {
    const cache = await caches.open(key);
    for (const req of await cache.keys()) {
      if (req.url.includes(`/vendor/ppocr/${name}`)) await cache.delete(req);
    }
  }
}

function packaged(path: string) {
  const prefix = typeof window === "undefined" ? "" : (previewPathPrefix(window.location.hostname, window.location.pathname) ?? "");
  return new URL(`${prefix}${path}`, window.location.origin).href;
}

export function loadPp(onStatus?: (s: string) => void, script: ReaderScript = "en") {
  const existing = pending.get(script);
  if (existing) return existing;
  const reader = READERS[script];
  onStatus?.(script === "en" ? "Opening PP-OCR" : `Opening the ${scriptLabel(script)} reader`);
  const created = (async () => {
    const { PaddleOCR } = await import("@paddleocr/paddleocr-js");
    const engine = await PaddleOCR.create({
      lang: "en",
      ocrVersion: "PP-OCRv5",
      textDetectionModelName: "PP-OCRv5_mobile_det",
      textDetectionModelAsset: { url: packaged("/vendor/ppocr/det.tar") },
      textRecognitionModelName: reader.model,
      textRecognitionModelAsset: { url: packaged(`/vendor/ppocr/${reader.file}`) },
      worker: true,
      textRecognitionBatchSize: 6,
      ortOptions: { backend: "auto", numThreads: 1, wasmPaths: packaged("/vendor/ort/") },
    });
    return engine as unknown as PpPredict;
  })().catch((err: unknown) => {
    pending.delete(script);
    const detail = err instanceof Error ? err.message : "PP-OCR did not start.";
    throw new Error(detail.startsWith("PP-OCR") ? detail : `PP-OCR did not start. ${detail}`);
  });
  pending.set(script, created);
  return created;
}

export async function readPpPage(
  canvas: HTMLCanvasElement,
  page: number,
  pageW: number,
  pageH: number,
  script: ReaderScript = "en",
) {
  const ocr = await loadPp(undefined, script);
  const [result] = await ocr.predict(canvas);
  const items: PictureBox[] = (result?.items || []).map((item) => ({
    text: item.text || "",
    poly: item.poly || [],
  }));
  return linesFromBoxes(items, page, pageW, pageH, canvas.width, canvas.height);
}
