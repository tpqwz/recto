export type StorageLine = { label: string; bytes: number | null; detail?: string };

export type StorageReport = {
  usage: number | null;
  quota: number | null;
  persisted: boolean | null;
  lines: StorageLine[];
};

export function until<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Saving took too long.")), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function explainSaveFailure(message: string, report: StorageReport | null, placed: boolean): string {
  const room =
    report?.usage != null && report.quota != null ? `${formatBytes(report.usage)} of ${formatBytes(report.quota)}` : "";
  const tight = report?.usage != null && report.quota != null && report.quota > 0 && report.usage > report.quota * 0.85;
  const lead = placed ? "The title is on the shelf. " : "";
  if (/quota/i.test(message) && room && !tight) {
    return `${lead}The browser refused one save. Storage is not full: ${room} is in use. The reading text was too large for a single write. (${message})`;
  }
  if (/quota/i.test(message)) {
    return room
      ? `${lead}The reading text could not be kept. This site is using ${room}. (${message})`
      : `${lead}The reading text could not be kept on this device. (${message})`;
  }
  return `${lead}${message || "The book opened, but it could not be kept on the shelf."}`;
}

const SHIPPED_READERS = [
  ["det.tar", 4843520],
  ["rec.tar", 16701440],
] as const;

const OTHER_READERS = [
  ["latin.tar", 8069120],
  ["devanagari.tar", 7936000],
  ["arabic.tar", 8028160],
  ["cyrillic.tar", 8079360],
  ["el.tar", 7833600],
  ["korean.tar", 13537280],
  ["th.tar", 7915520],
  ["ta.tar", 7905280],
  ["te.tar", 7925760],
] as const;

/** The English picture reader that ships with the desk. */
export const PICTURE_READER_BYTES = SHIPPED_READERS.reduce((sum, [, bytes]) => sum + bytes, 0);
/** Other scripts. Stored only after they are turned on in Settings. */
export const OTHER_READER_BYTES = OTHER_READERS.reduce((sum, [, bytes]) => sum + bytes, 0);

function cap<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

function localBytes(): number {
  if (typeof localStorage === "undefined") return 0;
  let chars = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i) || "";
    chars += key.length + (localStorage.getItem(key)?.length || 0);
  }
  return chars * 2;
}

function valueBytes(value: unknown): number {
  if (value == null) return 0;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (typeof value === "string") return value.length * 2;
  if (typeof value === "object" && value && "bytes" in value) {
    const bytes = (value as { bytes?: unknown }).bytes;
    if (bytes instanceof ArrayBuffer) return bytes.byteLength;
    if (ArrayBuffer.isView(bytes)) return bytes.byteLength;
  }
  try {
    return JSON.stringify(value).length * 2;
  } catch {
    return 0;
  }
}

async function databaseStats(name: string, store: string): Promise<{ bytes: number; count: number } | null> {
  if (typeof indexedDB === "undefined") return { bytes: 0, count: 0 };
  const known = typeof indexedDB.databases === "function" ? await indexedDB.databases().catch(() => null) : null;
  if (known && !known.some((db) => db.name === name)) return { bytes: 0, count: 0 };
  const db = await new Promise<IDBDatabase | null>((resolve) => {
    let settled = false;
    const request = indexedDB.open(name);
    const giveUp = setTimeout(() => {
      settled = true;
      resolve(null);
    }, 2500);
    request.onupgradeneeded = () => {
      settled = true;
      clearTimeout(giveUp);
      request.transaction?.abort();
      resolve(null);
    };
    request.onsuccess = () => {
      clearTimeout(giveUp);
      if (settled) {
        request.result.close();
        return;
      }
      resolve(request.result);
    };
    request.onerror = () => {
      clearTimeout(giveUp);
      resolve(null);
    };
  });
  if (!db) return null;
  if (!db.objectStoreNames.contains(store)) {
    db.close();
    return { bytes: 0, count: 0 };
  }
  const stats = await new Promise<{ bytes: number; count: number } | null>((resolve) => {
    let bytes = 0;
    let count = 0;
    const tx = db.transaction(store, "readonly");
    const cursor = tx.objectStore(store).openCursor();
    const giveUp = setTimeout(() => resolve(null), 2500);
    cursor.onsuccess = () => {
      const row = cursor.result;
      if (!row) return;
      bytes += valueBytes(row.value);
      if (!String(row.key).includes("\u0000")) count++;
      row.continue();
    };
    tx.oncomplete = () => {
      clearTimeout(giveUp);
      resolve({ bytes, count });
    };
    tx.onerror = () => {
      clearTimeout(giveUp);
      resolve({ bytes, count });
    };
    tx.onabort = () => {
      clearTimeout(giveUp);
      resolve(null);
    };
  });
  db.close();
  return stats;
}

