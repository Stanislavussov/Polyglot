import { describe, expect, it } from "vitest";
import { findLettersOutsideAlphabet, getAlphabet } from "../alphabets.js";

describe("getAlphabet", () => {
  it("returns undefined for unknown languages", () => {
    expect(getAlphabet("xx")).toBeUndefined();
  });

  it("contains language-specific letters", () => {
    expect(getAlphabet("cs")?.has("ř")).toBe(true);
    expect(getAlphabet("de")?.has("ß")).toBe(true);
    expect(getAlphabet("uk")?.has("і")).toBe(true);
    expect(getAlphabet("kk")?.has("ә")).toBe(true);
  });
});

describe("findLettersOutsideAlphabet", () => {
  it("reports á as outside the English alphabet", () => {
    expect(findLettersOutsideAlphabet("Strohá", "en")).toEqual(["á"]);
  });

  it("is case-insensitive", () => {
    expect(findLettersOutsideAlphabet("STROHÁ", "en")).toEqual(["á"]);
  });

  it("accepts á inside Czech, Spanish and Portuguese alphabets", () => {
    expect(findLettersOutsideAlphabet("strohá", "cs")).toEqual([]);
    expect(findLettersOutsideAlphabet("strohá", "es")).toEqual([]);
    expect(findLettersOutsideAlphabet("strohá", "pt")).toEqual([]);
  });

  it("ignores digits, apostrophes, hyphens and punctuation", () => {
    expect(findLettersOutsideAlphabet("don't check-in 42!", "en")).toEqual([]);
  });

  it("reports Ukrainian-only letters as outside Russian", () => {
    expect(findLettersOutsideAlphabet("привіт", "ru")).toEqual(["і"]);
  });

  it("accepts Russian letters inside the Kazakh superset alphabet", () => {
    expect(findLettersOutsideAlphabet("привет", "kk")).toEqual([]);
  });

  it("returns empty for unknown languages (no negative evidence)", () => {
    expect(findLettersOutsideAlphabet("žščř", "xx")).toEqual([]);
  });

  it("normalizes NFD input to NFC before checking", () => {
    const nfd = "Stroha\u0301"; // a + combining acute accent (NFD)
    expect(findLettersOutsideAlphabet(nfd, "en")).toEqual(["á"]);
    expect(findLettersOutsideAlphabet(nfd, "cs")).toEqual([]);
  });
});
