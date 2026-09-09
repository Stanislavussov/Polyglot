import { describe, expect, it } from "vitest";
import { createLanguageOrderContext } from "../../vocabulary/translation-order.js";
import { resolvePronounceableText, selectPronounceableLangs } from "../pronounceable-langs.js";

const order = (nativeLang: string, learningLangs: readonly string[]) =>
  createLanguageOrderContext({ nativeLang, learningLangs });

/** A forward card: the user typed a native word, so the source is their own language. */
const forward = (translations: Record<string, { text: string } | undefined>) => ({
  sourceLang: "ru",
  original: "дом",
  translations,
});

/** A reverse-learning card: the user typed a word in a language they study. */
const reverse = (
  translations: Record<string, { text: string } | undefined>,
  sourceUsage?: { headword?: string | null },
) => ({
  sourceLang: "de",
  original: "arbeit",
  ...(sourceUsage ? { sourceUsage } : {}),
  translations,
});

describe("selectPronounceableLangs", () => {
  it("offers a speaker for each translated language on the card", () => {
    const result = selectPronounceableLangs(
      forward({ ru: { text: "дом" }, de: { text: "Haus" }, es: { text: "casa" } }),
      order("ru", ["de", "es"]),
    );
    expect(result).toEqual(["de", "es"]);
  });

  it("never offers one for the native language, even when it is on the card", () => {
    const result = selectPronounceableLangs(
      forward({ ru: { text: "дом" }, de: { text: "Haus" } }),
      order("ru", ["de"]),
    );
    expect(result).toEqual(["de"]);
  });

  it("offers the source word itself when the user typed a non-native language", () => {
    // The headword sits above the translations and has no entry in the record —
    // without this it was the one word on the card that could not be heard.
    const result = selectPronounceableLangs(
      reverse({ ru: { text: "работа" }, en: { text: "work" } }),
      order("ru", ["de", "en"]),
    );
    expect(result).toEqual(["de", "en"]);
  });

  it("leads with the source word, as the card does", () => {
    const result = selectPronounceableLangs(
      reverse({ ru: { text: "работа" }, en: { text: "work" } }),
      order("ru", ["en", "de"]),
    );
    expect(result[0]).toBe("de");
  });

  it("offers a language the user no longer studies — it is still a foreign word on the card", () => {
    const result = selectPronounceableLangs(
      forward({ de: { text: "Haus" }, fr: { text: "maison" } }),
      order("ru", ["de"]),
    );
    expect(result).toEqual(["de", "fr"]);
  });

  it("does not offer the source twice when it also has a translation entry", () => {
    const result = selectPronounceableLangs(
      reverse({ de: { text: "die Arbeit" }, ru: { text: "работа" } }),
      order("ru", ["de"]),
    );
    expect(result).toEqual(["de"]);
  });

  it("skips a language whose translation is missing or blank", () => {
    const result = selectPronounceableLangs(
      forward({ de: { text: "Haus" }, es: { text: "   " }, fr: undefined }),
      order("ru", ["de", "es", "fr"]),
    );
    expect(result).toEqual(["de"]);
  });

  it("follows the user's language order, not the record's key order", () => {
    // The session stores translations as jsonb, which reads back alphabetized —
    // the buttons must still follow the order the user chose their languages in.
    const alphabetized = { cs: { text: "dům" }, de: { text: "Haus" }, es: { text: "casa" } };
    const result = selectPronounceableLangs(forward(alphabetized), order("ru", ["es", "de", "cs"]));
    expect(result).toEqual(["es", "de", "cs"]);
  });
});

describe("resolvePronounceableText", () => {
  it("speaks the translation shown for a target language", () => {
    expect(resolvePronounceableText(forward({ de: { text: "Haus" } }), "de", order("ru", ["de"]))).toBe("Haus");
  });

  it("speaks the source word when the tap is on the source language", () => {
    expect(resolvePronounceableText(reverse({ ru: { text: "работа" } }), "de", order("ru", ["de"]))).toBe("arbeit");
  });

  it("speaks the citation headword the card displays, not the raw input", () => {
    const card = reverse({ ru: { text: "работа" } }, { headword: "die Arbeit" });
    expect(resolvePronounceableText(card, "de", order("ru", ["de"]))).toBe("die Arbeit");
  });

  it("returns nothing for a language the card has no word for", () => {
    expect(resolvePronounceableText(forward({ de: { text: "Haus" } }), "es", order("ru", ["de", "es"]))).toBe("");
  });
});
