import type { Locale, LocaleMessages } from "./types.js";

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const ruMessages = require("./locales/ru.json") as LocaleMessages;
const enMessages = require("./locales/en.json") as LocaleMessages;
const csMessages = require("./locales/cs.json") as LocaleMessages;

const messages: Record<Locale, LocaleMessages> = {
  ru: ruMessages,
  en: enMessages,
  cs: csMessages,
};

/** Pure i18n service — returns localized UI strings */
export class I18nService {
  private locale: Locale;

  constructor(locale: Locale = "en") {
    this.locale = locale;
  }

  /** Set the active locale */
  setLocale(locale: Locale): void {
    this.locale = locale;
  }

  /** Get the active locale */
  getLocale(): Locale {
    return this.locale;
  }

  /** Translate a key to the current locale, with optional fallback to English */
  t(key: string): string {
    return messages[this.locale]?.[key] ?? messages.en[key] ?? key;
  }

  /** Get all available locales */
  getAvailableLocales(): Locale[] {
    return Object.keys(messages) as Locale[];
  }
}
