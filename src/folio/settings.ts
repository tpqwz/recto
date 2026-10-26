export type PictureReading = "off" | "empty";
export type OcrKind = "pp" | "vision";

export type DeskSettings = {
  pictures: PictureReading;
  kind: OcrKind;
};

export const DEFAULT_SETTINGS: DeskSettings = { pictures: "empty", kind: "pp" };

const KEY = "recto-desk:settings";

export function parseSettings(raw: string | null): DeskSettings {
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const value = JSON.parse(raw) as Partial<DeskSettings>;
    return {
      pictures: value.pictures === "off" ? "off" : "empty",
      kind: value.kind === "vision" ? "vision" : "pp",
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
  localStorage.setItem(KEY, JSON.stringify({ pictures: settings.pictures, kind: settings.kind }));
}
