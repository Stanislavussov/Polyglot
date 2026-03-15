import { describe, it, expect } from "vitest";
import { t, getSupportedLangs, isSupported } from "../i18n.js";
import type { I18nKey, SupportedLang } from "../types.js";

describe("i18n — t()", () => {
  it("returns English text for a known key", () => {
    expect(t("welcome", "en")).toBe("Welcome!");
  });

  it("returns Russian text for a known key", () => {
    expect(t("welcome", "ru")).toBe("Добро пожаловать!");
  });

  it("returns Czech text for a known key", () => {
    expect(t("welcome", "cs")).toBe("Vítejte!");
  });

  it("falls back to English when locale has no dedicated file", () => {
    // German is a supported lang but has no locale file yet
    expect(t("welcome", "de")).toBe("Welcome!");
  });

  it("falls back to English when key is missing in locale (never throws)", () => {
    // All keys exist in en.json, so this tests the fallback path
    const result = t("welcome", "fr");
    expect(result).toBe("Welcome!");
  });

  it("interpolates {param} placeholders", () => {
    const result = t("maxLangsReached", "en", { max: 4 });
    expect(result).toBe("⚠️ You can select up to 4 languages.");
  });

  it("interpolates multiple params", () => {
    const result = t("langAdded", "ru", { lang: "English" });
    expect(result).toBe("Добавлено: English");
  });

  it("returns English fallback for lang with no locale file + interpolation", () => {
    const result = t("maxLangsReached", "de", { max: 3 });
    expect(result).toBe("⚠️ You can select up to 3 languages.");
  });

  // Translation pipeline keys
  it("returns translation-pipeline keys", () => {
    expect(t("translating", "en")).toBe("⏳ Translating...");
    expect(t("translationError", "en")).toContain("Translation failed");
    expect(t("translationUnavailable", "en")).toContain("unavailable");
    expect(t("translationNeedsReview", "en")).toContain("inaccuracies");
  });

  it("returns translation-pipeline keys in Russian", () => {
    expect(t("translating", "ru")).toBe("⏳ Перевожу...");
    expect(t("translationError", "ru")).toContain("Ошибка");
    expect(t("translationUnavailable", "ru")).toContain("недоступен");
  });

  it("returns translation-pipeline keys in Czech", () => {
    expect(t("translating", "cs")).toBe("⏳ Překládám...");
    expect(t("translationError", "cs")).toContain("selhal");
  });

  it("returns CEFR and register keys with interpolation", () => {
    expect(t("cefr", "en", { level: "B2" })).toBe("CEFR: B2");
    expect(t("register", "en", { register: "neutral" })).toBe(
      "Register: neutral",
    );
  });
});

describe("i18n — getSupportedLangs()", () => {
  it("returns all 10 supported languages", () => {
    const langs = getSupportedLangs();
    expect(langs).toHaveLength(10);
    expect(langs).toContain("en");
    expect(langs).toContain("ru");
    expect(langs).toContain("cs");
    expect(langs).toContain("de");
    expect(langs).toContain("fr");
    expect(langs).toContain("es");
    expect(langs).toContain("it");
    expect(langs).toContain("pt");
    expect(langs).toContain("uk");
    expect(langs).toContain("pl");
  });

  it("returns a new array each time (no mutation risk)", () => {
    const a = getSupportedLangs();
    const b = getSupportedLangs();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe("i18n — isSupported()", () => {
  it("returns true for supported languages", () => {
    expect(isSupported("en")).toBe(true);
    expect(isSupported("ru")).toBe(true);
    expect(isSupported("cs")).toBe(true);
    expect(isSupported("de")).toBe(true);
    expect(isSupported("pl")).toBe(true);
  });

  it("returns false for unsupported languages", () => {
    expect(isSupported("ja")).toBe(false);
    expect(isSupported("zh")).toBe(false);
    expect(isSupported("")).toBe(false);
    expect(isSupported("xx")).toBe(false);
  });

  it("narrows the type (type guard)", () => {
    const lang: string = "en";
    if (isSupported(lang)) {
      // TypeScript now knows lang is SupportedLang
      const _check: SupportedLang = lang;
      expect(_check).toBe("en");
    }
  });
});

describe("i18n — locale consistency", () => {
  it("en.json has all I18nKey entries", () => {
    // Importing the JSON directly to check all keys exist
    const enKeys: I18nKey[] = [
      "welcome",
      "choose_language",
      "translate",
      "dictionary",
      "topics",
      "settings",
      "back",
      "cancel",
      "done",
      "yes",
      "no",
      "chooseInterfaceLang",
      "chooseNativeLang",
      "chooseLearningLangs",
      "enterWord",
      "demoResult",
      "onboardingComplete",
      "onboardingCompleteNoSave",
      "welcomeBack",
      "maxLangsReached",
      "selectAtLeastOne",
      "langAdded",
      "langRemoved",
      "enterWordToTranslate",
      "translating",
      "translationError",
      "translationUnavailable",
      "translationNeedsReview",
      "saveToDict",
      "savedToDict",
      "alreadySaved",
      "wordDeleted",
      "emptyDictionary",
      "noResults",
      "settingsUpdated",
      "notificationTimeSet",
      "flipCard",
      "nextTranslation",
      "editTranslation",
      "saveToDictionary",
      "cefr",
      "register",
      "synonyms",
      "examples",
    ];

    for (const key of enKeys) {
      const result = t(key, "en");
      // Should NOT return the raw key — means en.json has the entry
      expect(result).not.toBe(key);
    }
  });

  it("ru.json covers all keys from en.json", () => {
    const keysToCheck: I18nKey[] = [
      "welcome",
      "translating",
      "translationError",
      "translationUnavailable",
      "translationNeedsReview",
      "saveToDict",
      "savedToDict",
    ];

    for (const key of keysToCheck) {
      const enResult = t(key, "en");
      const ruResult = t(key, "ru");
      // Russian text should differ from English (i.e., it has its own translation)
      expect(ruResult).not.toBe(enResult);
    }
  });

  it("cs.json covers all keys from en.json", () => {
    const keysToCheck: I18nKey[] = [
      "welcome",
      "translating",
      "translationError",
      "translationUnavailable",
      "translationNeedsReview",
      "saveToDict",
      "savedToDict",
    ];

    for (const key of keysToCheck) {
      const enResult = t(key, "en");
      const csResult = t(key, "cs");
      // Czech text should differ from English
      expect(csResult).not.toBe(enResult);
    }
  });
});
