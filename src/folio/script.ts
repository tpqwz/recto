export type ReaderScript =
  | "en"
  | "latin"
  | "devanagari"
  | "arabic"
  | "cyrillic"
  | "greek"
  | "korean"
  | "thai"
  | "tamil"
  | "telugu";

const EXTRA: { id: ReaderScript; label: string; re: RegExp }[] = [
  { id: "devanagari", label: "Devanagari", re: /\p{Script=Devanagari}/gu },
  { id: "arabic", label: "Arabic", re: /\p{Script=Arabic}/gu },
  { id: "cyrillic", label: "Cyrillic", re: /\p{Script=Cyrillic}/gu },
  { id: "greek", label: "Greek", re: /\p{Script=Greek}/gu },
  { id: "korean", label: "Korean", re: /\p{Script=Hangul}/gu },
  { id: "thai", label: "Thai", re: /\p{Script=Thai}/gu },
  { id: "tamil", label: "Tamil", re: /\p{Script=Tamil}/gu },
  { id: "telugu", label: "Telugu", re: /\p{Script=Telugu}/gu },
];

export type ExtraScript = Exclude<ReaderScript, "en">;

export const SCRIPT_CHOICES: { id: ExtraScript; label: string; hint: string; bytes: number }[] = [
  { id: "latin", label: "Latin", hint: "French, German, Spanish, and other Latin letters with marks", bytes: 8069120 },
  { id: "devanagari", label: "Devanagari", hint: "Sanskrit, Hindi, Marathi, and Nepali", bytes: 7936000 },
  { id: "arabic", label: "Arabic", hint: "Arabic, Persian, and Urdu", bytes: 8028160 },
  { id: "cyrillic", label: "Cyrillic", hint: "Russian and the other Cyrillic languages", bytes: 8079360 },
  { id: "greek", label: "Greek", hint: "Greek", bytes: 7833600 },
  { id: "korean", label: "Korean", hint: "Korean", bytes: 13537280 },
  { id: "thai", label: "Thai", hint: "Thai", bytes: 7915520 },
  { id: "tamil", label: "Tamil", hint: "Tamil", bytes: 7905280 },
  { id: "telugu", label: "Telugu", hint: "Telugu", bytes: 7925760 },
];

export const PROBE_ORDER: ReaderScript[] = SCRIPT_CHOICES.map((choice) => choice.id);

export function scriptLabel(id: ReaderScript) {
  return SCRIPT_CHOICES.find((choice) => choice.id === id)?.label || "English";
}

function count(text: string, re: RegExp) {
  return text.match(re)?.length || 0;
}

/** The script a picture reader should use, when the file already contains those letters. */
export function scriptIn(text: string): ReaderScript {
  let best: ReaderScript = "en";
  let bestCount = 24;
  for (const script of EXTRA) {
    const found = count(text, script.re);
    if (found > bestCount) {
      best = script.id;
      bestCount = found;
    }
  }
  if (best !== "en") return best;
  const letters = count(text, /\p{L}/gu);
  const marks = count(text, /[\u00C0-\u024F]/g);
  if (letters > 80 && marks > letters * 0.04) return "latin";
  return "en";
}

export function scriptHits(text: string, id: ReaderScript) {
  if (id === "en" || id === "latin") return count(text, /\p{Script=Latin}/gu);
  const script = EXTRA.find((item) => item.id === id);
  return script ? count(text, script.re) : 0;
}

/** The language of one line, when there are enough letters to tell. */
export function lineScript(text: string): ReaderScript | "" {
  const letters = text.match(/\p{L}/gu) || [];
  if (letters.length < 6) return "";
  let best: ReaderScript | "" = "";
  let bestCount = 0;
  let nonLatin = 0;
  for (const ch of letters) if (!/\p{Script=Latin}/u.test(ch)) nonLatin += 1;
  for (const script of EXTRA) {
    const found = count(text, script.re);
    if (found > bestCount) {
      best = script.id;
      bestCount = found;
    }
  }
  const latin = letters.length - nonLatin;
  if (nonLatin >= 6 && nonLatin > latin) return best;
  if (latin >= 6) return "en";
  return "";
}

/** A run of another script, not a Latin word with a stray mark. */
export function otherScriptText(text: string) {
  const letters = text.match(/\p{L}/gu) || [];
  if (letters.length < 8) return false;
  let other = 0;
  for (const ch of letters) if (!/\p{Script=Latin}/u.test(ch)) other += 1;
  return other >= 8 && other > letters.length - other;
}

/**
 * Latin letters that are not a language. A Greek fount mapped onto Latin
 * mixes capitals inside ordinary words. Real English, real Latin, and a
 * page of capitals do not.
 */
export function looksMangled(text: string) {
  if (scriptIn(text) !== "en") return false;
  const tokens = text.split(/\s+/).filter((token) => /[A-Za-z]/.test(token));
  if (tokens.length < 40) return false;
  const internal = tokens.filter((token) => /[a-z][A-Z]|[A-Z]{2,}[a-z]/.test(token)).length;
  return internal >= 18 && internal / tokens.length >= 0.12;
}

/** No usable text, or a broken fount when a reader for another script is on. */
export function pageNeedsPicture(text: string, scripts: readonly ReaderScript[]) {
  if (needsPicture(text)) return true;
  return scripts.some((id) => id !== "en") && looksMangled(text);
}

/** An English reading that is not words. A picture of another script looks like this. */
export function looksScrappy(text: string) {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length < 8) return true;
  const words = text.match(/[A-Za-z]{3,}/g) || [];
  return words.length < tokens.length * 0.35;
}

/** The extracted text is not usable, and the page should be read as a picture. Real letters of another script are kept. */
export function needsPicture(text: string) {
  if (scriptIn(text) !== "en") return false;
  if (looksScrappy(text)) return true;
  const tokens = text.split(/\s+/).filter((token) => token.length > 1);
  if (tokens.length < 8) return false;
  const odd = tokens.filter((token) => !/^[\p{Script=Latin}\d][\p{Script=Latin}\d'’.,:;!?()-]*$/u.test(token));
  return odd.length >= 5 && odd.length / tokens.length >= 0.18;
}
