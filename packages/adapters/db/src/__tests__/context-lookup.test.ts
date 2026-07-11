/**
 * Tests for createContextLookup factory.
 *
 * Verifies:
 * - Factory returns a function
 * - Function calls findByWordAndLangCode and transforms result
 * - No results → returns an empty candidate array
 * - Repository throws → returns an empty candidate array (fail-open)
 * - Null glosses/formTags handled gracefully
 * - Uses first result when multiple entries returned
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock the word-context repository ──────────────────────────

const { mockFindByWordAndLangCode, mockRecordLookup } = vi.hoisted(() => ({
  mockFindByWordAndLangCode: vi.fn(),
  mockRecordLookup: vi.fn(),
}));

vi.mock("../repositories/word-context.repository.js", () => ({
  wordContextRepository: {
    findByWordAndLangCode: mockFindByWordAndLangCode,
  },
}));

vi.mock("../repositories/dictionary-lookup-log.repository.js", () => ({
  dictionaryLookupLogRepository: {
    record: mockRecordLookup,
  },
}));

import { createContextLookup } from "../context-lookup.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockRecordLookup.mockResolvedValue(undefined);
});

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

describe("createContextLookup", () => {
  it("returns a function", () => {
    const lookup = createContextLookup();
    expect(typeof lookup).toBe("function");
  });

  it("normalizes Unicode, case, and whitespace before repository lookup", async () => {
    mockFindByWordAndLangCode.mockResolvedValue([]);
    const lookup = createContextLookup();

    await lookup("  CAFÉ   AU  LAIT  ".normalize("NFD"), "fr");

    expect(mockFindByWordAndLangCode).toHaveBeenCalledWith("café au lait", "fr");
  });

  it("returned function calls findByWordAndLangCode with correct args", async () => {
    mockFindByWordAndLangCode.mockResolvedValue([]);
    const lookup = createContextLookup();

    await lookup("apple", "en");

    expect(mockFindByWordAndLangCode).toHaveBeenCalledWith("apple", "en");
    expect(mockFindByWordAndLangCode).toHaveBeenCalledTimes(1);
  });

  it("transforms DB result to DictionaryContext", async () => {
    mockFindByWordAndLangCode.mockResolvedValue([
      {
        id: 1,
        word: "что ли",
        languageId: 1,
        pos: "phrase",
        formTags: ["canonical"],
        glosses: ["or something", "perhaps"],
        createdAt: new Date(),
      },
    ]);

    const lookup = createContextLookup();
    const result = await lookup("что ли", "ru");

    expect(result).toEqual([
      {
        matchType: "exact_expression",
        context: {
          word: "что ли",
          pos: "phrase",
          glosses: ["or something", "perhaps"],
          formTags: ["canonical"],
          langCode: "ru",
        },
      },
    ]);
  });

  it("returns an empty array when no results found", async () => {
    mockFindByWordAndLangCode.mockResolvedValue([]);

    const lookup = createContextLookup();
    const result = await lookup("unknown", "en");

    expect(result).toEqual([]);
  });

  it("records a no-match lookup audit log", async () => {
    mockFindByWordAndLangCode.mockResolvedValue([]);

    const lookup = createContextLookup();
    await lookup("Unknown", "en");

    expect(mockRecordLookup).toHaveBeenCalledWith({
      lookupInput: "Unknown",
      normalizedInput: "unknown",
      langCode: "en",
      matched: false,
      matchCount: 0,
      matchedWord: undefined,
      matchType: undefined,
      matchedPos: undefined,
      matchedGlosses: undefined,
      error: undefined,
    });
  });

  it("returns an empty array when repository throws (fail-open)", async () => {
    mockFindByWordAndLangCode.mockRejectedValue(new Error("DB connection failed"));

    const lookup = createContextLookup();
    const result = await lookup("hello", "en");

    expect(result).toEqual([]);
    expect(mockRecordLookup).toHaveBeenCalledWith({
      lookupInput: "hello",
      normalizedInput: "hello",
      langCode: "en",
      matched: false,
      matchCount: 0,
      matchedWord: undefined,
      matchType: undefined,
      matchedPos: undefined,
      matchedGlosses: undefined,
      error: "DB connection failed",
    });
  });

  it("handles null glosses and formTags gracefully", async () => {
    mockFindByWordAndLangCode.mockResolvedValue([
      {
        id: 1,
        word: "test",
        languageId: 1,
        pos: "noun",
        formTags: null,
        glosses: null,
        createdAt: new Date(),
      },
    ]);

    const lookup = createContextLookup();
    const result = await lookup("test", "en");

    expect(result).toEqual([
      {
        matchType: "lemma",
        context: {
          word: "test",
          pos: "noun",
          glosses: [],
          formTags: [],
          langCode: "en",
        },
      },
    ]);
  });

  it("identifies a candidate matched through a known form", async () => {
    mockFindByWordAndLangCode.mockResolvedValue([
      {
        id: 1,
        word: "run",
        forms: ["ran", "running"],
        languageId: 1,
        pos: "verb",
        formTags: ["canonical"],
        glosses: ["move quickly"],
        createdAt: new Date(),
      },
    ]);

    const lookup = createContextLookup();
    const result = await lookup("RAN", "en");

    expect(result).toEqual([
      {
        matchType: "known_form",
        context: {
          word: "run",
          pos: "verb",
          glosses: ["move quickly"],
          formTags: ["canonical"],
          langCode: "en",
        },
      },
    ]);
    expect(mockRecordLookup).toHaveBeenCalledWith({
      lookupInput: "RAN",
      normalizedInput: "ran",
      langCode: "en",
      matched: true,
      matchCount: 1,
      matchedWord: "run",
      matchType: "known_form",
      matchedPos: "verb",
      matchedGlosses: ["move quickly"],
      error: undefined,
    });
  });

  it("returns all senses in deterministic candidate order", async () => {
    mockFindByWordAndLangCode.mockResolvedValue([
      {
        id: 2,
        word: "bank",
        languageId: 1,
        pos: "verb",
        formTags: ["canonical"],
        glosses: ["to tilt"],
        createdAt: new Date(),
      },
      {
        id: 1,
        word: "bank",
        languageId: 1,
        pos: "noun",
        formTags: ["canonical"],
        glosses: ["financial institution"],
        createdAt: new Date(),
      },
    ]);

    const lookup = createContextLookup();
    const result = await lookup("bank", "en");

    expect(result).toEqual([
      {
        matchType: "lemma",
        context: {
          word: "bank",
          pos: "noun",
          glosses: ["financial institution"],
          formTags: ["canonical"],
          langCode: "en",
        },
      },
      {
        matchType: "lemma",
        context: {
          word: "bank",
          pos: "verb",
          glosses: ["to tilt"],
          formTags: ["canonical"],
          langCode: "en",
        },
      },
    ]);
  });

  it("each call to factory returns an independent function", () => {
    const lookup1 = createContextLookup();
    const lookup2 = createContextLookup();

    expect(lookup1).not.toBe(lookup2);
    expect(typeof lookup1).toBe("function");
    expect(typeof lookup2).toBe("function");
  });

  it("sets langCode from the argument, not from DB entry", async () => {
    mockFindByWordAndLangCode.mockResolvedValue([
      {
        id: 1,
        word: "hola",
        languageId: 5,
        pos: "interjection",
        formTags: [],
        glosses: ["hello"],
        createdAt: new Date(),
      },
    ]);

    const lookup = createContextLookup();
    const result = await lookup("hola", "es");

    expect(result[0]?.context.langCode).toBe("es");
  });

  it("drops an all-caps initialism headword for a lowercase input (no acronym hijack)", async () => {
    // Regression: "tow" (буксировать) must not match the Friends-episode acronym
    // "TOW", which is the only word_context row for lower('tow').
    mockFindByWordAndLangCode.mockResolvedValue([
      {
        id: 1,
        word: "TOW",
        languageId: 1,
        pos: "phrase",
        formTags: [],
        glosses: ["Initialism of The One With ...: episodes of Friends"],
        createdAt: new Date(),
      },
    ]);

    const lookup = createContextLookup();
    const result = await lookup("tow", "en");

    expect(result).toEqual([]);
  });

  it("keeps an all-caps initialism when the user typed the input in all-caps", async () => {
    mockFindByWordAndLangCode.mockResolvedValue([
      {
        id: 1,
        word: "TOW",
        languageId: 1,
        pos: "phrase",
        formTags: [],
        glosses: ["Initialism of The One With ...: episodes of Friends"],
        createdAt: new Date(),
      },
    ]);

    const lookup = createContextLookup();
    const result = await lookup("TOW", "en");

    expect(result).toHaveLength(1);
    expect(result[0]?.context.word).toBe("TOW");
  });

  it("keeps a normal headword and drops only the colliding acronym for a lowercase input", async () => {
    mockFindByWordAndLangCode.mockResolvedValue([
      {
        id: 1,
        word: "us",
        languageId: 1,
        pos: "pronoun",
        formTags: [],
        glosses: ["objective case of we"],
        createdAt: new Date(),
      },
      {
        id: 2,
        word: "US",
        languageId: 1,
        pos: "noun",
        formTags: [],
        glosses: ["United States"],
        createdAt: new Date(),
      },
    ]);

    const lookup = createContextLookup();
    const result = await lookup("us", "en");

    expect(result).toHaveLength(1);
    expect(result[0]?.context.word).toBe("us");
  });

  it("does not fail lookup when audit logging fails", async () => {
    mockFindByWordAndLangCode.mockResolvedValue([
      {
        id: 1,
        word: "apple",
        languageId: 1,
        pos: "noun",
        formTags: [],
        glosses: ["fruit"],
        createdAt: new Date(),
      },
    ]);
    mockRecordLookup.mockRejectedValue(new Error("log table unavailable"));

    const lookup = createContextLookup();
    const result = await lookup("apple", "en");

    expect(result).toHaveLength(1);
    expect(result[0]?.context.word).toBe("apple");
  });
});