async function responseSize(hit: Response): Promise<number> {
  const stated = Number(hit.headers.get("content-length"));
  if (Number.isFinite(stated) && stated > 0) return stated;
  return (await hit.blob()).size;
}

async function cacheStats(): Promise<{ reading: number; books: number; english: number; scripts: number; other: number } | null> {
  if (typeof caches === "undefined") return { reading: 0, books: 0, english: 0, scripts: 0, other: 0 };
  const keys = await caches.keys();
  const totals = { reading: 0, books: 0, english: 0, scripts: 0, other: 0 };
  for (const key of keys) {
    const cache = await caches.open(key);
    for (const req of await cache.keys()) {
      const hit = await cache.match(req);
      if (!hit) continue;
      const size = await responseSize(hit);
      const path = new URL(req.url).pathname;
      if (key === "recto-reading" || path.includes("/__recto/reading/")) {
        totals.reading += size;
        totals.books++;
      } else if (path.includes("/vendor/ppocr/") && (path.endsWith("/det.tar") || path.endsWith("/rec.tar"))) totals.english += size;
      else if (path.includes("/vendor/ppocr/")) totals.scripts += size;
      else totals.other += size;
    }
  }
  return totals;
}

/** What this site is allowed to store, and where that space has gone. */
export async function storageReport(): Promise<StorageReport> {
  const estimate =
    typeof navigator !== "undefined" && navigator.storage?.estimate
      ? await cap(navigator.storage.estimate(), 2000, null)
      : null;
  const persisted =
    typeof navigator !== "undefined" && navigator.storage?.persisted
      ? await cap(navigator.storage.persisted(), 1500, null)
      : null;
  const [folios, sources, cached, shelf] = await Promise.all([
    cap(databaseStats("recto-folios", "books"), 4000, null),
    cap(databaseStats("recto-sources", "files"), 4000, null),
    cap(cacheStats(), 4000, null),
    Promise.resolve(localBytes()),
  ]);
  const readingBytes =
    folios || cached ? (folios?.bytes || 0) + (cached?.reading || 0) : null;
  const books = Math.max(folios?.count || 0, cached?.books || 0);
  const lines: StorageLine[] = [
    {
      label: "Reading text",
      bytes: readingBytes,
      detail: books ? `${books} ${books === 1 ? "book" : "books"}` : undefined,
    },
    {
      label: "Original files",
      bytes: sources ? sources.bytes : null,
      detail: sources?.count ? `${sources.count} ${sources.count === 1 ? "file" : "files"}` : undefined,
    },
    { label: "Shelf, places, and settings", bytes: shelf },
    { label: "English picture reader included", bytes: PICTURE_READER_BYTES, detail: "2 files" },
    { label: "English picture reader kept here", bytes: cached ? cached.english : null },
    {
      label: "Other script readers",
      bytes: cached ? cached.scripts : null,
      detail: cached && cached.scripts > 0 ? "Stored" : "Off until turned on",
    },
    { label: "Other files kept for offline use", bytes: cached ? cached.other : null },
  ];
  return {
    usage: typeof estimate?.usage === "number" ? estimate.usage : null,
    quota: typeof estimate?.quota === "number" ? estimate.quota : null,
    persisted,
    lines,
  };
}
