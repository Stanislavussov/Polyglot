import { describe, expect, it } from "vitest";
import { createLanguageOrderContext } from "../../vocabulary/translation-order.js";
import { selectPronounceableLangs } from "../pronounceable-langs.js";

const order = (nativeLang: string, learningLangs: readonly string[]) =>
  createLanguageOrderContext({ nativeLang, learningLangs });

describe("selectPronounceableLangs", () => {
  it("offers a speaker for each learning language on the card", () => {
    const result = selectPronounceableLangs(
      { ru: { text: "дом" }, de: { text: "Haus" }, es: { text: "casa" } },
      order("ru", ["de", "es"]),
    );
    expect(result).toEqual(["de", "es"]);
  });

  it("never offers one for the native language, even when it is on the card", () => {
    const result = selectPronounceableLangs({ ru: { text: "дом" }, de: { text: "Haus" } }, order("ru", ["de"]));
    expect(result).toEqual(["de"]);
  });

  it("never offers one for a language the user is not learning", () => {
    // A card can carry a language the user has since removed from their set.
    const result = selectPronounceableLangs({ de: { text: "Haus" }, fr: { text: "maison" } }, order("ru", ["de"]));
    expect(result).toEqual(["de"]);
  });

  it("offers nothing when the user studies no languages", () => {
    expect(selectPronounceableLangs({ de: { text: "Haus" } }, order("ru", []))).toEqual([]);
  });

  it("skips a learning language whose translation is missing or blank", () => {
    const result = selectPronounceableLangs(
      { de: { text: "Haus" }, es: { text: "   " }, fr: undefined },
      order("ru", ["de", "es", "fr"]),
    );
    expect(result).toEqual(["de"]);
  });

  it("follows the user's language order, not the record's key order", () => {
    // The session stores translations as jsonb, which reads back alphabetized —
    // the buttons must still follow the order the user chose their languages in.
    const alphabetized = { cs: { text: "dům" }, de: { text: "Haus" }, es: { text: "casa" } };
    const result = selectPronounceableLangs(alphabetized, order("ru", ["es", "de", "cs"]));
    expect(result).toEqual(["es", "de", "cs"]);
  });
});
