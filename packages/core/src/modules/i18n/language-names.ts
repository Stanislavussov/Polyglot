/**
 * Language name registry — maps ISO 639-1/2 codes to human-readable names.
 *
 * Used by:
 * - The `languages` table in the database (name column)
 * - Bot UI to display language names to users
 * - Wiktionary import script for language resolution
 *
 * Covers all SupportedLang codes plus additional Wiktionary source languages.
 */

import type { SupportedLang } from "./types.js";

/* ------------------------------------------------------------------ */
/*  Language name maps                                                  */
/* ------------------------------------------------------------------ */

/**
 * English names for language codes.
 * Source of truth for language display names.
 */
const ENGLISH_NAMES: Record<string, string> = {
  // SupportedLang codes (interface languages)
  en: "English",
  ru: "Russian",
  cs: "Czech",
  de: "German",
  fr: "French",
  es: "Spanish",
  it: "Italian",
  pt: "Portuguese",
  uk: "Ukrainian",
  pl: "Polish",
  // Additional Wiktionary source languages
  ja: "Japanese",
  zh: "Chinese",
  ko: "Korean",
  ar: "Arabic",
  hi: "Hindi",
  tr: "Turkish",
  nl: "Dutch",
  sv: "Swedish",
  da: "Danish",
  no: "Norwegian",
  fi: "Finnish",
  el: "Greek",
  he: "Hebrew",
  th: "Thai",
  vi: "Vietnamese",
  ro: "Romanian",
  hu: "Hungarian",
  bg: "Bulgarian",
  hr: "Croatian",
  sr: "Serbian",
  sk: "Slovak",
  sl: "Slovenian",
  lt: "Lithuanian",
  lv: "Latvian",
  et: "Estonian",
  ka: "Georgian",
  hy: "Armenian",
  id: "Indonesian",
  ms: "Malay",
  fa: "Persian",
  ur: "Urdu",
  bn: "Bengali",
  ta: "Tamil",
  te: "Telugu",
  mr: "Marathi",
  gu: "Gujarati",
  kn: "Kannada",
  ml: "Malayalam",
  pa: "Punjabi",
  sw: "Swahili",
  af: "Afrikaans",
  ca: "Catalan",
  eu: "Basque",
  gl: "Galician",
  is: "Icelandic",
  ga: "Irish",
  cy: "Welsh",
  sq: "Albanian",
  mk: "Macedonian",
  bs: "Bosnian",
  mt: "Maltese",
  lb: "Luxembourgish",
  be: "Belarusian",
  la: "Latin",
};

/**
 * Native (autonym) names for language codes.
 */
const NATIVE_NAMES: Record<string, string> = {
  en: "English",
  ru: "Русский",
  cs: "Čeština",
  de: "Deutsch",
  fr: "Français",
  es: "Español",
  it: "Italiano",
  pt: "Português",
  uk: "Українська",
  pl: "Polski",
  ja: "日本語",
  zh: "中文",
  ko: "한국어",
  ar: "العربية",
  hi: "हिन्दी",
  tr: "Türkçe",
  nl: "Nederlands",
  sv: "Svenska",
  da: "Dansk",
  no: "Norsk",
  fi: "Suomi",
  el: "Ελληνικά",
  he: "עברית",
  th: "ไทย",
  vi: "Tiếng Việt",
  ro: "Română",
  hu: "Magyar",
  bg: "Български",
  hr: "Hrvatski",
  sr: "Српски",
  sk: "Slovenčina",
  sl: "Slovenščina",
  lt: "Lietuvių",
  lv: "Latviešu",
  et: "Eesti",
  ka: "ქართული",
  hy: "Հայերեն",
  id: "Bahasa Indonesia",
  ms: "Bahasa Melayu",
  fa: "فارسی",
  ur: "اردو",
  bn: "বাংলা",
  ta: "தமிழ்",
  te: "తెలుగు",
  mr: "मराठी",
  gu: "ગુજરાતી",
  kn: "ಕನ್ನಡ",
  ml: "മലയാളം",
  pa: "ਪੰਜਾਬੀ",
  sw: "Kiswahili",
  af: "Afrikaans",
  ca: "Català",
  eu: "Euskara",
  gl: "Galego",
  is: "Íslenska",
  ga: "Gaeilge",
  cy: "Cymraeg",
  sq: "Shqip",
  mk: "Македонски",
  bs: "Bosanski",
  mt: "Malti",
  lb: "Lëtzebuergesch",
  be: "Беларуская",
  la: "Latina",
};

