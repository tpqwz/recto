import { useEffect, useRef, useState } from "react";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { previewPathPrefix } from "@/lib/preview-path-prefix";
import { imageNames, unzip } from "./packed.ts";
import { canvasFromBytes, decodeTiff, mimeOf } from "./raster.ts";
import { loadPdfjs, pdfAssetOptions } from "./pdf-local.ts";
import { originalLabel, previewText, quoteWindow, type Retained } from "./source.ts";

type DjVuWorker = {
  createDocument: (buffer: ArrayBuffer, options?: { memoryLimit?: number }) => Promise<void>;
  doc: { getPagesQuantity: () => { run: () => Promise<number> }; getPage: (n: number) => { getImageData: () => unknown } };
  run: (...tasks: unknown[]) => Promise<unknown>;
  terminate: () => void;
};

function loadDjVu() {
  const host = window as Window & { DjVu?: { Worker: new () => DjVuWorker } };
  if (host.DjVu?.Worker) return Promise.resolve(host.DjVu);
  return new Promise<{ Worker: new () => DjVuWorker }>((resolve, reject) => {
    const script = document.createElement("script");
    const prefix = previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
    script.src = `${prefix}/vendor/djvu.js`;
    script.onload = () => (host.DjVu?.Worker ? resolve(host.DjVu) : reject(new Error("Could not load the DjVu reader.")));
    script.onerror = () => reject(new Error("Could not load the DjVu reader."));
    document.head.appendChild(script);
  });
}

async function drawPdf(bytes: ArrayBuffer, page: number, canvas: HTMLCanvasElement, width: number) {
  const pdfjs = await loadPdfjs();
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), ...pdfAssetOptions() }).promise;
  const safe = Math.min(doc.numPages, Math.max(1, page));
  const leaf = await doc.getPage(safe);
  const base = leaf.getViewport({ scale: 1 });
  const viewport = leaf.getViewport({ scale: Math.min(2, Math.max(0.6, (width - 24) / base.width)) });
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not draw that page.");
  await leaf.render({ canvas, canvasContext: ctx, viewport }).promise;
  const count = doc.numPages;
  const closer = doc as unknown as { destroy?: () => Promise<void> };
  await closer.destroy?.();
  return { count, page: safe };
}

async function drawDjvu(bytes: ArrayBuffer, page: number, canvas: HTMLCanvasElement) {
  const DjVu = await loadDjVu();
  const worker = new DjVu.Worker();
  try {
    const copy = bytes.slice(0);
    await worker.createDocument(copy, { memoryLimit: Math.min(512 * 1024 * 1024, Math.max(64 * 1024 * 1024, copy.byteLength * 8)) });
    const count = (await worker.run(worker.doc.getPagesQuantity())) as number;
    const safe = Math.min(count, Math.max(1, page));
    const image = (await worker.run(worker.doc.getPage(safe).getImageData())) as { width: number; height: number; buffer: ArrayBuffer };
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not draw that page.");
    const pixels = new Uint8ClampedArray(image.width * image.height * 4);
    pixels.set(new Uint8ClampedArray(image.buffer));
    ctx.putImageData(new ImageData(pixels, image.width, image.height), 0, 0);
    return { count, page: safe };
  } finally {
    worker.terminate();
  }
}

async function pageImages(record: Retained) {
  const bytes = new Uint8Array(record.bytes);
  if (record.kind === "image") {
    if (/\.tif/i.test(record.name) || bytes[0] === 0x49 || bytes[0] === 0x4d) {
      const frames = await decodeTiff(bytes);
      return frames.map((frame) => {
        const canvas = document.createElement("canvas");
        canvas.width = frame.width;
        canvas.height = frame.height;
        const pixels = new Uint8ClampedArray(frame.rgba);
        canvas.getContext("2d")?.putImageData(new ImageData(pixels, frame.width, frame.height), 0, 0);
        return canvas;
      });
    }
    return [await canvasFromBytes(bytes, mimeOf(record.name, bytes))];
  }
  const files = unzip(bytes);
  const names = imageNames(files);
  const canvases: HTMLCanvasElement[] = [];
  for (const name of names) canvases.push(await canvasFromBytes(files[name], mimeOf(name, files[name])));
  return canvases;
}

