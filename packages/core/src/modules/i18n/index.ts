// Functional API (primary)
export { t, getSupportedLangs, isSupported } from "./i18n.js";

// Language registry — single source of truth, populated from DB at startup
export {
  initLanguageRegistry,
  isRegistryInitialized,
  getLanguageName,
  getLanguageNativeName,
  getAllLanguageNames,
  isKnownLanguage,
  getIso1ToIso3Map,
  getIso3ToIso1Map,
  resolveToIso3,
  normalizeToIso1,
  getLangFlag,
  getLangDisplay,
  getSupportedLanguages,
} from "./language-registry.js";
export type { LanguageEntry } from "./language-registry.js";

// Types
export type { I18nKey, SupportedLang, LocaleMessages, I18nParams, Locale } from "./types.js";

// Legacy class (kept for backward compatibility — prefer functional API)
export { I18nService } from "./i18n.service.js";
