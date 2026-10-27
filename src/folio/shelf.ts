import type { Folio } from "./assemble.ts";
import type { CatalogRecord } from "./library.ts";
import { bookKey, dropBook } from "./revise.ts";
import { dropSource } from "./source.ts";

export type SampleId = "dhammapada" | "varieties" | "republic" | "cannon" | "ascent";

export type ShelfEntry = {
  id: string;
  title: string;
  author: string;
  kind: "sample" | "opened";
  sampleId?: SampleId;
  originName?: string;
  /** The work, when the file is one volume of it. */
  work?: string;
  edition?: string;
  translator?: string;
  year?: string;
  language?: string;
  volume?: string;
};

export type ShelfState = {
  hidden: SampleId[];
  opened: ShelfEntry[];
  /** Most recently opened first. The shelf shows only the first handful. */
  recent?: string[];
  /** Catalog edits, keyed by the shelf id. Samples live here; opened books do too. */
  records?: Record<string, CatalogRecord>;
};

export const SHELF_LIMIT = 5;

export const SAMPLES: ShelfEntry[] = [
  { id: "sample:dhammapada", sampleId: "dhammapada", kind: "sample", title: "The Dhammapada", author: "F. Max Müller" },
  { id: "sample:varieties", sampleId: "varieties", kind: "sample", title: "The Varieties of Religious Experience", author: "William James" },
  { id: "sample:republic", sampleId: "republic", kind: "sample", title: "The Republic", author: "Plato" },
  { id: "sample:cannon", sampleId: "cannon", kind: "sample", title: "Bodily Changes in Pain, Hunger, Fear and Rage", author: "Walter B. Cannon" },
  { id: "sample:ascent", sampleId: "ascent", kind: "sample", title: "The Ascent of Mount Carmel", author: "St. John of the Cross" },
];

const KEY = "recto-shelf:v1";
const FOLIO_DB = "recto-folios";
const FOLIO_STORE = "books";

export function emptyShelf(): ShelfState {
  return { hidden: [], opened: [] };
}

export function loadShelf(): ShelfState {
  if (typeof localStorage === "undefined") return emptyShelf();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyShelf();
    const parsed = JSON.parse(raw) as ShelfState;
    if (!parsed || !Array.isArray(parsed.hidden) || !Array.isArray(parsed.opened)) return emptyShelf();
    return {
      hidden: parsed.hidden,
      opened: parsed.opened.filter((item) => item?.kind === "opened" && item.title && item.id),
      recent: Array.isArray(parsed.recent) ? parsed.recent : [],
      records: parsed.records && typeof parsed.records === "object" ? parsed.records : {},
    };
  } catch {
    return emptyShelf();
  }
}

export function saveShelf(state: ShelfState) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function listHoldings(state: ShelfState): ShelfEntry[] {
  const hidden = new Set(state.hidden);
  const samples = SAMPLES.filter((item) => item.sampleId && !hidden.has(item.sampleId));
  const sampleKeys = new Set(SAMPLES.map((item) => bookKey(item)));
  const opened = state.opened.filter((item) => !sampleKeys.has(item.id));
  return [...opened, ...samples];
}

export function listShelf(state: ShelfState): ShelfEntry[] {
  const all = listHoldings(state);
  const byKey = new Map(all.map((entry) => [entryKey(entry), entry]));
  const opened = state.opened.filter((entry) => byKey.has(entryKey(entry)));
  const openedKeys = new Set(opened.map((entry) => entryKey(entry)));
  const recentOpened = (state.recent || []).map((id) => byKey.get(id)).filter((entry): entry is ShelfEntry => !!entry && openedKeys.has(entryKey(entry)));
  const olderOpened = opened.filter((entry) => !recentOpened.some((item) => entryKey(item) === entryKey(entry)));
  const samples = all.filter((entry) => entry.kind === "sample");
  const recentSamples = (state.recent || []).map((id) => byKey.get(id)).filter((entry): entry is ShelfEntry => !!entry && entry.kind === "sample");
  const olderSamples = samples.filter((entry) => !recentSamples.some((item) => entryKey(item) === entryKey(entry)));
  const picked: ShelfEntry[] = [];
  for (const entry of [...recentOpened, ...olderOpened, ...recentSamples, ...olderSamples]) {
    if (picked.length >= SHELF_LIMIT) break;
    if (picked.some((item) => entryKey(item) === entryKey(entry))) continue;
    picked.push(entry);
  }
  return picked;
}

export function rememberRecent(state: ShelfState, id: string): ShelfState {
  return { ...state, recent: [id, ...(state.recent || []).filter((item) => item !== id)].slice(0, 200) };
}

export function rememberOpened(state: ShelfState, entry: ShelfEntry): ShelfState {
  if (SAMPLES.some((item) => bookKey(item) === entry.id)) return rememberRecent(state, entry.id);
  return rememberRecent(
    { ...state, opened: [entry, ...state.opened.filter((item) => item.id !== entry.id)].slice(0, 200) },
    entry.id,
  );
}

