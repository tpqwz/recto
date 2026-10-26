import { imageNames, textOf, unzip } from "./packed.ts";
import { mimeOf } from "./raster.ts";

export type OriginKind = "pdf" | "djvu" | "image" | "pages" | "text";

export type Retained = {
  key: string;
  name: string;
  kind: OriginKind;
  bytes: ArrayBuffer;
};

const DB = "recto-sources";
const STORE = "files";

function latinAt(bytes: Uint8Array, at: number, text: string) {
  if (at + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i++) if (bytes[at + i] !== text.charCodeAt(i)) return false;
  return true;
}

export function detectKind(name: string, bytes: Uint8Array): OriginKind {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf") || latinAt(bytes, 0, "%PDF")) return "pdf";
  if (lower.endsWith(".djvu") || lower.endsWith(".djv") || latinAt(bytes, 0, "AT&T")) return "djvu";
  if (lower.endsWith(".tif") || lower.endsWith(".tiff") || latinAt(bytes, 0, "II*\0") || latinAt(bytes, 0, "MM\0*")) return "image";
  const mime = mimeOf(name, bytes);
  if (mime.startsWith("image/")) return "image";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    try {
      const files = unzip(bytes);
      const names = Object.keys(files);
      if (names.some((item) => item === "word/document.xml" || item.endsWith(".fb2") || item === "META-INF/container.xml")) return "text";
      if (imageNames(files).length) return "pages";
    } catch {
      return "text";
    }
  }
  return "text";
}

export function originalLabel(kind: OriginKind) {
  if (kind === "pdf") return "In the PDF";
  if (kind === "djvu") return "In the DjVu";
  if (kind === "image" || kind === "pages") return "The picture";
  return "In the original";
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function keepSource(key: string, name: string, kind: OriginKind, bytes: ArrayBuffer) {
  if (typeof indexedDB === "undefined") return;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(new Uint8Array(bytes));
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ key, name, kind, bytes: copy }, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadSource(key: string): Promise<Retained | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await openDb();
  const row = await new Promise<Retained | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result as Retained | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  if (!row?.bytes) return null;
  const raw = row.bytes as ArrayBuffer | Uint8Array;
  const bytes = raw instanceof Uint8Array ? raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) : raw;
  return { ...row, bytes: bytes as ArrayBuffer };
}

export async function dropSource(key: string) {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

function plain(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[#a-z0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A readable copy of a retained file that is not a page picture. */
export function previewText(name: string, bytes: Uint8Array) {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    try {
      const files = unzip(bytes);
      const doc = files["word/document.xml"];
      if (doc) {
        const parts = [...textOf(doc).matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((found) => found[1]);
        if (parts.length) return plain(parts.join(" "));
      }
      const html = Object.keys(files).filter((item) => /\.html?$/i.test(item) || item.toLowerCase().endsWith(".fb2"));
      if (html.length) return plain(html.map((item) => textOf(files[item])).join("\n"));
    } catch {
      return "";
    }
  }
  const decode = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : "utf-8";
  const text = new TextDecoder(decode, { fatal: false }).decode(bytes);
  if (!text.trim()) return "";
  return /<[^>]+>/.test(text.slice(0, 2000)) ? plain(text) : text;
}

export function quoteWindow(text: string, quote: string) {
  const flat = text.replace(/\s+/g, " ");
  const needle = quote.replace(/\s+/g, " ").trim().slice(0, 80);
  const at = needle.length > 8 ? flat.toLowerCase().indexOf(needle.toLowerCase()) : -1;
  if (at < 0) return { before: flat.slice(0, 1200), match: "", after: flat.length > 1200 ? flat.slice(1200, 2400) : "" };
  const from = Math.max(0, at - 280);
  return { before: flat.slice(from, at), match: flat.slice(at, at + needle.length), after: flat.slice(at + needle.length, at + needle.length + 700) };
}
