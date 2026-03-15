/**
 * Bot-specific display constants.
 *
 * All translatable text strings are in the i18n module (packages/core).
 * This file only contains display data for keyboards and language selection.
 */

/** Supported languages with labels and flag emojis */
export const LANGUAGES = [
  { code: "ru", label: "Русский", flag: "🇷🇺" },
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "cs", label: "Čeština", flag: "🇨🇿" },
  { code: "de", label: "Deutsch", flag: "🇩🇪" },
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "es", label: "Español", flag: "🇪🇸" },
  { code: "it", label: "Italiano", flag: "🇮🇹" },
  { code: "pt", label: "Português", flag: "🇵🇹" },
  { code: "uk", label: "Українська", flag: "🇺🇦" },
  { code: "pl", label: "Polski", flag: "🇵🇱" },
] as const;

export type LangCode = (typeof LANGUAGES)[number]["code"];

/** Max number of target languages a user can learn */
export const MAX_LEARNING_LANGS = 4;

/** Get language display string (flag + label) */
export function langDisplay(code: string): string {
  const lang = LANGUAGES.find((l) => l.code === code);
  return lang ? `${lang.flag} ${lang.label}` : code;
}
