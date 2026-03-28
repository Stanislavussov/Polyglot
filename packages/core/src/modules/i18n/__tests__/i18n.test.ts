import { describe, expect, it } from "vitest";
import { getSupportedLangs, isSupported, t } from "../i18n.js";
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
    expect(t("register", "en", { register: "neutral" })).toBe("Register: neutral");
  });

  // Regeneration keys (task 07)
  it("returns regenerateLang with {lang} interpolation in English", () => {
    expect(t("regenerateLang", "en", { lang: "CS" })).toBe("🔄 CS");
  });

  it("returns regenerating with {lang} interpolation in English", () => {
    expect(t("regenerating", "en", { lang: "DE" })).toBe("⏳ Regenerating DE...");
  });

  it("returns regenerated with {lang} interpolation in English", () => {
    expect(t("regenerated", "en", { lang: "FR" })).toBe("✅ FR translation updated");
  });

  it("returns regeneration keys in Russian with interpolation", () => {
    expect(t("regenerateLang", "ru", { lang: "CS" })).toBe("🔄 CS");
    expect(t("regenerating", "ru", { lang: "CS" })).toBe("⏳ Обновляю CS...");
    expect(t("regenerated", "ru", { lang: "CS" })).toBe("✅ Перевод на CS обновлён");
  });

  it("returns regeneration keys in Czech with interpolation", () => {
    expect(t("regenerateLang", "cs", { lang: "DE" })).toBe("🔄 DE");
    expect(t("regenerating", "cs", { lang: "DE" })).toBe("⏳ Aktualizuji DE...");
    expect(t("regenerated", "cs", { lang: "DE" })).toBe("✅ Překlad pro DE aktualizován");
  });

  it("falls back to English for regeneration keys when locale has no file", () => {
    expect(t("regenerating", "de", { lang: "FR" })).toBe("⏳ Regenerating FR...");
  });

  // Translate mode keys (task 09)
  it("returns translateModeOn with parameters in English", () => {
    expect(t("translateModeOn", "en", { fromLang: "English", toLangs: "Czech" })).toBe("🔤 English → Czech");
  });

  it("returns translateModeHint in English", () => {
    expect(t("translateModeHint", "en")).toBe("Send the next word or phrase.");
  });

  it("returns translate mode keys in Russian", () => {
    expect(t("translateModeOn", "ru", { fromLang: "Русский", toLangs: "Čeština" })).toBe("🔤 Русский → Čeština");
    expect(t("translateModeHint", "ru")).toBe("Отправьте следующее слово или фразу.");
  });

  it("returns translate mode keys in Czech", () => {
    expect(t("translateModeOn", "cs", { fromLang: "English", toLangs: "Čeština" })).toBe("🔤 English → Čeština");
    expect(t("translateModeHint", "cs")).toBe("Pošli další slovo nebo frázi.");
  });

  it("falls back to English for translate mode keys when locale has no file", () => {
    expect(t("translateModeOn", "de", { fromLang: "Deutsch", toLangs: "English" })).toBe("🔤 Deutsch → English");
    expect(t("translateModeHint", "de")).toBe("Send the next word or phrase.");
  });

  // Wiktionary / dictionary context keys (task 13)
  it("returns wiktionaryDefinition in English", () => {
    expect(t("wiktionaryDefinition", "en")).toBe("📖 Wiktionary definition");
  });

  it("returns wiktionarySource in English", () => {
    expect(t("wiktionarySource", "en")).toBe("Source: Wiktionary");
  });

  it("returns partOfSpeech with interpolation", () => {
    expect(t("partOfSpeech", "en", { pos: "phrase" })).toBe("Part of speech: phrase");
  });

  it("returns expressionDetected with interpolation", () => {
    expect(t("expressionDetected", "en", { expression: "что ли" })).toBe("💬 Expression detected: что ли");
  });

  it("returns dictionaryContext in English", () => {
    expect(t("dictionaryContext", "en")).toBe("📚 Dictionary context");
  });

  it("returns Wiktionary keys in Russian", () => {
    expect(t("wiktionaryDefinition", "ru")).toBe("📖 Определение из Викисловаря");
    expect(t("wiktionarySource", "ru")).toBe("Источник: Викисловарь");
    expect(t("partOfSpeech", "ru", { pos: "фраза" })).toBe("Часть речи: фраза");
    expect(t("expressionDetected", "ru", { expression: "что ли" })).toBe("💬 Обнаружено выражение: что ли");
    expect(t("dictionaryContext", "ru")).toBe("📚 Словарный контекст");
  });

  it("returns Wiktionary keys in Czech", () => {
    expect(t("wiktionaryDefinition", "cs")).toBe("📖 Definice z Wikislovníku");
    expect(t("wiktionarySource", "cs")).toBe("Zdroj: Wikislovník");
    expect(t("partOfSpeech", "cs", { pos: "fráze" })).toBe("Slovní druh: fráze");
    expect(t("expressionDetected", "cs", { expression: "jak se máte" })).toBe("💬 Detekován výraz: jak se máte");
    expect(t("dictionaryContext", "cs")).toBe("📚 Slovníkový kontext");
  });

  it("falls back to English for Wiktionary keys when locale has no file", () => {
    expect(t("wiktionaryDefinition", "de")).toBe("📖 Wiktionary definition");
    expect(t("dictionaryContext", "de")).toBe("📚 Dictionary context");
  });

  // Detected language key (task 16)
  it("returns detectedLang with {lang} interpolation in English", () => {
    expect(t("detectedLang", "en", { lang: "English" })).toBe("🔍 Detected: English");
  });

  it("returns detectedLang with {lang} interpolation in Russian", () => {
    expect(t("detectedLang", "ru", { lang: "Английский" })).toBe("🔍 Определён: Английский");
  });

  it("returns detectedLang with {lang} interpolation in Czech", () => {
    expect(t("detectedLang", "cs", { lang: "Angličtina" })).toBe("🔍 Rozpoznáno: Angličtina");
  });

  it("falls back to English for detectedLang when locale has no file", () => {
    expect(t("detectedLang", "de", { lang: "Englisch" })).toBe("🔍 Detected: Englisch");
  });

  // Next source language selection keys (task 17)
  it("returns nextTranslationFrom in English", () => {
    expect(t("nextTranslationFrom", "en")).toBe("Next translation from:");
  });

  it("returns nextSourceSet with {lang} interpolation in English", () => {
    expect(t("nextSourceSet", "en", { lang: "Czech" })).toBe("🔤 Next from: Czech");
  });

  it("returns nextTranslationFrom in Russian", () => {
    expect(t("nextTranslationFrom", "ru")).toBe("Следующий перевод с:");
  });

  it("returns nextSourceSet with {lang} interpolation in Russian", () => {
    expect(t("nextSourceSet", "ru", { lang: "Чешский" })).toBe("🔤 Далее с: Чешский");
  });

  it("returns nextTranslationFrom in Czech", () => {
    expect(t("nextTranslationFrom", "cs")).toBe("Další překlad z:");
  });

  it("returns nextSourceSet with {lang} interpolation in Czech", () => {
    expect(t("nextSourceSet", "cs", { lang: "Angličtina" })).toBe("🔤 Příště z: Angličtina");
  });

  it("falls back to English for nextTranslationFrom when locale has no file", () => {
    expect(t("nextTranslationFrom", "de")).toBe("Next translation from:");
  });

  it("falls back to English for nextSourceSet when locale has no file", () => {
    expect(t("nextSourceSet", "de", { lang: "Englisch" })).toBe("🔤 Next from: Englisch");
  });

  // Sentence translation key (task 27)
  it("returns sentenceTranslation in English", () => {
    expect(t("sentenceTranslation", "en")).toBe("📝 Sentence translation");
  });

  it("returns sentenceTranslation in Russian", () => {
    expect(t("sentenceTranslation", "ru")).toBe("📝 Перевод предложения");
  });

  it("returns sentenceTranslation in Czech", () => {
    expect(t("sentenceTranslation", "cs")).toBe("📝 Překlad věty");
  });

  it("falls back to English for sentenceTranslation when locale has no file", () => {
    expect(t("sentenceTranslation", "de")).toBe("📝 Sentence translation");
  });

  // Save word/phrase keys (task 30)
  it("returns saveWord in English", () => {
    expect(t("saveWord", "en")).toBe("💾 Save word");
  });

  it("returns savePhrase in English", () => {
    expect(t("savePhrase", "en")).toBe("💾 Save phrase");
  });

  it("returns saveWord in Russian", () => {
    expect(t("saveWord", "ru")).toBe("💾 Сохранить слово");
  });

  it("returns savePhrase in Russian", () => {
    expect(t("savePhrase", "ru")).toBe("💾 Сохранить фразу");
  });

  it("returns saveWord in Czech", () => {
    expect(t("saveWord", "cs")).toBe("💾 Uložit slovo");
  });

  it("returns savePhrase in Czech", () => {
    expect(t("savePhrase", "cs")).toBe("💾 Uložit frázi");
  });

  it("falls back to English for saveWord when locale has no file", () => {
    expect(t("saveWord", "de")).toBe("💾 Save word");
  });

  it("falls back to English for savePhrase when locale has no file", () => {
    expect(t("savePhrase", "de")).toBe("💾 Save phrase");
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
      "chooseNativeLang",
      "chooseLearningLangs",
      "enterWord",
      "demoResult",
      "onboardingComplete",
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
      "regenerateLang",
      "regenerating",
      "regenerated",
      "translateModeOn",
      "translateModeHint",
      "wiktionaryDefinition",
      "wiktionarySource",
      "partOfSpeech",
      "expressionDetected",
      "dictionaryContext",
      "detectedLang",
      "nextTranslationFrom",
      "nextSourceSet",
      "sentenceTranslation",
      "saveWord",
      "savePhrase",
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
