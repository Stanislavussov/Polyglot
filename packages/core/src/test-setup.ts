/**
 * Test setup — initializes the language registry with test data.
 *
 * In production, this data comes from the DB `languages` table.
 * For tests, we provide the same seed data so tests work without a DB.
 */
import { initLanguageRegistry } from "./modules/i18n/language-registry.js";
import type { LanguageEntry } from "./modules/i18n/language-registry.js";

const TEST_LANGUAGES: LanguageEntry[] = [
  { code: "en", name: "English", nativeName: "English", flag: "🇬🇧", iso3Code: "eng", isSupported: true, localizedNames: { ru: "Английский", cs: "Angličtina" } },
  { code: "ru", name: "Russian", nativeName: "Русский", flag: "🇷🇺", iso3Code: "rus", isSupported: true, localizedNames: { ru: "Русский", cs: "Ruština" } },
  { code: "cs", name: "Czech", nativeName: "Čeština", flag: "🇨🇿", iso3Code: "ces", isSupported: true, localizedNames: { ru: "Чешский", cs: "Čeština" } },
  { code: "de", name: "German", nativeName: "Deutsch", flag: "🇩🇪", iso3Code: "deu", isSupported: true, localizedNames: { ru: "Немецкий", cs: "Němčina" } },
  { code: "fr", name: "French", nativeName: "Français", flag: "🇫🇷", iso3Code: "fra", isSupported: true, localizedNames: { ru: "Французский", cs: "Francouzština" } },
  { code: "es", name: "Spanish", nativeName: "Español", flag: "🇪🇸", iso3Code: "spa", isSupported: true, localizedNames: { ru: "Испанский", cs: "Španělština" } },
  { code: "it", name: "Italian", nativeName: "Italiano", flag: "🇮🇹", iso3Code: "ita", isSupported: true, localizedNames: { ru: "Итальянский", cs: "Italština" } },
  { code: "pt", name: "Portuguese", nativeName: "Português", flag: "🇵🇹", iso3Code: "por", isSupported: true, localizedNames: { ru: "Португальский", cs: "Portugalština" } },
  { code: "uk", name: "Ukrainian", nativeName: "Українська", flag: "🇺🇦", iso3Code: "ukr", isSupported: true, localizedNames: { ru: "Украинский", cs: "Ukrajinština" } },
  { code: "pl", name: "Polish", nativeName: "Polski", flag: "🇵🇱", iso3Code: "pol", isSupported: true, localizedNames: { ru: "Польский", cs: "Polština" } },
  { code: "ja", name: "Japanese", nativeName: "日本語", flag: "🇯🇵", iso3Code: "jpn", isSupported: false, localizedNames: { ru: "Японский", cs: "Japonština" } },
  { code: "zh", name: "Chinese", nativeName: "中文", flag: "🇨🇳", iso3Code: "cmn", isSupported: false, localizedNames: { ru: "Китайский", cs: "Čínština" } },
  { code: "ko", name: "Korean", nativeName: "한국어", flag: "🇰🇷", iso3Code: "kor", isSupported: false },
  { code: "ar", name: "Arabic", nativeName: "العربية", flag: "🇸🇦", iso3Code: "arb", isSupported: false },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी", flag: "🇮🇳", iso3Code: "hin", isSupported: false },
  { code: "tr", name: "Turkish", nativeName: "Türkçe", flag: "🇹🇷", iso3Code: "tur", isSupported: false },
  { code: "nl", name: "Dutch", nativeName: "Nederlands", flag: "🇳🇱", iso3Code: "nld", isSupported: false },
  { code: "sv", name: "Swedish", nativeName: "Svenska", flag: "🇸🇪", iso3Code: "swe", isSupported: false },
  { code: "da", name: "Danish", nativeName: "Dansk", flag: "🇩🇰", iso3Code: "dan", isSupported: false },
  { code: "no", name: "Norwegian", nativeName: "Norsk", flag: "🇳🇴", iso3Code: "nob", isSupported: false },
  { code: "fi", name: "Finnish", nativeName: "Suomi", flag: "🇫🇮", iso3Code: "fin", isSupported: false },
  { code: "el", name: "Greek", nativeName: "Ελληνικά", flag: "🇬🇷", iso3Code: "ell", isSupported: false },
  { code: "hu", name: "Hungarian", nativeName: "Magyar", flag: "🇭🇺", iso3Code: "hun", isSupported: false },
  { code: "ro", name: "Romanian", nativeName: "Română", flag: "🇷🇴", iso3Code: "ron", isSupported: false },
  { code: "bg", name: "Bulgarian", nativeName: "Български", flag: "🇧🇬", iso3Code: "bul", isSupported: false },
  { code: "hr", name: "Croatian", nativeName: "Hrvatski", flag: "🇭🇷", iso3Code: "hrv", isSupported: false },
  { code: "sk", name: "Slovak", nativeName: "Slovenčina", flag: "🇸🇰", iso3Code: "slk", isSupported: false },
  { code: "sl", name: "Slovenian", nativeName: "Slovenščina", flag: "🇸🇮", iso3Code: "slv", isSupported: false },
  { code: "sr", name: "Serbian", nativeName: "Српски", flag: "🇷🇸", iso3Code: "srp", isSupported: false },
  { code: "lt", name: "Lithuanian", nativeName: "Lietuvių", flag: "🇱🇹", iso3Code: "lit", isSupported: false },
  { code: "lv", name: "Latvian", nativeName: "Latviešu", flag: "🇱🇻", iso3Code: "lav", isSupported: false },
  { code: "et", name: "Estonian", nativeName: "Eesti", flag: "🇪🇪", iso3Code: "est", isSupported: false },
  { code: "la", name: "Latin", nativeName: "Latina", isSupported: false, localizedNames: { ru: "Латинский" } },
  { code: "af", name: "Afrikaans", nativeName: "Afrikaans", flag: "🇿🇦", isSupported: false },
  { code: "he", name: "Hebrew", nativeName: "עברית", flag: "🇮🇱", isSupported: false, localizedNames: { ru: "Иврит", cs: "Hebrejština" } },
];

// Initialize the registry before any tests run
initLanguageRegistry(TEST_LANGUAGES);
