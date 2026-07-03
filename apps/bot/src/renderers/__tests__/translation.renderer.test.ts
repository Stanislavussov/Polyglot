import type { TranslateOutput } from "@polyglot/core";
import { describe, expect, it } from "vitest";
import { renderTranslation } from "../translation.renderer.js";

/** Minimal word-translation output for renderer tests. */
function makeOutput(overrides?: Partial<TranslateOutput>): TranslateOutput {
  return {
    original: "stroha",
    sourceLang: "cs",
    emoji: "🌾",
    nativeSynonyms: [],
    translations: {
      en: {
        text: "husk",
        synonyms: [],
        examples: [{ context: "neutral", target: "A dry husk." }],
      },
    },
    ...overrides,
  };
}

describe("renderTranslation — unverified caveat (Task 70)", () => {
  it("renders the caveat line for an unverified (translate-as-written) card", () => {
    const card = renderTranslation(makeOutput({ unverified: true }), "en");
    expect(card).toContain("translated literally");
  });

  it("omits the caveat for a normal card", () => {
    const card = renderTranslation(makeOutput(), "en");
    expect(card).not.toContain("translated literally");
  });
});
