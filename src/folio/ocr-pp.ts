import { previewPathPrefix } from "@/lib/preview-path-prefix";
import { linesFromBoxes, type PictureBox } from "./picture.ts";

type PpPredict = {
  predict: (input: HTMLCanvasElement) => Promise<Array<{ items?: Array<{ text?: string; poly?: [number, number][] }> }>>;
};

let pending: Promise<PpPredict> | null = null;

function packaged(path: string) {
  const prefix = typeof window === "undefined" ? "" : (previewPathPrefix(window.location.hostname, window.location.pathname) ?? "");
  return new URL(`${prefix}${path}`, window.location.origin).href;
}

export function loadPp(onStatus?: (s: string) => void) {
  if (!pending) {
    onStatus?.("Opening PP-OCR");
    pending = (async () => {
      const { PaddleOCR } = await import("@paddleocr/paddleocr-js");
      const created = await PaddleOCR.create({
        lang: "en",
        ocrVersion: "PP-OCRv5",
        textDetectionModelName: "PP-OCRv5_mobile_det",
        textDetectionModelAsset: { url: packaged("/vendor/ppocr/det.tar") },
        textRecognitionModelName: "PP-OCRv5_mobile_rec",
        textRecognitionModelAsset: { url: packaged("/vendor/ppocr/rec.tar") },
        worker: true,
        textRecognitionBatchSize: 6,
        ortOptions: { backend: "auto", numThreads: 1, wasmPaths: packaged("/vendor/ort/") },
      });
      return created as unknown as PpPredict;
    })().catch((err: unknown) => {
      pending = null;
      const detail = err instanceof Error ? err.message : "PP-OCR did not start.";
      throw new Error(detail.startsWith("PP-OCR") ? detail : `PP-OCR did not start. ${detail}`);
    });
  }
  return pending;
}

export async function readPpPage(canvas: HTMLCanvasElement, page: number, pageW: number, pageH: number) {
  const ocr = await loadPp();
  const [result] = await ocr.predict(canvas);
  const items: PictureBox[] = (result?.items || []).map((item) => ({
    text: item.text || "",
    poly: item.poly || [],
  }));
  return linesFromBoxes(items, page, pageW, pageH, canvas.width, canvas.height);
}
