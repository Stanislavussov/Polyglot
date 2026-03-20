/**
 * Language code mappings — single source of truth.
 *
 * ISO 639-1 (2-letter) is the canonical format used throughout the codebase:
 * - Database columns (languages.code, user settings, translation cache, etc.)
 * - SupportedLang type
 * - Language detection module
 * - Translation requests and responses
 * - Idiom analysis
 *
 * ISO 639-3 (3-letter) codes are only used internally by `franc` for detection.
 * This module provides the single mapping between the two standards.
 */

/**
 * Mapping from ISO 639-1 (2-letter) to ISO 639-3 (3-letter) codes.
 * Used by franc (trigram-based language detection) and validation.
 */
export const ISO1_TO_ISO3: Record<string, string> = {
  en: "eng",
  cs: "ces",
  ru: "rus",
  uk: "ukr",
  de: "deu",
  fr: "fra",
  es: "spa",
  it: "ita",
  pt: "por",
  pl: "pol",
  nl: "nld",
  sv: "swe",
  da: "dan",
  no: "nob",
  fi: "fin",
  ja: "jpn",
  zh: "cmn",
  ko: "kor",
  ar: "arb",
  hi: "hin",
  tr: "tur",
  el: "ell",
  hu: "hun",
  ro: "ron",
  bg: "bul",
  hr: "hrv",
  sk: "slk",
  sl: "slv",
  sr: "srp",
  lt: "lit",
  lv: "lav",
  et: "est",
};

/**
 * Inverse mapping: ISO 639-3 → ISO 639-1.
 * Built automatically from ISO1_TO_ISO3.
 */
export const ISO3_TO_ISO1: Record<string, string> = {};
for (const [iso1, iso3] of Object.entries(ISO1_TO_ISO3)) {
  ISO3_TO_ISO1[iso3] = iso1;
}

/**
 * Resolves any language identifier to an ISO 639-3 code.
 *
 * Accepts:
 * - ISO 639-1 codes: "en" → "eng"
 * - ISO 639-3 codes (passthrough): "eng" → "eng"
 * - Common English names: "english" → "eng"
 *
 * @returns ISO 639-3 code or undefined if not recognized
 */
export function resolveToIso3(lang: string): string | undefined {
  const lower = lang.toLowerCase();

  // ISO 639-1 → ISO 639-3
  if (ISO1_TO_ISO3[lower]) return ISO1_TO_ISO3[lower];

  // ISO 639-3 passthrough
  if (ISO3_TO_ISO1[lower]) return lower;

  // Common English names → ISO 639-3
  return NAME_TO_ISO3[lower];
}

/**
 * Common language names (lowercase) → ISO 639-3 codes.
 * Covers names that may appear in external data sources.
 */
const NAME_TO_ISO3: Record<string, string> = {
  english: "eng",
  czech: "ces",
  russian: "rus",
  ukrainian: "ukr",
  german: "deu",
  french: "fra",
  spanish: "spa",
  italian: "ita",
  portuguese: "por",
  polish: "pol",
  dutch: "nld",
  swedish: "swe",
  danish: "dan",
  norwegian: "nob",
  finnish: "fin",
  japanese: "jpn",
  chinese: "cmn",
  korean: "kor",
  arabic: "arb",
  hindi: "hin",
  turkish: "tur",
  greek: "ell",
  hungarian: "hun",
  romanian: "ron",
  bulgarian: "bul",
  croatian: "hrv",
  slovak: "slk",
  slovenian: "slv",
  serbian: "srp",
  lithuanian: "lit",
  latvian: "lav",
  estonian: "est",
};
