/**
 * Tests for createWordLanguageSweep factory.
 *
 * Verifies:
 * - Factory returns a function
 * - Input is NFC-normalized, trimmed and lowercased before the query
 * - Multi-word and empty input short-circuits to [] without a query
 * - Language codes are returned in repository (coverage) order
 * - Repository throws → returns [] (fail-open)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindLanguageCodesByWord } = vi.hoisted(() => ({
  mockFindLanguageCodesByWord: vi.fn(),
}));

vi.mock("../repositories/word-context.repository.js", () => ({
  wordContextRepository: {
    findLanguageCodesByWord: mockFindLanguageCodesByWord,
  },
}));

import { createWordLanguageSweep } from "../word-language-sweep.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createWordLanguageSweep", () => {
  it("returns a function", () => {
    expect(typeof createWordLanguageSweep()).toBe("function");
  });

  it("normalizes Unicode and case before the query", async () => {
    mockFindLanguageCodesByWord.mockResolvedValue([]);
    const sweep = createWordLanguageSweep();

    await sweep("  STROHÁ ".normalize("NFD"));

    expect(mockFindLanguageCodesByWord).toHaveBeenCalledWith("strohá");
  });

  it("returns language codes in repository order", async () => {
    mockFindLanguageCodesByWord.mockResolvedValue([
      { code: "cs", entryCount: 3 },
      { code: "sk", entryCount: 1 },
    ]);
    const sweep = createWordLanguageSweep();

    await expect(sweep("strohá")).resolves.toEqual(["cs", "sk"]);
  });

  it("short-circuits multi-word input without querying", async () => {
    const sweep = createWordLanguageSweep();

    await expect(sweep("dobrý den")).resolves.toEqual([]);
    expect(mockFindLanguageCodesByWord).not.toHaveBeenCalled();
  });

  it("short-circuits empty input without querying", async () => {
    const sweep = createWordLanguageSweep();

    await expect(sweep("   ")).resolves.toEqual([]);
    expect(mockFindLanguageCodesByWord).not.toHaveBeenCalled();
  });

  it("returns [] when the repository throws (fail-open)", async () => {
    mockFindLanguageCodesByWord.mockRejectedValue(new Error("DB connection failed"));
    const sweep = createWordLanguageSweep();

    await expect(sweep("strohá")).resolves.toEqual([]);
  });
});
