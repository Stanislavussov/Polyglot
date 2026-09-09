import { describe, expect, it } from "vitest";
import {
  createLanguageOrderContext,
  languageRank,
  orderLangCodes,
  orderRecordEntries,
  orderTranslations,
} from "../translation-order.js";

/** The user studies de → es → cs, natively speaks ru. */
const ctx = createLanguageOrderContext({ nativeLang: "ru", learningLangs: ["de", "es", "cs"] });

/**
 * Alphabetical order is what both failure modes produce (jsonb key normalization
 * and, before the fix, unordered row reads). It differs from this user's order at
 * every position, so any assertion against it discriminates fixed from buggy.
 */
const ALPHABETICAL = ["cs", "de", "es", "ru"];
const USER_ORDER = ["ru", "de", "es", "cs"];

describe("languageRank", () => {
  it("puts the native language first", () => {
    expect(languageRank("ru", ctx)).toBe(0);
  });

  it("ranks learning languages in the user's selection order", () => {
    expect(languageRank("de", ctx)).toBeLessThan(languageRank("es", ctx));
    expect(languageRank("es", ctx)).toBeLessThan(languageRank("cs", ctx));
  });

  it("ranks a language the user does not study after every one they do", () => {
    expect(languageRank("fr", ctx)).toBeGreaterThan(languageRank("cs", ctx));
  });
});

describe("orderLangCodes", () => {
  it("returns the user's order, not the alphabetical one", () => {
    expect(orderLangCodes(ALPHABETICAL, ctx)).toEqual(USER_ORDER);
  });

  it("is a total order — every permutation of the input yields the same output", () => {
    // This is the property that makes the result immune to how the data arrived:
    // jsonb hands keys back alphabetically, an unordered SELECT hands rows back in
    // whatever order the plan produced. Neither can influence the result.
    const permutations = [
      ["ru", "de", "es", "cs"],
      ["cs", "es", "de", "ru"],
      ["es", "ru", "cs", "de"],
      ["de", "cs", "ru", "es"],
    ];
    for (const input of permutations) {
      expect(orderLangCodes(input, ctx)).toEqual(USER_ORDER);
    }
  });

  it("orders unstudied languages among themselves deterministically", () => {
    expect(orderLangCodes(["pt", "fr", "de"], ctx)).toEqual(["de", "fr", "pt"]);
  });

  it("falls back to native-first plus code order when no learning languages are set", () => {
    const fresh = createLanguageOrderContext({ nativeLang: "ru", learningLangs: [] });
    expect(orderLangCodes(["es", "cs", "ru"], fresh)).toEqual(["ru", "cs", "es"]);
  });

  it("tolerates a duplicated language without throwing or dropping it", () => {
    const dupes = createLanguageOrderContext({ nativeLang: "ru", learningLangs: ["de", "de", "es"] });
    expect(orderLangCodes(["es", "de"], dupes)).toEqual(["de", "es"]);
  });
});

describe("orderRecordEntries", () => {
  it("renders the user's order from an alphabetically-keyed record", () => {
    // A record read back out of jsonb always looks like this.
    const record = { cs: "kočka", de: "Katze", es: "gato", ru: "кошка" };
    expect(orderRecordEntries(record, ctx).map(([code]) => code)).toEqual(USER_ORDER);
  });

  it("returns exactly the record's key set for a strict subset", () => {
    // Regression guard: an earlier design passed a separately-built list of codes
    // alongside the record. Grammar breakdowns cover only the languages that have
    // one, so a list derived from the full translation set was a strict superset —
    // yielding buttons for absent languages, and in the other direction silently
    // omitting translations from the card. Deriving from the record makes the
    // mismatch unrepresentable.
    const subset = { es: ["…"], de: ["…"] };
    const ordered = orderRecordEntries(subset, ctx);
    expect(ordered.map(([code]) => code)).toEqual(["de", "es"]);
    expect(ordered).toHaveLength(Object.keys(subset).length);
  });

  it("keeps each value paired with its own key", () => {
    const record = { cs: "kočka", de: "Katze" };
    expect(orderRecordEntries(record, ctx)).toEqual([
      ["de", "Katze"],
      ["cs", "kočka"],
    ]);
  });

  it("returns an empty list for an empty record", () => {
    expect(orderRecordEntries({}, ctx)).toEqual([]);
  });
});

describe("orderTranslations", () => {
  const byId = new Map([
    [1, "ru"],
    [2, "de"],
    [3, "es"],
    [4, "cs"],
  ]);
  const resolve = (id: number) => byId.get(id);

  it("orders rows by the user's language order regardless of row order", () => {
    const rows = [{ targetLangId: 4 }, { targetLangId: 3 }, { targetLangId: 1 }, { targetLangId: 2 }];
    expect(orderTranslations(rows, ctx, resolve).map((r) => r.targetLangId)).toEqual([1, 2, 3, 4]);
  });

  it("orders a row whose language cannot be resolved last, without dropping it", () => {
    // The languages row was removed. Dropping the translation would be a third,
    // silent behaviour on top of the two the renderers already have.
    const rows = [{ targetLangId: 99 }, { targetLangId: 2 }];
    const ordered = orderTranslations(rows, ctx, resolve);
    expect(ordered).toHaveLength(2);
    expect(ordered.map((r) => r.targetLangId)).toEqual([2, 99]);
  });

  it("does not mutate the caller's array", () => {
    const rows = [{ targetLangId: 4 }, { targetLangId: 2 }];
    orderTranslations(rows, ctx, resolve);
    expect(rows.map((r) => r.targetLangId)).toEqual([4, 2]);
  });
});
