// Functional API
export { getSupportedLangs, isSupported, t } from "./i18n.js";
export type { LanguageEntry } from "./language-registry.js";
// Language registry — single source of truth, populated from DB at startup
export {
  getAllLanguageEntries,
  getAllLanguageNames,
  getLangDisplay,
  getLangFlag,
  getLanguageEntry,
  getLanguageName,
  getLanguageNativeName,
  getSupportedLanguages,
  initLanguageRegistry,
  isKnownLanguage,
  isRegistryInitialized,
  isSupportedLanguage,
  normalizeToIso1,
} from "./language-registry.js";
// Types
export type { I18nKey, Locale, LocaleMessages, SupportedLang } from "./types.js";
