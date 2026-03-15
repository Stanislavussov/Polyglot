import type { SupportedLang, LocaleMessages } from "./types.js";

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const enMessages = require("./locales/en.json") as LocaleMessages;
const ruMessages = require("./locales/ru.json") as LocaleMessages;
const csMessages = require("./locales/cs.json") as LocaleMessages;

const messages: Partial<Record<SupportedLang, LocaleMessages>> = {
  en: enMessages,
  ru: ruMessages,
  cs: csMessages,
};

/**
 * Class-based i18n service — kept for backward compatibility.
 * Prefer the functional `t()` API from `./i18n.ts` for new code.
 *
 * @deprecated Use `t(key, lang, params?)` instead.
 */
export class I18nService {
  private locale: SupportedLang;

  constructor(locale: SupportedLang = "en") {
    this.locale = locale;
  }

  setLocale(locale: SupportedLang): void {
    this.locale = locale;
  }

  getLocale(): SupportedLang {
    return this.locale;
  }

  /** Translate a key to the current locale, with fallback to English */
  t(key: string): string {
    const localeDict = messages[this.locale];
    return (
      localeDict?.[key as keyof LocaleMessages] ??
      enMessages[key as keyof LocaleMessages] ??
      key
    );
  }

  /** Get all available locales */
  getAvailableLocales(): SupportedLang[] {
    return Object.keys(messages) as SupportedLang[];
  }
}