/**
 * Localized language names for supported interface languages.
 * Key: displayLang, Value: map of code → localized name.
 */
const LOCALIZED_NAMES: Partial<Record<SupportedLang, Record<string, string>>> =
  {
    ru: {
      en: "Английский",
      ru: "Русский",
      cs: "Чешский",
      de: "Немецкий",
      fr: "Французский",
      es: "Испанский",
      it: "Итальянский",
      pt: "Португальский",
      uk: "Украинский",
      pl: "Польский",
      ja: "Японский",
      zh: "Китайский",
      ko: "Корейский",
      ar: "Арабский",
      hi: "Хинди",
      tr: "Турецкий",
      nl: "Нидерландский",
      sv: "Шведский",
      da: "Датский",
      no: "Норвежский",
      fi: "Финский",
      el: "Греческий",
      he: "Иврит",
      la: "Латинский",
    },
    cs: {
      en: "Angličtina",
      ru: "Ruština",
      cs: "Čeština",
      de: "Němčina",
      fr: "Francouzština",
      es: "Španělština",
      it: "Italština",
      pt: "Portugalština",
      uk: "Ukrajinština",
      pl: "Polština",
      ja: "Japonština",
      zh: "Čínština",
      ko: "Korejština",
      ar: "Arabština",
      hi: "Hindština",
      tr: "Turečtina",
      nl: "Nizozemština",
      sv: "Švédština",
      da: "Dánština",
      no: "Norština",
      fi: "Finština",
      el: "Řečtina",
      he: "Hebrejština",
      la: "Latina",
    },
  };

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Get the human-readable name of a language by its ISO code.
 *
 * @param code      ISO 639-1 language code (e.g., "ru", "en", "de")
 * @param displayLang Optional: display the name in this language (defaults to "en")
 * @returns The localized language name, or the English name, or the code itself as fallback
 *
 * @example
 * getLanguageName("ru")        // "Russian"
 * getLanguageName("ru", "ru")  // "Русский"  (localized)
 * getLanguageName("ru", "cs")  // "Ruština"  (localized)
 * getLanguageName("xx")        // "xx"       (unknown code → returns code)
 */
export function getLanguageName(
  code: string,
  displayLang?: SupportedLang,
): string {
  // If display language requested and we have localized names, use them
  if (displayLang && displayLang !== "en") {
    const localized = LOCALIZED_NAMES[displayLang]?.[code];
    if (localized) return localized;
  }

  // Fall back to English name, then to the code itself
  return ENGLISH_NAMES[code] ?? code;
}

/**
 * Get the native (autonym) name of a language.
 *
 * @param code ISO 639-1 language code
 * @returns Native name (e.g., "Русский" for "ru"), or English name, or code as fallback
 *
 * @example
 * getLanguageNativeName("ru")  // "Русский"
 * getLanguageNativeName("de")  // "Deutsch"
 * getLanguageNativeName("xx")  // "xx"
 */
export function getLanguageNativeName(code: string): string {
  return NATIVE_NAMES[code] ?? ENGLISH_NAMES[code] ?? code;
}

/**
 * Get all known language entries as { code, name } pairs.
 * Useful for populating the `languages` database table.
 *
 * @returns Array of { code, name } objects (English names)
 *
 * @example
 * getAllLanguageNames()
 * // [{ code: "en", name: "English" }, { code: "ru", name: "Russian" }, ...]
 */
export function getAllLanguageNames(): Array<{ code: string; name: string }> {
  return Object.entries(ENGLISH_NAMES).map(([code, name]) => ({ code, name }));
}

/**
 * Check if a language code has a known name in our registry.
 *
 * @param code ISO 639-1 language code
 * @returns true if the code is recognized
 */
export function isKnownLanguage(code: string): boolean {
  return code in ENGLISH_NAMES;
}