export function SourcePane({
  record,
  page,
  quote,
  onPage,
  onClose,
}: {
  record: Retained;
  page: number;
  quote: string;
  onPage: (page: number) => void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onPageRef = useRef(onPage);
  onPageRef.current = onPage;
  const [count, setCount] = useState(1);
  const [error, setError] = useState("");
  const [text, setText] = useState<{ before: string; match: string; after: string } | null>(null);
  const pictured = record.kind === "pdf" || record.kind === "djvu" || record.kind === "image" || record.kind === "pages";

  useEffect(() => {
    let dead = false;
    setError("");
    const canvas = canvasRef.current;
    (async () => {
      try {
        if (record.kind === "pdf" || record.kind === "djvu") {
          if (!canvas) return;
          const width = canvas.parentElement?.clientWidth || 640;
          const drawn = record.kind === "pdf" ? await drawPdf(record.bytes, page, canvas, width) : await drawDjvu(record.bytes, page, canvas);
          if (dead) return;
          setCount(drawn.count);
          if (drawn.page !== page) onPageRef.current(drawn.page);
          setText(null);
          return;
        }
        if (record.kind === "image" || record.kind === "pages") {
          const frames = await pageImages(record);
          if (dead) return;
          setCount(Math.max(1, frames.length));
          const safe = Math.min(frames.length, Math.max(1, page)) - 1;
          const frame = frames[safe];
          if (canvas && frame) {
            canvas.width = frame.width;
            canvas.height = frame.height;
            canvas.getContext("2d")?.drawImage(frame, 0, 0);
          }
          setText(null);
          return;
        }
        const body = previewText(record.name, new Uint8Array(record.bytes));
        if (dead) return;
        setText(body ? quoteWindow(body, quote) : null);
        if (!body) setError("The original is kept, but this file has no page to show.");
      } catch (err) {
        if (!dead) setError(err instanceof Error ? err.message : "Could not open the original.");
      }
    })();
    return () => {
      dead = true;
    };
  }, [record, page, quote]);

  return (
    <aside className="fixed inset-0 z-40 flex min-h-0 flex-col overflow-hidden bg-paper text-ink md:static md:z-auto md:h-full md:w-[min(40rem,46vw)] md:border-l md:border-rule">
      <div className="flex items-center gap-2 border-b border-rule px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{originalLabel(record.kind)}</p>
          <p className="truncate text-xs text-muted">{record.name}</p>
        </div>
        {pictured && count > 1 ? (
          <div className="flex items-center gap-1 text-sm">
            <button type="button" className="h-11 px-2 text-muted" onClick={() => onPage(Math.max(1, page - 1))} aria-label="Previous page">
              Prev
            </button>
            <span className="tabular-nums text-xs text-muted">
              {page}/{count}
            </span>
            <button type="button" className="h-11 px-2 text-muted" onClick={() => onPage(Math.min(count, page + 1))} aria-label="Next page">
              Next
            </button>
          </div>
        ) : null}
        <button type="button" className="h-11 px-3 text-sm text-cinnabar" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-4">
        {error ? <p className="text-sm text-muted">{error}</p> : null}
        {pictured ? <canvas ref={canvasRef} className="mx-auto block max-w-full bg-paper-2" /> : null}
        {text ? (
          <p className="font-serif text-lg leading-relaxed">
            {text.before}
            {text.match ? <mark className="bg-[#efd3c8] text-ink">{text.match}</mark> : null}
            {text.after}
          </p>
        ) : null}
      </div>
    </aside>
  );
}
