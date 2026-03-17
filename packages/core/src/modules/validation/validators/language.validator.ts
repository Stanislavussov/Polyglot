import type { ValidationResult } from "../types.js";

/**
 * Mapping from ISO 639-1 (2-letter) codes and common language names
 * to ISO 639-3 (3-letter) codes.
 *
 * Retained for resolveToIso3() which is used by other modules.
 */
const LANG_TO_ISO3: Record<string, string> = {
  // ISO 639-1 → ISO 639-3
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
  // Common names (lowercase)
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
  // ISO 639-3 pass-through
  eng: "eng",
  ces: "ces",
  rus: "rus",
  deu: "deu",
  fra: "fra",
  spa: "spa",
  ita: "ita",
  por: "por",
  pol: "pol",
  nld: "nld",
  jpn: "jpn",
  cmn: "cmn",
  kor: "kor",
};

/**
 * Resolves a language identifier to an ISO 639-3 code.
 * Returns undefined if the language is not recognized.
 */
export function resolveToIso3(lang: string): string | undefined {
  return LANG_TO_ISO3[lang.toLowerCase()];
}

/**
 * Language validation — currently a no-op (always passes).
 *
 * Previously used franc-min for trigram-based detection, but it proved
 * unreliable for translation-length texts (15–40 chars), producing
 * frequent false positives (Czech↔German, Czech↔Spanish, etc.).
 *
 * Language correctness is ensured by:
 * - AI prompt specifying target languages
 * - Zod schema enforcing required language keys
 * - Semantic validation catching hallucinations
 *
 * This function is retained for API compatibility. It can be replaced
 * with a more accurate detection library in the future if needed.
 */
export function validateLanguage(
  _text: string,
  _expectedLang: string,
): ValidationResult {
  return { valid: true, errors: [] };
}
