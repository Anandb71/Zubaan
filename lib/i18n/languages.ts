/**
 * Language normalization.
 *
 * Three sources disagree constantly: STT reports a detected code, TTS/Translate
 * need BCP-47 ("ta-IN"), and humans/seed data say "Tamil" or "ta". This module
 * is the one place that reconciles them, so a detected language always maps to
 * a language we can speak the audit back in.
 *
 * It also handles the case the pitch depends on: Bhojpuri is spoken by the
 * customer but has no Sarvam voice, so it resolves to Hindi for speak-back
 * while the DETECTED language is still reported honestly as Bhojpuri.
 */

export interface Language {
  code: string; // BCP-47, e.g. "hi-IN"
  short: string; // "hi"
  english: string; // "Hindi"
  native: string; // "हिन्दी"
}

export const LANGUAGES: readonly Language[] = [
  { code: "en-IN", short: "en", english: "English", native: "English" },
  { code: "hi-IN", short: "hi", english: "Hindi", native: "हिन्दी" },
  { code: "bn-IN", short: "bn", english: "Bengali", native: "বাংলা" },
  { code: "ta-IN", short: "ta", english: "Tamil", native: "தமிழ்" },
  { code: "te-IN", short: "te", english: "Telugu", native: "తెలుగు" },
  { code: "kn-IN", short: "kn", english: "Kannada", native: "ಕನ್ನಡ" },
  { code: "ml-IN", short: "ml", english: "Malayalam", native: "മലയാളം" },
  { code: "mr-IN", short: "mr", english: "Marathi", native: "मराठी" },
  { code: "gu-IN", short: "gu", english: "Gujarati", native: "ગુજરાતી" },
  { code: "pa-IN", short: "pa", english: "Punjabi", native: "ਪੰਜਾਬੀ" },
  { code: "od-IN", short: "od", english: "Odia", native: "ଓଡ଼ିଆ" },
] as const;

export const DEFAULT_LANGUAGE: Language = LANGUAGES[0]!; // en-IN
const HINDI: Language = LANGUAGES[1]!;

const INDEX = new Map<string, Language>();
for (const l of LANGUAGES) {
  INDEX.set(l.code.toLowerCase(), l);
  INDEX.set(l.short.toLowerCase(), l);
  INDEX.set(l.english.toLowerCase(), l);
  INDEX.set(l.native.toLowerCase(), l);
}
// Aliases and near-languages without their own voice.
INDEX.set("or-in", INDEX.get("od")!);
INDEX.set("or", INDEX.get("od")!);
INDEX.set("oriya", INDEX.get("od")!);
INDEX.set("bhojpuri", HINDI);
INDEX.set("bho", HINDI);
INDEX.set("maithili", HINDI);
INDEX.set("magahi", HINDI);
INDEX.set("awadhi", HINDI);
INDEX.set("haryanvi", HINDI);
INDEX.set("rajasthani", HINDI);
INDEX.set("marwari", HINDI);
INDEX.set("konkani", INDEX.get("mr")!);
INDEX.set("tulu", INDEX.get("kn")!);
INDEX.set("hinglish", HINDI);
INDEX.set("unknown", DEFAULT_LANGUAGE);

/** Resolve any code/name to a supported Language; falls back to English. */
export function resolveLanguage(input: string | null | undefined): Language {
  if (!input) return DEFAULT_LANGUAGE;
  const key = input.trim().toLowerCase();
  if (!key) return DEFAULT_LANGUAGE;
  const direct = INDEX.get(key);
  if (direct) return direct;
  // "hi-IN-x-something" or "hi_IN" -> try the primary subtag.
  const primary = key.split(/[-_]/)[0];
  return (primary ? INDEX.get(primary) : undefined) ?? DEFAULT_LANGUAGE;
}

/** BCP-47 code for TTS/Translate, from any input. */
export function toBcp47(input: string | null | undefined): string {
  return resolveLanguage(input).code;
}

/** Human label for the detected-language badge. */
export function languageLabel(input: string | null | undefined): string {
  const l = resolveLanguage(input);
  return l.english === l.native ? l.english : `${l.english} · ${l.native}`;
}

/** True when we have no distinct voice and must speak back in another language. */
export function isSpeakBackSubstituted(input: string | null | undefined): boolean {
  if (!input) return false;
  const key = input.trim().toLowerCase();
  const resolved = resolveLanguage(key);
  return (
    INDEX.has(key) &&
    resolved.short !== key &&
    resolved.code.toLowerCase() !== key &&
    resolved.english.toLowerCase() !== key &&
    resolved.native.toLowerCase() !== key
  );
}
