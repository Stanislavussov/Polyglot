import { describe, expect, it } from "vitest";
import {
  KNOWN_POS,
  validateGlosses,
  validatePos,
  validateWiktionaryEntry,
  validateWordContext,
} from "../validators/wiktionary.validator.js";

// ─────────────────────────────────────────────
// validateWiktionaryEntry
// ─────────────────────────────────────────────

describe("validateWiktionaryEntry", () => {
  const validEntry = {
    word: "что ли",
    lang: "Russian",
    lang_code: "ru",
    pos: "phrase",
    senses: [{ glosses: ["or something, perhaps"] }],
  };

  it("returns valid for a complete entry", () => {
    const result = validateWiktionaryEntry(validEntry);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns valid with minimal required fields", () => {
    const result = validateWiktionaryEntry({
      word: "hello",
      lang_code: "en",
      pos: "phrase",
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns valid with 3-letter lang_code", () => {
    const result = validateWiktionaryEntry({
      word: "test",
      lang_code: "ces",
      pos: "noun",
    });
    expect(result.valid).toBe(true);
  });

  it("fails for null input", () => {
    const result = validateWiktionaryEntry(null as any);
    expect(result.valid).toBe(false);
    expect(result.errors[0].rule).toBe("wiktionary");
    expect(result.errors[0].message).toContain("non-null object");
  });

  it("fails for undefined input", () => {
    const result = validateWiktionaryEntry(undefined as any);
    expect(result.valid).toBe(false);
  });

  it("fails when word is missing", () => {
    const result = validateWiktionaryEntry({
      lang_code: "ru",
      pos: "phrase",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "word")).toBe(true);
  });

  it("fails when word is empty string", () => {
    const result = validateWiktionaryEntry({
      word: "",
      lang_code: "ru",
      pos: "phrase",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "word")).toBe(true);
  });

  it("fails when word is whitespace-only", () => {
    const result = validateWiktionaryEntry({
      word: "   ",
      lang_code: "ru",
      pos: "phrase",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "word")).toBe(true);
  });

  it("fails when lang_code is missing", () => {
    const result = validateWiktionaryEntry({
      word: "привет",
      pos: "phrase",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "lang_code")).toBe(true);
  });

  it("fails when lang_code has invalid format (uppercase)", () => {
    const result = validateWiktionaryEntry({
      word: "hello",
      lang_code: "RU",
      pos: "phrase",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "lang_code" && e.message.includes("format"))).toBe(true);
  });

  it("fails when lang_code has invalid format (too long)", () => {
    const result = validateWiktionaryEntry({
      word: "hello",
      lang_code: "russian",
      pos: "phrase",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "lang_code")).toBe(true);
  });

  it("fails when pos is missing", () => {
    const result = validateWiktionaryEntry({
      word: "hello",
      lang_code: "en",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "pos")).toBe(true);
  });

  it("fails when pos is empty string", () => {
    const result = validateWiktionaryEntry({
      word: "hello",
      lang_code: "en",
      pos: "",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "pos")).toBe(true);
  });

  it("reports error when lang is not a string", () => {
    const result = validateWiktionaryEntry({
      word: "hello",
      lang_code: "en",
      pos: "noun",
      lang: 42,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "lang")).toBe(true);
  });

  it("reports error when senses is not an array", () => {
    const result = validateWiktionaryEntry({
      word: "hello",
      lang_code: "en",
      pos: "noun",
      senses: "not an array",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "senses")).toBe(true);
  });

  it("reports error when senses is an empty array", () => {
    const result = validateWiktionaryEntry({
      word: "hello",
      lang_code: "en",
      pos: "noun",
      senses: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "senses" && e.message.includes("empty"))).toBe(true);
  });

  it("reports error when forms is not an array", () => {
    const result = validateWiktionaryEntry({
      word: "hello",
      lang_code: "en",
      pos: "noun",
      forms: "not an array",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "forms")).toBe(true);
  });

  it("allows forms as valid array", () => {
    const result = validateWiktionaryEntry({
      word: "hello",
      lang_code: "en",
      pos: "noun",
      forms: [{ form: "hellos", tags: ["plural"] }],
    });
    expect(result.valid).toBe(true);
  });

  it("collects multiple errors at once", () => {
    const result = validateWiktionaryEntry({});
    expect(result.valid).toBe(false);
    // Should have errors for word, lang_code, and pos
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
    const fields = result.errors.map((e) => e.field).filter(Boolean);
    expect(fields).toContain("word");
    expect(fields).toContain("lang_code");
    expect(fields).toContain("pos");
  });

  it("validates real Wiktionary entries (Russian phrase)", () => {
    const result = validateWiktionaryEntry({
      word: "когда рак на горе свистнет",
      lang: "Russian",
      lang_code: "ru",
      pos: "phrase",
      forms: [
        { form: "когда ра́к на горе́ сви́стнет", tags: ["canonical"] },
        { form: "kogda rák na goré svístnet", tags: ["romanization"] },
      ],
      senses: [{ glosses: ["when pigs fly, never"] }],
    });
    expect(result.valid).toBe(true);
  });

  it("validates real Wiktionary entries (German phrase)", () => {
    const result = validateWiktionaryEntry({
      word: "an der Ecke",
      lang: "German",
      lang_code: "de",
      pos: "phrase",
      senses: [{ glosses: ["at the corner, nearby"] }],
    });
    expect(result.valid).toBe(true);
  });
});

// ─────────────────────────────────────────────
// validateWordContext
// ─────────────────────────────────────────────

describe("validateWordContext", () => {
  const validRecord = {
    word: "что ли",
    languageId: 1,
    pos: "phrase",
    formTags: ["canonical"],
    glosses: ["or something, perhaps"],
  };

  it("returns valid for a complete record", () => {
    const result = validateWordContext(validRecord);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns valid with minimal required fields", () => {
    const result = validateWordContext({
      word: "hello",
      languageId: 1,
      pos: "noun",
    });
    expect(result.valid).toBe(true);
  });

  it("fails for null input", () => {
    const result = validateWordContext(null as any);
    expect(result.valid).toBe(false);
    expect(result.errors[0].rule).toBe("wordContext");
  });

  it("fails when word is missing", () => {
    const result = validateWordContext({
      languageId: 1,
      pos: "phrase",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "word")).toBe(true);
  });

  it("fails when word is empty", () => {
    const result = validateWordContext({
      word: "",
      languageId: 1,
      pos: "phrase",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "word")).toBe(true);
  });

  it("fails when languageId is missing", () => {
    const result = validateWordContext({
      word: "hello",
      pos: "noun",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "languageId")).toBe(true);
  });

  it("fails when languageId is zero", () => {
    const result = validateWordContext({
      word: "hello",
      languageId: 0,
      pos: "noun",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "languageId")).toBe(true);
  });

  it("fails when languageId is negative", () => {
    const result = validateWordContext({
      word: "hello",
      languageId: -1,
      pos: "noun",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "languageId")).toBe(true);
  });

  it("fails when languageId is a float", () => {
    const result = validateWordContext({
      word: "hello",
      languageId: 1.5,
      pos: "noun",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "languageId")).toBe(true);
  });

  it("fails when languageId is a string", () => {
    const result = validateWordContext({
      word: "hello",
      languageId: "1",
      pos: "noun",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "languageId")).toBe(true);
  });

  it("fails when pos is missing", () => {
    const result = validateWordContext({
      word: "hello",
      languageId: 1,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "pos")).toBe(true);
  });

  it("reports error when formTags is not an array", () => {
    const result = validateWordContext({
      word: "hello",
      languageId: 1,
      pos: "noun",
      formTags: "canonical",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "formTags")).toBe(true);
  });

  it("reports error when formTags contains non-string", () => {
    const result = validateWordContext({
      word: "hello",
      languageId: 1,
      pos: "noun",
      formTags: ["canonical", 42],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "formTags.1")).toBe(true);
  });

  it("reports error when glosses is not an array", () => {
    const result = validateWordContext({
      word: "hello",
      languageId: 1,
      pos: "noun",
      glosses: "some definition",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "glosses")).toBe(true);
  });

  it("reports error when glosses contains empty string", () => {
    const result = validateWordContext({
      word: "hello",
      languageId: 1,
      pos: "noun",
      glosses: ["valid definition", ""],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "glosses.1")).toBe(true);
  });

  it("reports error when glosses contains non-string", () => {
    const result = validateWordContext({
      word: "hello",
      languageId: 1,
      pos: "noun",
      glosses: [42],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "glosses.0")).toBe(true);
  });

  it("collects multiple errors at once", () => {
    const result = validateWordContext({});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  it("passes with empty formTags and glosses arrays", () => {
    const result = validateWordContext({
      word: "hello",
      languageId: 1,
      pos: "noun",
      formTags: [],
      glosses: [],
    });
    expect(result.valid).toBe(true);
  });
});

// ─────────────────────────────────────────────
// validateGlosses
// ─────────────────────────────────────────────

describe("validateGlosses", () => {
  it("returns valid for non-empty array of strings", () => {
    const result = validateGlosses(["hello", "greeting"]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns valid for single-element array", () => {
    const result = validateGlosses(["when pigs fly, never"]);
    expect(result.valid).toBe(true);
  });

  it("fails for non-array input", () => {
    const result = validateGlosses("not an array");
    expect(result.valid).toBe(false);
    expect(result.errors[0].rule).toBe("glosses");
  });

  it("fails for null input", () => {
    const result = validateGlosses(null);
    expect(result.valid).toBe(false);
  });

  it("fails for empty array", () => {
    const result = validateGlosses([]);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("empty");
  });

  it("fails for array with non-string element", () => {
    const result = validateGlosses(["hello", 42]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "glosses.1")).toBe(true);
  });

  it("fails for array with empty string", () => {
    const result = validateGlosses(["hello", ""]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "glosses.1" && e.message.includes("empty"))).toBe(true);
  });

  it("fails for array with whitespace-only string", () => {
    const result = validateGlosses(["   "]);
    expect(result.valid).toBe(false);
  });
});

// ─────────────────────────────────────────────
// validatePos
// ─────────────────────────────────────────────

describe("validatePos", () => {
  it("returns valid for known POS 'phrase'", () => {
    const result = validatePos("phrase");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns valid for known POS 'noun'", () => {
    const result = validatePos("noun");
    expect(result.valid).toBe(true);
  });

  it("returns valid for known POS 'verb'", () => {
    const result = validatePos("verb");
    expect(result.valid).toBe(true);
  });

  it("returns valid for known POS 'idiom'", () => {
    const result = validatePos("idiom");
    expect(result.valid).toBe(true);
  });

  it("returns valid for known POS 'adj'", () => {
    const result = validatePos("adj");
    expect(result.valid).toBe(true);
  });

  it("reports unknown POS (not a hard fail but flagged)", () => {
    const result = validatePos("unknown_pos");
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("Unknown POS");
    expect(result.errors[0].message).toContain("unknown_pos");
  });

  it("fails for non-string input", () => {
    const result = validatePos(42);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("non-empty string");
  });

  it("fails for empty string", () => {
    const result = validatePos("");
    expect(result.valid).toBe(false);
  });

  it("fails for null", () => {
    const result = validatePos(null);
    expect(result.valid).toBe(false);
  });

  it("validates all known POS values", () => {
    for (const pos of KNOWN_POS) {
      const result = validatePos(pos);
      expect(result.valid).toBe(true);
    }
  });

  it("exports KNOWN_POS with expected entries", () => {
    expect(KNOWN_POS).toContain("phrase");
    expect(KNOWN_POS).toContain("noun");
    expect(KNOWN_POS).toContain("verb");
    expect(KNOWN_POS).toContain("adj");
    expect(KNOWN_POS).toContain("idiom");
    expect(KNOWN_POS).toContain("proverb");
  });
});
