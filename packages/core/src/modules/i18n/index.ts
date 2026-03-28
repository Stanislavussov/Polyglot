// Functional API (primary)
export { getSupportedLangs, isSupported, t } from "./i18n.js";
// Legacy class (kept for backward compatibility — prefer functional API)
export { I18nService } from "./i18n.service.js";
export type { LanguageEntry } from "./language-registry.js";
// Language registry — single source of truth, populated from DB at startup
export {
  getAllLanguageNames,
  getLangDisplay,
  getLangFlag,
  getLanguageName,
  getLanguageNativeName,
  getSupportedLanguages,
  initLanguageRegistry,
  isKnownLanguage,
  isRegistryInitialized,
  normalizeToIso1,
} from "./language-registry.js";
// Types
export type { I18nKey, I18nParams, Locale, LocaleMessages, SupportedLang } from "./types.js";
