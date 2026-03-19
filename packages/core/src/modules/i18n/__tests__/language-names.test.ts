import { describe, it, expect } from "vitest";
import {
  getLanguageName,
  getLanguageNativeName,
  getAllLanguageNames,
  isKnownLanguage,
} from "../language-names.js";

describe("language-names — getLanguageName()", () => {
  it("returns English name by default", () => {
    expect(getLanguageName("ru")).toBe("Russian");
    expect(getLanguageName("en")).toBe("English");
    expect(getLanguageName("de")).toBe("German");
  });

  it("returns English name when displayLang is 'en'", () => {
    expect(getLanguageName("ru", "en")).toBe("Russian");
    expect(getLanguageName("fr", "en")).toBe("French");
  });

  it("returns localized name for Russian display language", () => {
    expect(getLanguageName("en", "ru")).toBe("Английский");
    expect(getLanguageName("de", "ru")).toBe("Немецкий");
    expect(getLanguageName("fr", "ru")).toBe("Французский");
    expect(getLanguageName("ru", "ru")).toBe("Русский");
  });

  it("returns localized name for Czech display language", () => {
    expect(getLanguageName("en", "cs")).toBe("Angličtina");
    expect(getLanguageName("de", "cs")).toBe("Němčina");
    expect(getLanguageName("ru", "cs")).toBe("Ruština");
  });

  it("falls back to English when displayLang has no localization for code", () => {
    // "af" (Afrikaans) has no Russian localization
    expect(getLanguageName("af", "ru")).toBe("Afrikaans");
  });

  it("falls back to English when displayLang has no localization map", () => {
    // "de" has no localized names map
    expect(getLanguageName("ru", "de")).toBe("Russian");
  });

  it("returns code itself for unknown language codes", () => {
    expect(getLanguageName("xx")).toBe("xx");
    expect(getLanguageName("zzz")).toBe("zzz");
    expect(getLanguageName("")).toBe("");
  });

  it("returns code for unknown code even with displayLang", () => {
    expect(getLanguageName("xx", "ru")).toBe("xx");
  });

  it("handles Wiktionary source languages", () => {
    expect(getLanguageName("ja")).toBe("Japanese");
    expect(getLanguageName("zh")).toBe("Chinese");
    expect(getLanguageName("ko")).toBe("Korean");
    expect(getLanguageName("ar")).toBe("Arabic");
    expect(getLanguageName("nl")).toBe("Dutch");
    expect(getLanguageName("la")).toBe("Latin");
  });
});

describe("language-names — getLanguageNativeName()", () => {
  it("returns native name for known languages", () => {
    expect(getLanguageNativeName("ru")).toBe("Русский");
    expect(getLanguageNativeName("de")).toBe("Deutsch");
    expect(getLanguageNativeName("fr")).toBe("Français");
    expect(getLanguageNativeName("cs")).toBe("Čeština");
    expect(getLanguageNativeName("ja")).toBe("日本語");
    expect(getLanguageNativeName("zh")).toBe("中文");
    expect(getLanguageNativeName("ko")).toBe("한국어");
    expect(getLanguageNativeName("ar")).toBe("العربية");
  });

  it("returns English name for English code", () => {
    expect(getLanguageNativeName("en")).toBe("English");
  });

  it("falls back to English name when no native name exists", () => {
    // If a code has English but no native name, return English
    // (shouldn't happen for our data but tests the fallback)
    expect(getLanguageNativeName("xx")).toBe("xx");
  });

  it("returns code for completely unknown languages", () => {
    expect(getLanguageNativeName("zzz")).toBe("zzz");
    expect(getLanguageNativeName("")).toBe("");
  });
});

describe("language-names — getAllLanguageNames()", () => {
  it("returns an array of { code, name } objects", () => {
    const all = getAllLanguageNames();
    expect(Array.isArray(all)).toBe(true);
    expect(all.length).toBeGreaterThan(10);

    // Check structure
    for (const entry of all) {
      expect(entry).toHaveProperty("code");
      expect(entry).toHaveProperty("name");
      expect(typeof entry.code).toBe("string");
      expect(typeof entry.name).toBe("string");
      expect(entry.code.length).toBeGreaterThan(0);
      expect(entry.name.length).toBeGreaterThan(0);
    }
  });

  it("includes all SupportedLang codes", () => {
    const all = getAllLanguageNames();
    const codes = new Set(all.map((e) => e.code));
    const supportedCodes = ["en", "ru", "cs", "de", "fr", "es", "it", "pt", "uk", "pl"];
    for (const code of supportedCodes) {
      expect(codes.has(code)).toBe(true);
    }
  });

  it("includes Wiktionary source languages", () => {
    const all = getAllLanguageNames();
    const codes = new Set(all.map((e) => e.code));
    expect(codes.has("ja")).toBe(true);
    expect(codes.has("zh")).toBe(true);
    expect(codes.has("la")).toBe(true);
  });

  it("returns English names", () => {
    const all = getAllLanguageNames();
    const ru = all.find((e) => e.code === "ru");
    expect(ru?.name).toBe("Russian");
    const de = all.find((e) => e.code === "de");
    expect(de?.name).toBe("German");
  });
});

describe("language-names — isKnownLanguage()", () => {
  it("returns true for known language codes", () => {
    expect(isKnownLanguage("en")).toBe(true);
    expect(isKnownLanguage("ru")).toBe(true);
    expect(isKnownLanguage("ja")).toBe(true);
    expect(isKnownLanguage("la")).toBe(true);
  });

  it("returns false for unknown codes", () => {
    expect(isKnownLanguage("xx")).toBe(false);
    expect(isKnownLanguage("zzz")).toBe(false);
    expect(isKnownLanguage("")).toBe(false);
  });
});
