/**
 * Strict union of all i18n keys — derived directly from `en.json`, the single
 * source of truth (Fable T29/A20). `typeof import(...)` is a type-only query
 * (erased at compile time, so it adds no runtime JSON import), and
 * `resolveJsonModule` gives it the literal key set. Adding a key to `en.json`
 * makes it a valid `t()` key automatically — no hand-maintained union to sync.
 */
export type I18nKey = keyof typeof import("./locales/en.json");

/**
 * Supported interface languages.
 * Matches the LANGUAGES array in apps/bot/src/constants.ts.
 */
export type SupportedLang = "en" | "ru" | "cs" | "de" | "fr" | "es" | "it" | "pt" | "uk" | "pl" | "kk";

/**
 * A flat dictionary of i18n keys → localized strings.
 * Used internally by locale JSON files.
 */
export type LocaleMessages = Record<I18nKey, string>;

/**
 * @deprecated Use `SupportedLang` instead. Kept for backward compatibility.
 */
export type Locale = SupportedLang;
