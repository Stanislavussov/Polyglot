/**
 * Tests for createContextLookup factory.
 *
 * Verifies:
 * - Factory returns a function
 * - Function calls findByWordAndLangCode and transforms result
 * - No results → returns undefined
 * - Repository throws → returns undefined (fail-open)
 * - Null glosses/formTags handled gracefully
 * - Uses first result when multiple entries returned
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the word-context repository ──────────────────────────

const { mockFindByWordAndLangCode } = vi.hoisted(() => ({
  mockFindByWordAndLangCode: vi.fn(),
}));

vi.mock("../repositories/word-context.repository.js", () => ({
  wordContextRepository: {
    findByWordAndLangCode: mockFindByWordAndLangCode,
  },
}));

import { createContextLookup } from "../context-lookup.js";

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

describe("createContextLookup", () => {
  it("returns a function", () => {
    const lookup = createContextLookup();
    expect(typeof lookup).toBe("function");
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

    expect(result).toEqual({
      word: "что ли",
      pos: "phrase",
      glosses: ["or something", "perhaps"],
      formTags: ["canonical"],
      langCode: "ru",
    });
  });

  it("returns undefined when no results found", async () => {
    mockFindByWordAndLangCode.mockResolvedValue([]);

    const lookup = createContextLookup();
    const result = await lookup("unknown", "en");

    expect(result).toBeUndefined();
  });

  it("returns undefined when repository throws (fail-open)", async () => {
    mockFindByWordAndLangCode.mockRejectedValue(
      new Error("DB connection failed"),
    );

    const lookup = createContextLookup();
    const result = await lookup("hello", "en");

    expect(result).toBeUndefined();
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

    expect(result).toEqual({
      word: "test",
      pos: "noun",
      glosses: [],
      formTags: [],
      langCode: "en",
    });
  });

  it("uses the first result when multiple entries returned", async () => {
    mockFindByWordAndLangCode.mockResolvedValue([
      {
        id: 1,
        word: "bank",
        languageId: 1,
        pos: "noun",
        formTags: ["canonical"],
        glosses: ["financial institution"],
        createdAt: new Date(),
      },
      {
        id: 2,
        word: "bank",
        languageId: 1,
        pos: "noun",
        formTags: ["canonical"],
        glosses: ["riverbank"],
        createdAt: new Date(),
      },
    ]);

    const lookup = createContextLookup();
    const result = await lookup("bank", "en");

    expect(result?.glosses).toEqual(["financial institution"]);
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

    expect(result?.langCode).toBe("es");
  });
});
