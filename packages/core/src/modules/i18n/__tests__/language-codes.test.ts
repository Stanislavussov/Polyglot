import { describe, expect, it } from "vitest";
import { normalizeToIso1 } from "../language-registry.js";

// Registry is initialized by test-setup.ts (vitest setupFiles)

// NOTE: getIso1ToIso3Map, getIso3ToIso1Map, resolveToIso3 have been removed.
// ISO 639-3 codes are now a private implementation detail of detect-language.ts.
// The language registry works exclusively with ISO 639-1 codes.

describe("normalizeToIso1", () => {
  it("passes through ISO 639-1 codes", () => {
    expect(normalizeToIso1("en")).toBe("en");
    expect(normalizeToIso1("ru")).toBe("ru");
    expect(normalizeToIso1("cs")).toBe("cs");
  });

  it("converts common English names to ISO 639-1 (case-insensitive)", () => {
    expect(normalizeToIso1("english")).toBe("en");
    expect(normalizeToIso1("Russian")).toBe("ru");
    expect(normalizeToIso1("Czech")).toBe("cs");
    expect(normalizeToIso1("GERMAN")).toBe("de");
  });

  it("returns undefined for unknown identifiers", () => {
    expect(normalizeToIso1("xxx")).toBeUndefined();
    expect(normalizeToIso1("klingon")).toBeUndefined();
  });

  it("no longer resolves ISO 639-3 codes (not in registry)", () => {
    // ISO 639-3 codes like "eng", "rus", "ces" are not registered as ISO 639-1 codes
    // and are not English names, so they should return undefined
    expect(normalizeToIso1("eng")).toBeUndefined();
    expect(normalizeToIso1("rus")).toBeUndefined();
    expect(normalizeToIso1("ces")).toBeUndefined();
  });
});
