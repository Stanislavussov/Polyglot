import { franc } from "franc-min";
import type { ValidationResult } from "../types.js";

/**
 * Mapping from ISO 639-1 (2-letter) codes and common language names
 * to ISO 639-3 (3-letter) codes used by franc.
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

/** Minimum text length for reliable franc detection */
const MIN_TEXT_LENGTH = 15;

/**
 * Resolves a language identifier to an ISO 639-3 code.
 * Returns undefined if the language is not recognized.
 */
export function resolveToIso3(lang: string): string | undefined {
  return LANG_TO_ISO3[lang.toLowerCase()];
}

/**
 * Validates that the given text is in the expected language using franc-min.
 *
 * Skips validation for short text (<15 chars) because franc accuracy is too low.
 *
 * Pure function (franc is deterministic for the same input).
 */
export function validateLanguage(
  text: string,
  expectedLang: string,
): ValidationResult {
  // Skip for short texts — franc is unreliable
  if (!text || text.trim().length < MIN_TEXT_LENGTH) {
    return { valid: true, errors: [] };
  }

  const expectedIso3 = resolveToIso3(expectedLang);

  // If we can't resolve the expected language, skip validation
  if (!expectedIso3) {
    return { valid: true, errors: [] };
  }

  const detected = franc(text.trim());

  // franc returns "und" (undetermined) when it can't detect
  if (detected === "und") {
    return { valid: true, errors: [] };
  }

  if (detected !== expectedIso3) {
    return {
      valid: false,
      errors: [
        {
          rule: "language",
          message: `Expected language "${expectedLang}" (${expectedIso3}) but detected "${detected}"`,
          field: "text",
        },
      ],
    };
  }

  return { valid: true, errors: [] };
}
