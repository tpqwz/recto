import { SCRIPT_CHOICES, type ReaderScript } from "./script.ts";

export type PictureReading = "off" | "empty";
export type OcrKind = "pp" | "vision";

export type DeskSettings = {
  pictures: PictureReading;
  kind: OcrKind;
  /** Keep the original file in this browser. Off keeps only the reading text. */
  keepFile: boolean;
  /** Picture readers that are on. English starts on. The others start off. */
  scripts: ReaderScript[];
  /** Rewrite a scan's letters. Off leaves the text layer as printed. */
  corrections: boolean;
  /** Ask before a doubtful page is kept or corrected. Off never asks. */
  review: boolean;
};

const EXTRA_IDS = SCRIPT_CHOICES.map((choice) => choice.id);
const SCRIPT_IDS = new Set<ReaderScript>(["en", ...EXTRA_IDS]);

export const DEFAULT_SETTINGS: DeskSettings = { pictures: "empty", kind: "pp", keepFile: false, scripts: ["en"], corrections: false, review: false };

function chosenScripts(value: unknown): ReaderScript[] {
  if (!Array.isArray(value)) return [];
  const picked: ReaderScript[] = [];
  for (const item of value) {
    if (typeof item === "string" && SCRIPT_IDS.has(item as ReaderScript) && !picked.includes(item as ReaderScript)) {
      picked.push(item as ReaderScript);
    }
  }
  return picked;
}

/** Older saves left English on without listing it. A save that turned every extra reader on was the old default, not a choice. */
function withEnglish(picked: ReaderScript[]): ReaderScript[] {
  const extras = picked.filter((id) => id !== "en");
  const every = extras.length === EXTRA_IDS.length && EXTRA_IDS.every((id) => extras.includes(id));
  return ["en", ...(every ? [] : extras)];
}

const KEY = "recto-desk:settings";

export function parseSettings(raw: string | null): DeskSettings {
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const value = JSON.parse(raw) as Partial<DeskSettings> & { readers?: number };
    const picked = chosenScripts(value.scripts);
    return {
      pictures: value.pictures === "off" ? "off" : "empty",
      kind: value.kind === "vision" ? "vision" : "pp",
      keepFile: value.keepFile === true,
      scripts: value.readers === 4 ? picked : withEnglish(picked),
      corrections: value.corrections === true,
      review: value.review === true,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function loadSettings(): DeskSettings {
  if (typeof localStorage === "undefined") return DEFAULT_SETTINGS;
  try {
    return parseSettings(localStorage.getItem(KEY));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: DeskSettings) {
  localStorage.setItem(KEY, JSON.stringify({ pictures: settings.pictures, kind: settings.kind, keepFile: settings.keepFile === true, scripts: settings.scripts, corrections: settings.corrections === true, review: settings.review === true, readers: 4 }));
}
