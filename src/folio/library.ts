import type { SampleId, ShelfEntry, ShelfState } from "./shelf.ts";

/** The fifteen Dublin Core elements, in the order of the DCMI recommendation. */
export const DC_ELEMENTS = [
  "title",
  "creator",
  "subject",
  "description",
  "publisher",
  "contributor",
  "date",
  "type",
  "format",
  "identifier",
  "source",
  "language",
  "relation",
  "coverage",
  "rights",
] as const;

export type DcElement = (typeof DC_ELEMENTS)[number];

export const DC_LABEL: Record<DcElement, string> = {
  title: "Title",
  creator: "Creator",
  subject: "Subject",
  description: "Description",
  publisher: "Publisher",
  contributor: "Contributor",
  date: "Date",
  type: "Type",
  format: "Format",
  identifier: "Identifier",
  source: "Source",
  language: "Language",
  relation: "Relation",
  coverage: "Coverage",
  rights: "Rights",
};

/** Shown in the catalog table. The rest of the fifteen are edited on the record. */
export const TABLE_COLUMNS = ["title", "creator", "date", "language", "type", "subject", "coverage", "source"] as const satisfies readonly DcElement[];

export const SERIAL_IDS = ["isbn", "issn", "ismn", "doi", "asin", "oclc", "lccn"] as const;
export const ITEM_IDS = ["wikidata", "viaf", "isni", "gnd", "openlibrary"] as const;
export type SerialId = (typeof SERIAL_IDS)[number];
export type ItemId = (typeof ITEM_IDS)[number];
export type IdKey = SerialId | ItemId;

export const ID_LABEL: Record<IdKey, string> = {
  isbn: "ISBN",
  issn: "ISSN",
  ismn: "ISMN",
  doi: "DOI",
  asin: "ASIN",
  oclc: "OCLC",
  lccn: "LCCN",
  wikidata: "Wikidata",
  viaf: "VIAF",
  isni: "ISNI",
  gnd: "GND",
  openlibrary: "Open Library",
};

export type CatalogRecord = Record<DcElement, string> & {
  /** The text itself, shared by every translation and volume. */
  work: string;
  /** This translation or version, not the publication. */
  expression: string;
  /** This part of the edition, when the file is not the whole work. */
  volume: string;
  ids: Partial<Record<IdKey, string>>;
};

const VOLUME = /^(.*?)(?:\s*[,:–—-]\s*|\s+)((?:volume|vol\.?|tome)\s+([0-9]{1,3}|[ivxlcdm]{1,8}))\s*$/i;
const YEAR = /\b(1[5-9]\d{2}|20\d{2})\b/;

function blank(): CatalogRecord {
  const record = { work: "", expression: "", volume: "", ids: {} } as CatalogRecord;
  for (const key of DC_ELEMENTS) record[key] = "";
  return record;
}

function sample(over: Partial<CatalogRecord> & Pick<CatalogRecord, "title" | "creator" | "work">): CatalogRecord {
  return { ...blank(), type: "Text", format: "text", language: "English", rights: "Public domain.", ...over };
}

