/**
 * Language ordering on the flashcard back.
 *
 * The deck is stored in the bot session specifically so cards can be re-rendered
 * without re-fetching. The session is a `jsonb` column, which normalizes object
 * keys, so the per-card translations record comes back alphabetically no matter
 * what order the pipeline built it in. Ordering therefore has to happen here, at
 * render time, rather than upstream in the pipeline.
 */
import type { WordDisplayData } from "@polyglot/core";
import { createLanguageOrderContext } from "@polyglot/core";
import { describe, expect, it } from "vitest";
import { renderFlashCardBack } from "../flashcard.renderer.js";

const ORDER = createLanguageOrderContext({ nativeLang: "ru", learningLangs: ["de", "es", "cs"] });

/** Rehydrated from jsonb: keys sorted bytewise. */
const REHYDRATED: WordDisplayData = {
  id: 1,
  original: "house",
  sourceLang: "en",
  inputType: "word",
  emoji: "🏠",
  createdAt: new Date("2025-01-01"),
  translations: {
    cs: { text: "dům" },
    de: { text: "Haus" },
    es: { text: "casa" },
    ru: { text: "дом" },
  },
};

describe("renderFlashCardBack — language order", () => {
  it("renders the user's order from an alphabetically-keyed record", () => {
    const html = renderFlashCardBack(REHYDRATED, 1, 1, "en", ORDER);
    const positions = ["дом", "Haus", "casa", "dům"].map((text) => html.indexOf(text));

    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("keeps a language the user no longer studies, ordered last", () => {
    const withDropped: WordDisplayData = {
      ...REHYDRATED,
      translations: { ...REHYDRATED.translations, fr: { text: "maison" } },
    };
    const html = renderFlashCardBack(withDropped, 1, 1, "en", ORDER);

    expect(html).toContain("maison");
    expect(html.indexOf("dům")).toBeLessThan(html.indexOf("maison"));
  });
});
