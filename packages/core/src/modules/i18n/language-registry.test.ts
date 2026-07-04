import { describe, expect, it } from "vitest";
import {
  getAllLanguageEntries,
  getLangDisplay,
  getLanguageEntry,
  getLanguageName,
  getSupportedLanguages,
  initLanguageRegistry,
  isRegistryInitialized,
  normalizeToIso1,
} from "./language-registry.js";

// Vitest isolates this module per file, so re-initializing the registry here
// does not affect other test files (each gets its own registry instance).
describe("language registry (T21/A3 single source of truth)", () => {
  it("normalizes a partial entry to the canonical CachedLanguage shape", () => {
    initLanguageRegistry([{ code: "xx", name: "Xhosa-ish", isSupported: true }]);

    // Missing id/nativeName/flag/localizedNames are filled — the getters (and the
    // adapter-db delegators that return CachedLanguage) can rely on the shape.
    expect(getLanguageEntry("xx")).toEqual({
      id: 0,
      code: "xx",
      name: "Xhosa-ish",
      nativeName: null,
      flag: null,
      isSupported: true,
      localizedNames: null,
    });
  });

  it("keeps the DB id when supplied (used as FK lang id by the bot)", () => {
    initLanguageRegistry([{ id: 42, code: "de", name: "German", isSupported: true }]);
    expect(getLanguageEntry("de")?.id).toBe(42);
  });

  it("reports initialized and exposes all entries", () => {
    initLanguageRegistry([
      { id: 1, code: "en", name: "English", isSupported: true },
      { id: 2, code: "ru", name: "Russian", isSupported: false },
    ]);

    expect(isRegistryInitialized()).toBe(true);
    expect(
      getAllLanguageEntries()
        .map((l) => l.code)
        .sort(),
    ).toEqual(["en", "ru"]);
    expect(getSupportedLanguages().map((l) => l.code)).toEqual(["en"]); // ru not supported
  });

  it("localizes names, builds display strings, and normalizes identifiers", () => {
    initLanguageRegistry([
      {
        id: 1,
        code: "en",
        name: "English",
        nativeName: "English",
        flag: "🇬🇧",
        isSupported: true,
        localizedNames: { ru: "Английский" },
      },
    ]);

    expect(getLanguageName("en", "ru")).toBe("Английский");
    expect(getLanguageName("en")).toBe("English");
    expect(getLangDisplay("en")).toBe("🇬🇧 English");
    expect(normalizeToIso1("English")).toBe("en"); // English name → iso1
    expect(normalizeToIso1("EN")).toBe("en"); // case-insensitive passthrough
    expect(normalizeToIso1("klingon")).toBeUndefined();
  });
});
