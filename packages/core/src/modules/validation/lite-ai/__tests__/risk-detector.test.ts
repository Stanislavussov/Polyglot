import { describe, expect, it } from "vitest";
import { isHighRisk, SAFE_LANGUAGES } from "../risk-detector.js";
import type { RiskDetectorInput } from "../types.js";

describe("isHighRisk", () => {
  const safeBase: RiskDetectorInput = {
    inputType: "word",
    dictionaryContext: {
      word: "hello",
      pos: "noun",
      glosses: ["a greeting"],
      langCode: "en",
    },
    expressionTypes: ["literal"],
    targetLangs: ["en", "de"],
  };

  describe("criterion 1: phrase/idiom input", () => {
    it("returns true when inputType is phrase", () => {
      expect(isHighRisk({ ...safeBase, inputType: "phrase" })).toBe(true);
    });

    it("returns true when dictionaryContext pos is idiom", () => {
      expect(
        isHighRisk({
          ...safeBase,
          dictionaryContext: { word: "kick bucket", pos: "idiom", glosses: ["to die"], langCode: "en" },
        }),
      ).toBe(true);
    });

    it("returns true when dictionaryContext pos is phrase", () => {
      expect(
        isHighRisk({
          ...safeBase,
          dictionaryContext: { word: "by the way", pos: "phrase", glosses: ["incidentally"], langCode: "en" },
        }),
      ).toBe(true);
    });

    it("returns false for word inputType with non-idiom pos", () => {
      expect(isHighRisk(safeBase)).toBe(false);
    });
  });

  describe("criterion 2: idiomatic expression type", () => {
    it("returns true when any expressionType is idiomatic_equivalent", () => {
      expect(
        isHighRisk({
          ...safeBase,
          expressionTypes: ["literal", "idiomatic_equivalent"],
        }),
      ).toBe(true);
    });

    it("returns false when all expressionTypes are literal", () => {
      expect(
        isHighRisk({
          ...safeBase,
          expressionTypes: ["literal", "literal"],
        }),
      ).toBe(false);
    });

    it("returns false when expressionTypes is undefined", () => {
      expect(
        isHighRisk({
          ...safeBase,
          expressionTypes: undefined,
        }),
      ).toBe(false);
    });

    it("returns false when expressionTypes is empty", () => {
      expect(
        isHighRisk({
          ...safeBase,
          expressionTypes: [],
        }),
      ).toBe(false);
    });
  });

  describe("criterion 3: Wiktionary miss (no dictionary context)", () => {
    it("returns true when dictionaryContext is undefined", () => {
      expect(
        isHighRisk({
          ...safeBase,
          dictionaryContext: undefined,
        }),
      ).toBe(true);
    });

    it("returns false when dictionaryContext is present", () => {
      expect(isHighRisk(safeBase)).toBe(false);
    });
  });

  describe("criterion 4: uncommon target language", () => {
    it("returns true when target language is not in safe list", () => {
      expect(
        isHighRisk({
          ...safeBase,
          targetLangs: ["en", "sw"], // Swahili not in safe list
        }),
      ).toBe(true);
    });

    it("returns true when any target language is not in safe list", () => {
      expect(
        isHighRisk({
          ...safeBase,
          targetLangs: ["en", "de", "th"], // Thai not in safe list
        }),
      ).toBe(true);
    });

    it("returns false when all target languages are in safe list", () => {
      expect(
        isHighRisk({
          ...safeBase,
          targetLangs: ["en", "de", "fr"],
        }),
      ).toBe(false);
    });
  });

  describe("custom safe languages", () => {
    it("accepts custom safe languages list", () => {
      const customSafe = ["en", "de"];
      // fr is NOT in custom list
      expect(isHighRisk({ ...safeBase, targetLangs: ["en", "fr"] }, customSafe)).toBe(true);
    });

    it("uses custom list to determine safe languages", () => {
      const customSafe = ["en", "de", "sw"];
      // sw IS in custom list
      expect(isHighRisk({ ...safeBase, targetLangs: ["en", "sw"] }, customSafe)).toBe(false);
    });
  });

  describe("combined criteria", () => {
    it("returns false when all criteria are safe", () => {
      expect(isHighRisk(safeBase)).toBe(false);
    });

    it("returns true when multiple criteria trigger", () => {
      expect(
        isHighRisk({
          inputType: "phrase",
          dictionaryContext: undefined,
          expressionTypes: ["idiomatic_equivalent"],
          targetLangs: ["th"],
        }),
      ).toBe(true);
    });

    it("returns false for sentence inputType with safe conditions", () => {
      // sentence is neither word nor phrase — only phrase triggers criterion 1
      expect(
        isHighRisk({
          ...safeBase,
          inputType: "sentence",
        }),
      ).toBe(false);
    });
  });

  describe("SAFE_LANGUAGES constant", () => {
    it("contains expected languages", () => {
      expect(SAFE_LANGUAGES).toContain("en");
      expect(SAFE_LANGUAGES).toContain("es");
      expect(SAFE_LANGUAGES).toContain("fr");
      expect(SAFE_LANGUAGES).toContain("de");
      expect(SAFE_LANGUAGES).toContain("ru");
      expect(SAFE_LANGUAGES).toContain("zh");
      expect(SAFE_LANGUAGES).toContain("ja");
      expect(SAFE_LANGUAGES).toContain("ko");
      expect(SAFE_LANGUAGES).toContain("pt");
      expect(SAFE_LANGUAGES).toContain("it");
    });

    it("has exactly 10 entries", () => {
      expect(SAFE_LANGUAGES).toHaveLength(10);
    });
  });
});
