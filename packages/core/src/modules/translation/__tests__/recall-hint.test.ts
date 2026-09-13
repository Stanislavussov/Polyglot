import { describe, expect, it } from "vitest";
import { withoutLeakingRecallHint } from "../recall-hint.js";
import type { SourceUsage, TranslationResult } from "../types.js";

const RESULT: TranslationResult = {
  nativeSynonyms: [{ text: "труд" }],
  translations: {
    ru: { text: "работа", synonyms: [{ text: "занятие" }], examples: [] },
    cs: { text: "práce", synonyms: [], examples: [] },
  },
};

const usage = (recallHint: string | null | undefined): SourceUsage => ({
  headword: "die Arbeit",
  explanation: "Работа, труд.",
  synonyms: [],
  examples: [],
  recallHint,
});

describe("withoutLeakingRecallHint", () => {
  it("keeps a hint that nudges recall without naming the answer", () => {
    const hint = "Нейтральное слово, звучит в офисе и дома.";
    expect(withoutLeakingRecallHint(usage(hint), RESULT).recallHint).toBe(hint);
  });

  it("drops a hint that contains the native translation, whatever its case", () => {
    expect(withoutLeakingRecallHint(usage("Это Работа, но в широком смысле."), RESULT).recallHint).toBeNull();
  });

  it("drops a hint that names a synonym of the answer in any language", () => {
    expect(withoutLeakingRecallHint(usage("Близко к слову «занятие»."), RESULT).recallHint).toBeNull();
    expect(withoutLeakingRecallHint(usage("Как чешское práce."), RESULT).recallHint).toBeNull();
    expect(withoutLeakingRecallHint(usage("Почти труд."), RESULT).recallHint).toBeNull();
  });

  it("ignores answers too short to match meaningfully", () => {
    const shortAnswer: TranslationResult = {
      nativeSynonyms: [],
      translations: { en: { text: "go", synonyms: [], examples: [] } },
    };
    const hint = "Очень частый глагол, звучит в разговоре.";
    expect(withoutLeakingRecallHint(usage(hint), shortAnswer).recallHint).toBe(hint);
  });

  it("normalizes a blank hint to null and leaves a hint-less block untouched", () => {
    expect(withoutLeakingRecallHint(usage("   "), RESULT).recallHint).toBeNull();
    const { recallHint: _omitted, ...withoutHint } = usage(undefined);
    expect(withoutLeakingRecallHint(withoutHint, RESULT)).toEqual(withoutHint);
  });
});
