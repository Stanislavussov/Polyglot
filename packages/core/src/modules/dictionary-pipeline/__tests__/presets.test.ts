import { describe, expect, it } from "vitest";
import { FLASHCARD_CONFIG, NOTIFICATION_DICT_CONFIG, WORD_OF_DAY_DICT_CONFIG } from "../presets.js";
import type { DictionaryWordConfig } from "../types.js";

describe("dictionary pipeline presets", () => {
  describe("FLASHCARD_CONFIG", () => {
    it("uses random strategy", () => {
      expect(FLASHCARD_CONFIG.selection.strategy).toBe("random");
    });

    it("has limit of 10", () => {
      expect(FLASHCARD_CONFIG.selection.limit).toBe(10);
    });

    it("has all presentation fields enabled", () => {
      expect(FLASHCARD_CONFIG.presentation.fields).toEqual({
        transcription: true,
        synonyms: true,
        examples: true,
        alternatives: true,
        equivalentNote: true,
        connotationWarning: true,
      });
    });

    it("has flashcard config with original frontSide", () => {
      expect(FLASHCARD_CONFIG.presentation.flashcard).toEqual({
        frontSide: "original",
      });
    });

    it("shows register", () => {});

    it("is a valid DictionaryWordConfig", () => {
      const config: DictionaryWordConfig = FLASHCARD_CONFIG;
      expect(config.selection).toBeDefined();
      expect(config.presentation).toBeDefined();
    });
  });

  describe("NOTIFICATION_DICT_CONFIG", () => {
    it("uses least_reviewed strategy", () => {
      expect(NOTIFICATION_DICT_CONFIG.selection.strategy).toBe("least_reviewed");
    });

    it("has limit of 1", () => {
      expect(NOTIFICATION_DICT_CONFIG.selection.limit).toBe(1);
    });

    it("has compact fields — only transcription enabled", () => {
      expect(NOTIFICATION_DICT_CONFIG.presentation.fields.transcription).toBe(true);
      expect(NOTIFICATION_DICT_CONFIG.presentation.fields.synonyms).toBe(false);
      expect(NOTIFICATION_DICT_CONFIG.presentation.fields.examples).toBe(false);
      expect(NOTIFICATION_DICT_CONFIG.presentation.fields.alternatives).toBe(false);
    });

    it("does not show register", () => {});

    it("has no flashcard config", () => {
      expect(NOTIFICATION_DICT_CONFIG.presentation.flashcard).toBeUndefined();
    });

    it("is a valid DictionaryWordConfig", () => {
      const config: DictionaryWordConfig = NOTIFICATION_DICT_CONFIG;
      expect(config.selection).toBeDefined();
      expect(config.presentation).toBeDefined();
    });
  });

  describe("WORD_OF_DAY_DICT_CONFIG", () => {
    it("uses oldest_first strategy", () => {
      expect(WORD_OF_DAY_DICT_CONFIG.selection.strategy).toBe("oldest_first");
    });

    it("has limit of 1", () => {
      expect(WORD_OF_DAY_DICT_CONFIG.selection.limit).toBe(1);
    });

    it("shows transcription and synonyms but not examples/alternatives", () => {
      expect(WORD_OF_DAY_DICT_CONFIG.presentation.fields.transcription).toBe(true);
      expect(WORD_OF_DAY_DICT_CONFIG.presentation.fields.synonyms).toBe(true);
      expect(WORD_OF_DAY_DICT_CONFIG.presentation.fields.examples).toBe(false);
      expect(WORD_OF_DAY_DICT_CONFIG.presentation.fields.alternatives).toBe(false);
    });

    it("shows register", () => {});

    it("is a valid DictionaryWordConfig", () => {
      const config: DictionaryWordConfig = WORD_OF_DAY_DICT_CONFIG;
      expect(config.selection).toBeDefined();
      expect(config.presentation).toBeDefined();
    });
  });
});
