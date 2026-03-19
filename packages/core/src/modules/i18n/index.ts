// Functional API (primary)
export { t, getSupportedLangs, isSupported } from "./i18n.js";

// Language name registry (used by Wiktionary import, bot UI, etc.)
export {
  getLanguageName,
  getLanguageNativeName,
  getAllLanguageNames,
  isKnownLanguage,
} from "./language-names.js";

// Types
export type { I18nKey, SupportedLang, LocaleMessages, I18nParams, Locale } from "./types.js";

// Legacy class (kept for backward compatibility — prefer functional API)
export { I18nService } from "./i18n.service.js";
