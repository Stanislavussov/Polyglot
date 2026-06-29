import { createRequire } from "node:module";
import type { I18nKey, LocaleMessages, SupportedLang } from "./types.js";

const require = createRequire(import.meta.url);

/* ------------------------------------------------------------------ */
/*  Load locale files                                                  */
/* ------------------------------------------------------------------ */

const enMessages = require("./locales/en.json") as LocaleMessages;
const ruMessages = require("./locales/ru.json") as LocaleMessages;
const csMessages = require("./locales/cs.json") as LocaleMessages;
const deMessages = require("./locales/de.json") as LocaleMessages;
const frMessages = require("./locales/fr.json") as LocaleMessages;
const esMessages = require("./locales/es.json") as LocaleMessages;
const itMessages = require("./locales/it.json") as LocaleMessages;
const ptMessages = require("./locales/pt.json") as LocaleMessages;
const ukMessages = require("./locales/uk.json") as LocaleMessages;
const plMessages = require("./locales/pl.json") as LocaleMessages;
const kkMessages = require("./locales/kk.json") as LocaleMessages;

/**
 * All loaded locale dictionaries.
 * Languages without a dedicated locale file fall back to English.
 */
const messages: Partial<Record<SupportedLang, LocaleMessages>> = {
  en: enMessages,
  ru: ruMessages,
  cs: csMessages,
  de: deMessages,
  fr: frMessages,
  es: esMessages,
  it: itMessages,
  pt: ptMessages,
  uk: ukMessages,
  pl: plMessages,
  kk: kkMessages,
};

/* ------------------------------------------------------------------ */
/*  Supported-language list (all 11 interface codes)                   */
/* ------------------------------------------------------------------ */

const SUPPORTED_LANGS: readonly SupportedLang[] = [
  "en",
  "ru",
  "cs",
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "uk",
  "pl",
  "kk",
] as const;

const supportedSet = new Set<string>(SUPPORTED_LANGS);

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Translate a UI key to the given language.
 *
 * - Falls back to `en` when key is missing in the requested locale.
 * - Falls back to `en` when locale has no dedicated file.
 * - Never throws — returns the English text (or the key itself as last resort).
 * - Supports interpolation: `{param}` placeholders replaced with `params` values.
 */
export function t(key: I18nKey, lang: SupportedLang, params?: Record<string, string | number>): string {
  const localeDict = messages[lang];
  let text: string = localeDict?.[key] ?? enMessages[key] ?? (key as string);

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }

  return text;
}

/**
 * Returns the list of all supported interface languages.
 */
export function getSupportedLangs(): SupportedLang[] {
  return [...SUPPORTED_LANGS];
}

/**
 * Type guard — checks whether a string is a valid SupportedLang.
 */
export function isSupported(lang: string): lang is SupportedLang {
  return supportedSet.has(lang);
}
