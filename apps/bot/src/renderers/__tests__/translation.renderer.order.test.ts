/**
 * Language ordering on the translation card surfaces.
 *
 * The regression these guard: the card is held in the bot session, which lives in
 * a `jsonb` column. Postgres normalizes `jsonb` object keys by (length, then
 * bytewise), and every ISO 639-1 code is two characters — so the translations
 * record always reads back alphabetically. The first render (still in memory) was
 * correct and every later one was not, which is what made the order appear to
 * "jump" mid-conversation.
 *
 * The fixture keys are already alphabetical, exactly as they come back from the
 * session, and the user's order differs from it at every position.
 */
import type { TranslateOutput } from "@polyglot/core";
import { createLanguageOrderContext } from "@polyglot/core";
import { describe, expect, it } from "vitest";
import { renderSentenceTranslation, renderTranslation } from "../translation.renderer.js";

const ORDER = createLanguageOrderContext({ nativeLang: "ru", learningLangs: ["de", "es", "cs"] });
const USER_ORDER = ["RU", "DE", "ES", "CS"];

/** Rehydrated from jsonb: keys sorted bytewise. */
const REHYDRATED: TranslateOutput = {
  original: "house",
  sourceLang: "en",
  emoji: "🏠",
  nativeSynonyms: [],
  translations: {
    cs: { text: "dům", synonyms: [], examples: [] },
    de: { text: "Haus", synonyms: [], examples: [] },
    es: { text: "casa", synonyms: [], examples: [] },
    ru: { text: "дом", synonyms: [], examples: [] },
  },
};

function renderedLanguageOrder(html: string): string[] {
  return [...html.matchAll(/\b(RU|DE|ES|CS):/g)].map((m) => m[1] as string);
}

describe("renderTranslation — language order", () => {
  it("renders the user's order from an alphabetically-keyed record", () => {
    expect(renderedLanguageOrder(renderTranslation(REHYDRATED, ORDER, "en"))).toEqual(USER_ORDER);
  });

  it("ignores the record's own key order", () => {
    const reordered: TranslateOutput = {
      ...REHYDRATED,
      translations: {
        es: REHYDRATED.translations.es!,
        ru: REHYDRATED.translations.ru!,
        cs: REHYDRATED.translations.cs!,
        de: REHYDRATED.translations.de!,
      },
    };
    expect(renderedLanguageOrder(renderTranslation(reordered, ORDER, "en"))).toEqual(USER_ORDER);
  });
});

describe("renderSentenceTranslation — language order", () => {
  it("renders the user's order from an alphabetically-keyed record", () => {
    expect(renderedLanguageOrder(renderSentenceTranslation(REHYDRATED, ORDER, "en"))).toEqual(USER_ORDER);
  });
});
