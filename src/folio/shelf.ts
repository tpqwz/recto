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
  const byId = new Map(all.map((entry) => [entryKey(entry), entry]));
  const picked: ShelfEntry[] = [];
  for (const id of state.recent || []) {
    const entry = byId.get(id);
    if (entry) picked.push(entry);
    if (picked.length >= SHELF_LIMIT) return picked;
  }
  for (const entry of all) {
    if (picked.length >= SHELF_LIMIT) break;
    if (!picked.some((item) => entryKey(item) === entryKey(entry))) picked.push(entry);
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

export function hideSample(state: ShelfState, sampleId: SampleId): ShelfState {
  return { ...state, hidden: state.hidden.includes(sampleId) ? state.hidden : [...state.hidden, sampleId] };
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

export async function keepFolio(key: string, folio: Folio) {
  if (typeof indexedDB === "undefined") return;
  const stored = { ...folio, epubHref: folio.epubHref?.startsWith("blob:") ? undefined : folio.epubHref };
  const db = await folioDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FOLIO_STORE, "readwrite");
    tx.objectStore(FOLIO_STORE).put(JSON.stringify(stored), key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadFolio(key: string): Promise<Folio | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await folioDb();
  const raw = await new Promise<string | undefined>((resolve, reject) => {
    const request = db.transaction(FOLIO_STORE, "readonly").objectStore(FOLIO_STORE).get(key);
    request.onsuccess = () => resolve(request.result as string | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Folio;
  } catch {
    return null;
  }
}

export async function dropFolio(key: string) {
  if (typeof indexedDB === "undefined") return;
  const db = await folioDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FOLIO_STORE, "readwrite");
    tx.objectStore(FOLIO_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/** Take a title off this device: shelf entry, reading place, edits, original, and stored text. */
export async function forgetEntry(state: ShelfState, entry: ShelfEntry): Promise<ShelfState> {
  const key = entryKey(entry);
  dropBook(key);
  if (typeof localStorage !== "undefined") {
    for (const place of placeKeys(entry)) localStorage.removeItem(place);
  }
  await dropSource(key).catch(() => {});
  if (entry.kind === "opened") await dropFolio(entry.id).catch(() => {});
  if (entry.sampleId) return hideSample(state, entry.sampleId);
  return withoutOpened(state, entry.id);
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