const SAMPLES: Record<SampleId, CatalogRecord> = {
  dhammapada: sample({
    title: "The Dhammapada",
    creator: "The Buddha",
    contributor: "F. Max Müller",
    date: "1881",
    type: "Verse",
    subject: "Religion",
    coverage: "Ancient",
    source: "Sacred Books of the East. Translated by F. Max Müller, 1881",
    relation: "Expression of The Dhammapada",
    work: "The Dhammapada",
    expression: "F. Max Müller, English, 1881",
  }),
  varieties: sample({
    title: "The Varieties of Religious Experience",
    creator: "William James",
    date: "1902",
    type: "Prose",
    subject: "Religion",
    coverage: "Modern",
    source: "The Gifford Lectures, 1901–1902",
    work: "The Varieties of Religious Experience",
    expression: "William James, English, 1902",
  }),
  republic: sample({
    title: "The Republic",
    creator: "Plato",
    contributor: "Benjamin Jowett",
    type: "Prose",
    subject: "Philosophy",
    coverage: "Classical",
    source: "Translated by Benjamin Jowett",
    relation: "Expression of The Republic",
    work: "The Republic",
    expression: "Benjamin Jowett, English",
  }),
  cannon: sample({
    title: "Bodily Changes in Pain, Hunger, Fear and Rage",
    creator: "Walter B. Cannon",
    date: "1915",
    type: "Prose",
    subject: "Psychology",
    coverage: "Modern",
    source: "D. Appleton and Company, 1915",
    work: "Bodily Changes in Pain, Hunger, Fear and Rage",
    expression: "Walter B. Cannon, English, 1915",
  }),
  ascent: sample({
    title: "The Ascent of Mount Carmel",
    creator: "St. John of the Cross",
    contributor: "David Lewis",
    date: "1906",
    type: "Prose",
    subject: "Religion",
    coverage: "Early modern",
    source: "Translated by David Lewis, 1906",
    relation: "Expression of Subida del Monte Carmelo",
    work: "Subida del Monte Carmelo",
    expression: "David Lewis, English, 1906",
  }),
};

export function catalogFromOpened(input: { title: string; author?: string; subtitle?: string; filename?: string; format?: string }): CatalogRecord {
  const raw = input.title.trim() || "Untitled";
  const vol = VOLUME.exec(raw);
  const work = (vol?.[1] || raw).replace(/[,:–—-]\s*$/, "").trim();
  const volume = vol ? vol[2].replace(/^vol\.?\s+/i, "Volume ").replace(/^tome\s+/i, "Tome ") : "";
  const subtitle = input.subtitle || "";
  const year = YEAR.exec(`${subtitle} ${raw}`)?.[1] || "";
  const translator =
    /translated by\s+([^,.(]+)/i.exec(subtitle)?.[1]?.trim() || /\btrans\.?\s+([^,.(]+)/i.exec(subtitle)?.[1]?.trim() || "";
  const file = (input.filename || "").replace(/\.[^.]+$/, "");
  const record = blank();
  record.title = raw;
  record.creator = input.author?.trim() || "";
  record.contributor = translator;
  record.date = year;
  record.type = "Text";
  record.format = input.format || "text";
  record.source = translator ? [translator, year].filter(Boolean).join(", ") : year || file;
  record.language = "";
  record.relation = work && work !== raw ? `Volume of ${work}` : "";
  record.work = work;
  record.expression = [translator, year].filter(Boolean).join(", ");
  record.volume = volume;
  return record;
}

export function recordFor(state: ShelfState, entry: ShelfEntry): CatalogRecord {
  const saved = state.records?.[entry.id];
  if (saved) return saved;
  if (entry.sampleId && SAMPLES[entry.sampleId]) return SAMPLES[entry.sampleId];
  return catalogFromOpened({ title: entry.title, author: entry.author, filename: entry.originName, format: "text" });
}

export function storeRecord(state: ShelfState, entry: ShelfEntry, record: CatalogRecord): ShelfState {
  const cleaned = { ...record, title: record.title.trim() || entry.title, ids: { ...record.ids } };
  const records = { ...(state.records || {}), [entry.id]: cleaned };
  const opened = state.opened.map((item) =>
    item.id === entry.id
      ? {
          ...item,
          title: cleaned.title,
          author: cleaned.creator,
          work: cleaned.work,
          edition: cleaned.source,
          translator: cleaned.contributor,
          year: cleaned.date,
          language: cleaned.language,
          volume: cleaned.volume,
        }
      : item,
  );
  return { ...state, records, opened };
}

export function entryTitle(state: ShelfState, entry: ShelfEntry) {
  return recordFor(state, entry).title || entry.title;
}

export function sortRecords(rows: { entry: ShelfEntry; record: CatalogRecord }[], key: DcElement, dir: "asc" | "desc") {
  const factor = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => factor * a.record[key].localeCompare(b.record[key], undefined, { numeric: true, sensitivity: "base" }));
}