/** Drop a sample's stored epub and reading text from this browser's cache. */
export async function releaseCachedSample(id: string): Promise<number> {
  if (typeof caches === "undefined") return 0;
  const names = [`/samples/${id}.epub`, `/samples/${id}.json`];
  const keys = await caches.keys();
  let dropped = 0;
  for (const key of keys) {
    const cache = await caches.open(key);
    for (const req of await cache.keys()) {
      if (!names.some((name) => req.url.includes(name))) continue;
      if (await cache.delete(req)) dropped += 1;
    }
  }
  return dropped;
}

export function hideSample(state: ShelfState, sampleId: SampleId): ShelfState {
  const sample = SAMPLES.find((item) => item.sampleId === sampleId);
  const recent = sample ? (state.recent || []).filter((id) => id !== bookKey(sample) && id !== sample.id) : state.recent;
  return { ...state, recent, hidden: state.hidden.includes(sampleId) ? state.hidden : [...state.hidden, sampleId] };
}

export function withoutOpened(state: ShelfState, id: string): ShelfState {
  return { ...state, opened: state.opened.filter((item) => item.id !== id) };
}

export function restoreSamples(state: ShelfState): ShelfState {
  return { ...state, hidden: [] };
}

export function entryKey(entry: ShelfEntry) {
  return entry.kind === "opened" ? entry.id : bookKey(entry);
}

export function placeKeys(entry: ShelfEntry) {
  const keys = [`recto-desk:${entry.title}`];
  if (entry.sampleId === "dhammapada") keys.push("recto-desk:place");
  return keys;
}

export function isSampleBook(folio: { title: string; author?: string }) {
  return SAMPLES.some((item) => bookKey(item) === bookKey(folio));
}

const PART_CHARS = 400_000;

export function splitStored(text: string, size = PART_CHARS): string[] {
  if (!text) return [""];
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
  return parts;
}

function folioDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(FOLIO_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(FOLIO_STORE)) request.result.createObjectStore(FOLIO_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbDone(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => void) {
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FOLIO_STORE, mode);
    run(tx.objectStore(FOLIO_STORE));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("The save was aborted."));
  });
}

function idbGet(db: IDBDatabase, key: string) {
  return new Promise<string | undefined>((resolve, reject) => {
    const request = db.transaction(FOLIO_STORE, "readonly").objectStore(FOLIO_STORE).get(key);
    request.onsuccess = () => resolve(request.result as string | undefined);
    request.onerror = () => reject(request.error);
  });
}

const READING_CACHE = "recto-reading";

async function readingUrl(key: string): Promise<string> {
  const origin = typeof location === "undefined" ? "https://recto.local" : location.origin;
  let name = encodeURIComponent(key).slice(0, 180);
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
    name = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return new URL(`/__recto/reading/${name}`, origin).href;
}

function storedFolio(folio: Folio): Folio {
  return { ...folio, epubHref: folio.epubHref?.startsWith("blob:") ? undefined : folio.epubHref };
}

/** A copy that survives a reload. IndexedDB is not required. */
export async function keepReadingCopy(key: string, folio: Folio) {
  rememberFolio(key, folio);
  if (typeof caches === "undefined") throw new Error("This browser cannot keep a book after a reload.");
  const cache = await caches.open(READING_CACHE);
  await cache.put(
    await readingUrl(key),
    new Response(JSON.stringify(storedFolio(folio)), { headers: { "content-type": "application/json" } }),
  );
}

export async function readReadingCopy(key: string): Promise<Folio | null> {
  if (typeof caches === "undefined") return null;
  const cache = await caches.open(READING_CACHE);
  const hit = await cache.match(await readingUrl(key));
  if (!hit) return null;
  return JSON.parse(await hit.text()) as Folio;
}

export async function dropReadingCopy(key: string) {
  if (typeof caches === "undefined") return;
  const cache = await caches.open(READING_CACHE);
  await cache.delete(await readingUrl(key));
}

const sessionFolios = new Map<string, Folio>();

export function rememberFolio(key: string, folio: Folio) {
  sessionFolios.set(key, { ...folio, epubHref: folio.epubHref?.startsWith("blob:") ? undefined : folio.epubHref });
}

