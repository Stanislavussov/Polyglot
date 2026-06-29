/**
 * Test setup — initializes the language registry with test data.
 *
 * In production, this data comes from the DB `languages` table.
 * For tests, we provide the same seed data so tests work without a DB.
 *
 * The registry works exclusively with ISO 639-1 codes.
 * ISO 639-3 codes are a private implementation detail of detect-language.ts.
 */

import type { LanguageEntry } from "./modules/i18n/language-registry.js";
import { initLanguageRegistry } from "./modules/i18n/language-registry.js";

const TEST_LANGUAGES: LanguageEntry[] = [
  {
    code: "en",
    name: "English",
    nativeName: "English",
    flag: "🇬🇧",
    isSupported: true,
    localizedNames: { ru: "Английский", cs: "Angličtina" },
  },
  {
    code: "ru",
    name: "Russian",
    nativeName: "Русский",
    flag: "🇷🇺",
    isSupported: true,
    localizedNames: { ru: "Русский", cs: "Ruština" },
  },
  {
    code: "cs",
    name: "Czech",
    nativeName: "Čeština",
    flag: "🇨🇿",
    isSupported: true,
    localizedNames: { ru: "Чешский", cs: "Čeština" },
  },
  {
    code: "de",
    name: "German",
    nativeName: "Deutsch",
    flag: "🇩🇪",
    isSupported: true,
    localizedNames: { ru: "Немецкий", cs: "Němčina" },
  },
  {
    code: "fr",
    name: "French",
    nativeName: "Français",
    flag: "🇫🇷",
    isSupported: true,
    localizedNames: { ru: "Французский", cs: "Francouzština" },
  },
  {
    code: "es",
    name: "Spanish",
    nativeName: "Español",
    flag: "🇪🇸",
    isSupported: true,
    localizedNames: { ru: "Испанский", cs: "Španělština" },
  },
  {
    code: "it",
    name: "Italian",
    nativeName: "Italiano",
    flag: "🇮🇹",
    isSupported: true,
    localizedNames: { ru: "Итальянский", cs: "Italština" },
  },
  {
    code: "pt",
    name: "Portuguese",
    nativeName: "Português",
    flag: "🇵🇹",
    isSupported: true,
    localizedNames: { ru: "Португальский", cs: "Portugalština" },
  },
  {
    code: "uk",
    name: "Ukrainian",
    nativeName: "Українська",
    flag: "🇺🇦",
    isSupported: true,
    localizedNames: { ru: "Украинский", cs: "Ukrajinština" },
  },
  {
    code: "pl",
    name: "Polish",
    nativeName: "Polski",
    flag: "🇵🇱",
    isSupported: true,
    localizedNames: { ru: "Польский", cs: "Polština" },
  },
  {
    code: "kk",
    name: "Kazakh",
    nativeName: "Қазақша",
    flag: "🇰🇿",
    isSupported: true,
    localizedNames: { ru: "Казахский", cs: "Kazaština" },
  },
  {
    code: "ja",
    name: "Japanese",
    nativeName: "日本語",
    flag: "🇯🇵",
    isSupported: false,
    localizedNames: { ru: "Японский", cs: "Japonština" },
  },
  {
    code: "zh",
    name: "Chinese",
    nativeName: "中文",
    flag: "🇨🇳",
    isSupported: false,
    localizedNames: { ru: "Китайский", cs: "Čínština" },
  },
  { code: "ko", name: "Korean", nativeName: "한국어", flag: "🇰🇷", isSupported: false },
  { code: "ar", name: "Arabic", nativeName: "العربية", flag: "🇸🇦", isSupported: false },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी", flag: "🇮🇳", isSupported: false },
  { code: "tr", name: "Turkish", nativeName: "Türkçe", flag: "🇹🇷", isSupported: false },
  { code: "nl", name: "Dutch", nativeName: "Nederlands", flag: "🇳🇱", isSupported: false },
  { code: "sv", name: "Swedish", nativeName: "Svenska", flag: "🇸🇪", isSupported: false },
  { code: "da", name: "Danish", nativeName: "Dansk", flag: "🇩🇰", isSupported: false },
  { code: "no", name: "Norwegian", nativeName: "Norsk", flag: "🇳🇴", isSupported: false },
  { code: "fi", name: "Finnish", nativeName: "Suomi", flag: "🇫🇮", isSupported: false },
  { code: "el", name: "Greek", nativeName: "Ελληνικά", flag: "🇬🇷", isSupported: false },
  { code: "hu", name: "Hungarian", nativeName: "Magyar", flag: "🇭🇺", isSupported: false },
  { code: "ro", name: "Romanian", nativeName: "Română", flag: "🇷🇴", isSupported: false },
  { code: "bg", name: "Bulgarian", nativeName: "Български", flag: "🇧🇬", isSupported: false },
  { code: "hr", name: "Croatian", nativeName: "Hrvatski", flag: "🇭🇷", isSupported: false },
  { code: "sk", name: "Slovak", nativeName: "Slovenčina", flag: "🇸🇰", isSupported: false },
  { code: "sl", name: "Slovenian", nativeName: "Slovenščina", flag: "🇸🇮", isSupported: false },
  { code: "sr", name: "Serbian", nativeName: "Српски", flag: "🇷🇸", isSupported: false },
  { code: "lt", name: "Lithuanian", nativeName: "Lietuvių", flag: "🇱🇹", isSupported: false },
  { code: "lv", name: "Latvian", nativeName: "Latviešu", flag: "🇱🇻", isSupported: false },
  { code: "et", name: "Estonian", nativeName: "Eesti", flag: "🇪🇪", isSupported: false },
  { code: "la", name: "Latin", nativeName: "Latina", isSupported: false, localizedNames: { ru: "Латинский" } },
  { code: "af", name: "Afrikaans", nativeName: "Afrikaans", flag: "🇿🇦", isSupported: false },
  {
    code: "he",
    name: "Hebrew",
    nativeName: "עברית",
    flag: "🇮🇱",
    isSupported: false,
    localizedNames: { ru: "Иврит", cs: "Hebrejština" },
  },
];

// Initialize the registry before any tests run
initLanguageRegistry(TEST_LANGUAGES);
