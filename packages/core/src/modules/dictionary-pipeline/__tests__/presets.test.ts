import { describe, expect, it } from "vitest";
import { FLASHCARD_CONFIG, NOTIFICATION_DICT_CONFIG, WORD_OF_DAY_DICT_CONFIG } from "../presets.js";
import type { DictionaryWordConfig } from "../types.js";

describe("dictionary pipeline presets", () => {
  it("configures flashcards with all presentation fields enabled", () => {
    expect(FLASHCARD_CONFIG.selection).toEqual({ strategy: "random", limit: 10 });
    expect(FLASHCARD_CONFIG.presentation.fields).toEqual({
      synonyms: true,
      examples: true,
      alternatives: true,
      equivalentNote: true,
      connotationWarning: true,
    });
    expect(FLASHCARD_CONFIG.presentation.flashcard).toEqual({ frontSide: "original" });
  });

  it("configures notification dictionary output as compact", () => {
    expect(NOTIFICATION_DICT_CONFIG.selection).toEqual({ strategy: "least_reviewed", limit: 1 });
    expect(NOTIFICATION_DICT_CONFIG.presentation.fields).toEqual({
      synonyms: false,
      examples: false,
      alternatives: false,
      equivalentNote: false,
      connotationWarning: false,
    });
    expect(NOTIFICATION_DICT_CONFIG.presentation.flashcard).toBeUndefined();
  });

  it("configures word-of-day dictionary output with synonyms and notes", () => {
    expect(WORD_OF_DAY_DICT_CONFIG.selection).toEqual({ strategy: "oldest_first", limit: 1 });
    expect(WORD_OF_DAY_DICT_CONFIG.presentation.fields).toEqual({
      synonyms: true,
      examples: false,
      alternatives: false,
      equivalentNote: true,
      connotationWarning: true,
    });
  });

  it("presets satisfy DictionaryWordConfig", () => {
    const configs: DictionaryWordConfig[] = [FLASHCARD_CONFIG, NOTIFICATION_DICT_CONFIG, WORD_OF_DAY_DICT_CONFIG];
    expect(configs).toHaveLength(3);
  });
});
