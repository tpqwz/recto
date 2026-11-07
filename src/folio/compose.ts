import { assembleFolio, epubArchive, type Folio, type Line, type OutlineItem } from "./assemble";
import { loadLexicon } from "./repair";

export type ComposeOptions = {
  title: string;
  subtitle: string;
  author?: string;
  sourceName: string;
  outline?: OutlineItem[];
  emptyMessage: string;
  lexiconPrefix: string;
  /** Off leaves every word as the text layer printed it. */
  corrections?: boolean;
  cover?: string;
  onStatus?: (status: string) => void;
};

type Reply =
  | { id: number; status: string }
  | { id: number; folio: Folio; bytes: Uint8Array }
  | { id: number; error: string };

let worker: Worker | null = null;
let seq = 0;

function epubUrl(bytes: Uint8Array) {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return URL.createObjectURL(new Blob([copy], { type: "application/epub+zip" }));
}

/** Assemble and pack the book off the reading thread. The page stays responsive. */
export function composeFolio(lines: Line[], options: ComposeOptions): Promise<Folio> {
  if (typeof Worker === "undefined" || typeof window === "undefined") return onThisThread(lines, options);
  return new Promise((resolve, reject) => {
    let mine: Worker;
    try {
      mine = worker || (worker = new Worker(new URL("./compose.worker.ts", import.meta.url), { type: "module" }));
    } catch {
      void onThisThread(lines, options).then(resolve, reject);
      return;
    }
    const id = ++seq;
    const finish = (folio: Folio, bytes?: Uint8Array) => {
      if (bytes) folio.epubHref = epubUrl(bytes);
      if (!folio.epubName) {
        folio.epubName = `${folio.title.replace(/[^\w.-]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "folio"}.epub`;
      }
      resolve(folio);
    };
    const onMessage = (event: MessageEvent<Reply>) => {
      const msg = event.data;
      if (!msg || msg.id !== id) return;
      if ("status" in msg && msg.status) {
        options.onStatus?.(msg.status);
        return;
      }
      mine.removeEventListener("message", onMessage);
      mine.removeEventListener("error", onError);
      if ("error" in msg) {
        reject(new Error(msg.error));
        return;
      }
      if ("folio" in msg) finish(msg.folio, msg.bytes);
    };
    const onError = () => {
      mine.removeEventListener("message", onMessage);
      mine.removeEventListener("error", onError);
      worker = null;
      void onThisThread(lines, options).then(resolve, reject);
    };
    mine.addEventListener("message", onMessage);
    mine.addEventListener("error", onError);
    mine.postMessage({
      id,
      lines,
      title: options.title,
      subtitle: options.subtitle,
      author: options.author,
      sourceName: options.sourceName,
      outline: options.outline,
      emptyMessage: options.emptyMessage,
      lexiconPrefix: options.lexiconPrefix,
      corrections: options.corrections === true,
      cover: options.cover,
    });
  });
}

async function onThisThread(lines: Line[], options: ComposeOptions): Promise<Folio> {
  const lexicon = options.corrections ? await loadLexicon(options.lexiconPrefix) : null;
  const folio = assembleFolio(lines, { ...options, lexicon, skipEpub: true });
  options.onStatus?.("Making the EPUB");
  const bytes = epubArchive(folio, options.sourceName);
  folio.epubHref = epubUrl(bytes);
  folio.epubName = `${folio.title.replace(/[^\w.-]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "folio"}.epub`;
  return folio;
}