export async function keepFolio(key: string, folio: Folio) {
  rememberFolio(key, folio);
  if (typeof indexedDB === "undefined") return;
  const cover = folio.cover;
  const stored = { ...folio, cover: undefined, epubHref: folio.epubHref?.startsWith("blob:") ? undefined : folio.epubHref };
  const parts = splitStored(JSON.stringify(stored));
  const db = await folioDb();
  try {
    const previous = await idbGet(db, key).catch(() => undefined);
    let oldCount = 0;
    if (previous) {
      try {
        const head = JSON.parse(previous) as { parts?: number; title?: string };
        if (typeof head.parts === "number" && !head.title) oldCount = head.parts;
      } catch {
        oldCount = 0;
      }
    }
    for (let i = 0; i < parts.length; i++) await idbDone(db, "readwrite", (store) => store.put(parts[i], `${key}\u0000${i}`));
    await idbDone(db, "readwrite", (store) => store.put(JSON.stringify({ parts: parts.length }), key));
    for (let i = parts.length; i < oldCount; i++) await idbDone(db, "readwrite", (store) => store.delete(`${key}\u0000${i}`));
    if (cover) {
      try {
        await idbDone(db, "readwrite", (store) => store.put(cover, `${key}\u0000cover`));
      } catch {
        await idbDone(db, "readwrite", (store) => store.delete(`${key}\u0000cover`)).catch(() => {});
      }
    } else {
      await idbDone(db, "readwrite", (store) => store.delete(`${key}\u0000cover`)).catch(() => {});
    }
  } finally {
    db.close();
  }
}

export async function loadFolio(key: string): Promise<Folio | null> {
  const remembered = sessionFolios.get(key);
  try {
    const cached = await Promise.race([
      readReadingCopy(key),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
    ]);
    if (cached) {
      sessionFolios.set(key, cached);
      return cached;
    }
  } catch {
    /* the durable copy can be missing; the database is the other place */
  }
  if (typeof indexedDB === "undefined") return remembered ?? null;
  try {
    const disk = await Promise.race([
      readFolio(key),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
    ]);
    if (disk) {
      sessionFolios.set(key, disk);
      return disk;
    }
  } catch {
    return remembered ?? null;
  }
  return remembered ?? null;
}

async function readFolio(key: string): Promise<Folio | null> {
  const db = await folioDb();
  try {
    const raw = await idbGet(db, key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Folio & { parts?: number };
    if (typeof parsed.parts === "number" && !parsed.title) {
      let json = "";
      for (let i = 0; i < parsed.parts; i++) {
        const part = await idbGet(db, `${key}\u0000${i}`);
        if (part == null) return null;
        json += part;
      }
      const folio = JSON.parse(json) as Folio;
      const cover = await idbGet(db, `${key}\u0000cover`).catch(() => undefined);
      if (cover) folio.cover = cover;
      return folio;
    }
    return parsed;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export async function dropFolio(key: string) {
  sessionFolios.delete(key);
  await dropReadingCopy(key).catch(() => {});
  if (typeof indexedDB === "undefined") return;
  const db = await folioDb();
  try {
    const raw = await idbGet(db, key).catch(() => undefined);
    let count = 0;
    if (raw) {
      try {
        const head = JSON.parse(raw) as { parts?: number; title?: string };
        if (typeof head.parts === "number" && !head.title) count = head.parts;
      } catch {
        count = 0;
      }
    }
    await idbDone(db, "readwrite", (store) => {
      store.delete(key);
      store.delete(`${key}\u0000cover`);
      for (let i = 0; i < count; i++) store.delete(`${key}\u0000${i}`);
    });
  } finally {
    db.close();
  }
}

/** Take a title off the shelf and the library. Storage is cleaned up separately. */
export function dismissEntry(state: ShelfState, entry: ShelfEntry): ShelfState {
  if (entry.sampleId) return hideSample(state, entry.sampleId);
  const key = entryKey(entry);
  const records = { ...(state.records || {}) };
  delete records[entry.id];
  delete records[key];
  return {
    ...state,
    opened: state.opened.filter((item) => item.id !== entry.id && item.id !== key),
    recent: (state.recent || []).filter((id) => id !== entry.id && id !== key),
    records,
  };
}

/** Take a title off this device: shelf entry, reading place, edits, original, and stored text. */
export async function forgetEntry(state: ShelfState, entry: ShelfEntry): Promise<ShelfState> {
  const next = dismissEntry(state, entry);
  if (!entry.sampleId) {
    const key = entryKey(entry);
    dropBook(key);
    if (typeof localStorage !== "undefined") {
      for (const place of placeKeys(entry)) localStorage.removeItem(place);
    }
    void dropStored(key, entry.id);
  }
  return next;
}

function dropStored(key: string, id: string) {
  const stop = new Promise((resolve) => setTimeout(resolve, 1500));
  void Promise.race([dropSource(key).catch(() => {}), stop]);
  void Promise.race([dropFolio(id).catch(() => {}), stop]);
}

export const bareDesk: Folio = {
  title: "Recto",
  subtitle: "Nothing is on the shelf",
  author: "",
  stats: { hyphensRejoined: 0, headersRemoved: 0, chapters: 0 },
  toc: [],
  chapters: [
    {
      id: "empty",
      title: "The shelf is empty",
      page: null,
      blocks: [{ t: "p", runs: ["Open a book, or put the sample editions back."] }],
    },
  ],
};
