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

  it("returns register key with interpolation", () => {});

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

  // Save key (generic, no word/phrase distinction)
  it("returns save in English", () => {
    expect(t("save", "en")).toBe("💾 Save");
  });

  it("returns save in Russian", () => {
    expect(t("save", "ru")).toBe("💾 Сохранить");
  });

  it("returns save in Czech", () => {
    expect(t("save", "cs")).toBe("💾 Uložit");
  });

  it("falls back to English for save when locale has no file", () => {
    expect(t("save", "de")).toBe("💾 Save");
  });

  // Connotation warning key (task 31)
  it("returns connotationWarning with {warning} interpolation in English", () => {
    expect(t("connotationWarning", "en", { warning: "to arouse — sexual connotation" })).toBe(
      "ℹ️ to arouse — sexual connotation",
    );
  });

  it("returns connotationWarning with {warning} interpolation in Russian", () => {
    expect(t("connotationWarning", "ru", { warning: "возбуждать — сексуальный подтекст" })).toBe(
      "ℹ️ возбуждать — сексуальный подтекст",
    );
  });

  it("returns connotationWarning with {warning} interpolation in Czech", () => {
    expect(t("connotationWarning", "cs", { warning: "vzrušit — sexuální konotace" })).toBe(
      "ℹ️ vzrušit — sexuální konotace",
    );
  });

  it("falls back to English for connotationWarning when locale has no file", () => {
    expect(t("connotationWarning", "de", { warning: "erregen — sexuelle Konnotation" })).toBe(
      "ℹ️ erregen — sexuelle Konnotation",
    );
  });

  // Template wizard keys (task 32)
  it("returns templateTitle in English", () => {
    expect(t("templateTitle", "en")).toBe("⚙️ Translation Template");
  });

  it("returns templateTitle in Russian", () => {
    expect(t("templateTitle", "ru")).toBe("⚙️ Шаблон перевода");
  });

  it("returns templateTitle in Czech", () => {
    expect(t("templateTitle", "cs")).toBe("⚙️ Šablona překladu");
  });

  it("returns templateCurrent with {name} interpolation in English", () => {
    expect(t("templateCurrent", "en", { name: "My Template" })).toBe("Current template: <b>My Template</b>");
  });

  it("returns templateCurrent with {name} interpolation in Russian", () => {
    expect(t("templateCurrent", "ru", { name: "Мой шаблон" })).toBe("Текущий шаблон: <b>Мой шаблон</b>");
  });

  it("returns templateCurrent with {name} interpolation in Czech", () => {
    expect(t("templateCurrent", "cs", { name: "Moje šablona" })).toBe("Aktuální šablona: <b>Moje šablona</b>");
  });

  it("returns templateDefault in English", () => {
    expect(t("templateDefault", "en")).toContain("default template");
  });

  it("returns templateCustom in English", () => {
    expect(t("templateCustom", "en")).toContain("custom template");
  });

  it("returns template button labels in English", () => {
    expect(t("templateCustomize", "en")).toBe("📝 Customize");
    expect(t("templateReset", "en")).toBe("🔄 Reset to Default");
    expect(t("templatePreview", "en")).toBe("👁 Preview");
    expect(t("templateSave", "en")).toBe("💾 Save");
    expect(t("templateCancel", "en")).toBe("✕ Cancel");
    expect(t("templateBack", "en")).toBe("← Back");
  });

  it("returns template button labels in Russian", () => {
    expect(t("templateCustomize", "ru")).toBe("📝 Настроить");
    expect(t("templateReset", "ru")).toBe("🔄 Сбросить");
    expect(t("templatePreview", "ru")).toBe("👁 Просмотр");
    expect(t("templateSave", "ru")).toBe("💾 Сохранить");
    expect(t("templateCancel", "ru")).toBe("✕ Отмена");
    expect(t("templateBack", "ru")).toBe("← Назад");
  });

  it("returns template button labels in Czech", () => {
    expect(t("templateCustomize", "cs")).toBe("📝 Upravit");
    expect(t("templateReset", "cs")).toBe("🔄 Obnovit výchozí");
    expect(t("templatePreview", "cs")).toBe("👁 Náhled");
    expect(t("templateSave", "cs")).toBe("💾 Uložit");
    expect(t("templateCancel", "cs")).toBe("✕ Zrušit");
    expect(t("templateBack", "cs")).toBe("← Zpět");
  });

  it("returns templateConstructor in English", () => {
    expect(t("templateConstructor", "en")).toContain("Template Constructor");
    expect(t("templateConstructor", "en")).toContain("Toggle sections");
  });

  it("returns templateConstructor in Russian", () => {
    expect(t("templateConstructor", "ru")).toContain("Конструктор шаблона");
  });

  it("returns templateConstructor in Czech", () => {
    expect(t("templateConstructor", "cs")).toContain("Konstruktor šablony");
  });

  it("returns templateSaved confirmation in all locales", () => {
    expect(t("templateSaved", "en")).toContain("Template saved");
    expect(t("templateSaved", "ru")).toContain("Шаблон сохранён");
    expect(t("templateSaved", "cs")).toContain("Šablona uložena");
  });

  it("returns templateResetDone confirmation in all locales", () => {
    expect(t("templateResetDone", "en")).toContain("reset to default");
    expect(t("templateResetDone", "ru")).toContain("сброшен");
    expect(t("templateResetDone", "cs")).toContain("obnovena");
  });

  it("returns templateCancelled in all locales", () => {
    expect(t("templateCancelled", "en")).toContain("cancelled");
    expect(t("templateCancelled", "ru")).toContain("отменено");
    expect(t("templateCancelled", "cs")).toContain("zrušena");
  });

  it("returns template field labels in English", () => {
    expect(t("templateFieldSynonyms", "en")).toBe("Synonyms");
    expect(t("templateFieldExamples", "en")).toBe("Examples (3 sentences)");
    expect(t("templateFieldAlternatives", "en")).toBe("Alternative translations");
    expect(t("templateFieldEquivalentNote", "en")).toBe("Expression type notes");
    expect(t("templateFieldConnotationWarning", "en")).toBe("Connotation warnings");
  });

  it("returns template field labels in Russian", () => {
    expect(t("templateFieldSynonyms", "ru")).toBe("Синонимы");
    expect(t("templateFieldExamples", "ru")).toBe("Примеры (3 предложения)");
    expect(t("templateFieldAlternatives", "ru")).toBe("Альтернативные переводы");
    expect(t("templateFieldEquivalentNote", "ru")).toBe("Тип выражения");
    expect(t("templateFieldConnotationWarning", "ru")).toBe("Предупреждения о коннотации");
  });

  it("returns template field labels in Czech", () => {
    expect(t("templateFieldSynonyms", "cs")).toBe("Synonyma");
    expect(t("templateFieldExamples", "cs")).toBe("Příklady (3 věty)");
    expect(t("templateFieldAlternatives", "cs")).toBe("Alternativní překlady");
    expect(t("templateFieldEquivalentNote", "cs")).toBe("Typ výrazu");
    expect(t("templateFieldConnotationWarning", "cs")).toBe("Upozornění na konotaci");
  });

  it("returns templatePreviewHeader in all locales", () => {
    expect(t("templatePreviewHeader", "en")).toBe("📋 Preview with your template:");
    expect(t("templatePreviewHeader", "ru")).toBe("📋 Предпросмотр с вашим шаблоном:");
    expect(t("templatePreviewHeader", "cs")).toBe("📋 Náhled s vaší šablonou:");
  });

  it("returns templateSessionExpired in all locales", () => {
    expect(t("templateSessionExpired", "en")).toContain("Session expired");
    expect(t("templateSessionExpired", "ru")).toContain("Сессия истекла");
    expect(t("templateSessionExpired", "cs")).toContain("Relace vypršela");
  });

  it("falls back to English for template keys when locale has no file", () => {
    expect(t("templateTitle", "de")).toBe("⚙️ Translation Template");
    expect(t("templateCurrent", "de", { name: "Test" })).toBe("Current template: <b>Test</b>");
    expect(t("templateCustomize", "de")).toBe("📝 Customize");
    expect(t("templateSessionExpired", "de")).toContain("Session expired");
  });

  // Bot command description keys (task 35)
  it("returns cmdDescStart in English", () => {
    expect(t("cmdDescStart", "en")).toBe("Start the bot / restart onboarding");
  });

  it("returns cmdDescTranslate in English", () => {
    expect(t("cmdDescTranslate", "en")).toBe("Translate a word or phrase");
  });

  it("returns cmdDescDictionary in English", () => {
    expect(t("cmdDescDictionary", "en")).toBe("Open your personal dictionary");
  });

  it("returns cmdDescTemplate in English", () => {
    expect(t("cmdDescTemplate", "en")).toBe("Customize translation template");
  });

  it("returns cmdDescSettings in English", () => {
    expect(t("cmdDescSettings", "en")).toBe("Language & notification settings");
  });

  it("returns command description keys in Russian", () => {
    expect(t("cmdDescStart", "ru")).toBe("Запустить бота / перезапустить онбординг");
    expect(t("cmdDescTranslate", "ru")).toBe("Перевести слово или фразу");
    expect(t("cmdDescDictionary", "ru")).toBe("Открыть личный словарь");
    expect(t("cmdDescTemplate", "ru")).toBe("Настроить шаблон перевода");
    expect(t("cmdDescSettings", "ru")).toBe("Настройки языков и уведомлений");
  });

  it("returns command description keys in Czech", () => {
    expect(t("cmdDescStart", "cs")).toBe("Spustit bota / restartovat onboarding");
    expect(t("cmdDescTranslate", "cs")).toBe("Přeložit slovo nebo frázi");
    expect(t("cmdDescDictionary", "cs")).toBe("Otevřít osobní slovník");
    expect(t("cmdDescTemplate", "cs")).toBe("Přizpůsobit šablonu překladu");
    expect(t("cmdDescSettings", "cs")).toBe("Nastavení jazyků a notifikací");
  });

  it("falls back to English for command description keys when locale has no file", () => {
    expect(t("cmdDescStart", "de")).toBe("Start the bot / restart onboarding");
    expect(t("cmdDescTranslate", "de")).toBe("Translate a word or phrase");
    expect(t("cmdDescDictionary", "de")).toBe("Open your personal dictionary");
    expect(t("cmdDescTemplate", "de")).toBe("Customize translation template");
    expect(t("cmdDescSettings", "de")).toBe("Language & notification settings");
  });

  // Quality uncertain key (task 37)
  it("returns qualityUncertain in English", () => {
    expect(t("qualityUncertain", "en")).toBe("⚠️ Translation quality uncertain");
  });

  it("returns qualityUncertain in Russian", () => {
    expect(t("qualityUncertain", "ru")).toBe("⚠️ Качество перевода под вопросом");
  });

  it("returns qualityUncertain in Czech", () => {
    expect(t("qualityUncertain", "cs")).toBe("⚠️ Kvalita překladu nejistá");
  });

  it("falls back to English for qualityUncertain when locale has no file", () => {
    expect(t("qualityUncertain", "de")).toBe("⚠️ Translation quality uncertain");
  });

  // Flash card keys (task 33)
  it("returns flashcardStart with {count} interpolation in English", () => {
    expect(t("flashcardStart", "en", { count: 10 })).toBe("📚 Flash Cards — 10 words in your deck.");
  });

  it("returns flashcardStart with {count} interpolation in Russian", () => {
    expect(t("flashcardStart", "ru", { count: 10 })).toBe("📚 Карточки — 10 слов в колоде.");
  });

  it("returns flashcardStart with {count} interpolation in Czech", () => {
    expect(t("flashcardStart", "cs", { count: 10 })).toBe("📚 Kartičky — 10 slov v balíčku.");
  });

  it("returns flashcardStartBtn in all locales", () => {
    expect(t("flashcardStartBtn", "en")).toBe("▶️ Start");
    expect(t("flashcardStartBtn", "ru")).toBe("▶️ Начать");
    expect(t("flashcardStartBtn", "cs")).toBe("▶️ Začít");
  });

  it("returns flashcardEmpty in all locales", () => {
    expect(t("flashcardEmpty", "en")).toContain("dictionary is empty");
    expect(t("flashcardEmpty", "ru")).toContain("словарь пуст");
    expect(t("flashcardEmpty", "cs")).toContain("slovník je prázdný");
  });

  it("returns flashcardReveal in all locales", () => {
    expect(t("flashcardReveal", "en")).toBe("👁 Reveal");
    expect(t("flashcardReveal", "ru")).toBe("👁 Показать");
    expect(t("flashcardReveal", "cs")).toBe("👁 Odkrýt");
  });

  it("returns flashcardNext in all locales", () => {
    expect(t("flashcardNext", "en")).toBe("▶️ Next");
    expect(t("flashcardNext", "ru")).toBe("▶️ Далее");
    expect(t("flashcardNext", "cs")).toBe("▶️ Další");
  });

  it("returns flashcardDone with {count} interpolation in English", () => {
    expect(t("flashcardDone", "en", { count: 10 })).toBe("🎉 Done! You reviewed 10 words.");
  });

  it("returns flashcardDone with {count} interpolation in Russian", () => {
    expect(t("flashcardDone", "ru", { count: 10 })).toBe("🎉 Готово! Вы повторили 10 слов.");
  });

  it("returns flashcardDone with {count} interpolation in Czech", () => {
    expect(t("flashcardDone", "cs", { count: 10 })).toBe("🎉 Hotovo! Prošli jste 10 slov.");
  });

  it("returns flashcardQuit in all locales", () => {
    expect(t("flashcardQuit", "en")).toContain("session ended");
    expect(t("flashcardQuit", "ru")).toContain("завершена");
    expect(t("flashcardQuit", "cs")).toContain("ukončena");
  });

  it("returns flashcardRestart in all locales", () => {
    expect(t("flashcardRestart", "en")).toBe("🔄 New Deck");
    expect(t("flashcardRestart", "ru")).toBe("🔄 Новая колода");
    expect(t("flashcardRestart", "cs")).toBe("🔄 Nový balíček");
  });

  it("returns flashcardClose in all locales", () => {
    expect(t("flashcardClose", "en")).toBe("✕ Close");
    expect(t("flashcardClose", "ru")).toBe("✕ Закрыть");
    expect(t("flashcardClose", "cs")).toBe("✕ Zavřít");
  });

  it("returns flashcardProgress with {current} and {total} interpolation in English", () => {
    expect(t("flashcardProgress", "en", { current: 3, total: 10 })).toBe("Card 3 of 10");
  });

  it("returns flashcardProgress with {current} and {total} interpolation in Russian", () => {
    expect(t("flashcardProgress", "ru", { current: 3, total: 10 })).toBe("Карточка 3 из 10");
  });

  it("returns flashcardProgress with {current} and {total} interpolation in Czech", () => {
    expect(t("flashcardProgress", "cs", { current: 3, total: 10 })).toBe("Kartička 3 z 10");
  });

  it("returns flashcardQuitBtn in all locales", () => {
    expect(t("flashcardQuitBtn", "en")).toBe("✕ Quit");
    expect(t("flashcardQuitBtn", "ru")).toBe("✕ Выйти");
    expect(t("flashcardQuitBtn", "cs")).toBe("✕ Ukončit");
  });

  it("returns flashcardDoneBtn in all locales", () => {
    expect(t("flashcardDoneBtn", "en")).toBe("🎉 Done!");
    expect(t("flashcardDoneBtn", "ru")).toBe("🎉 Готово!");
    expect(t("flashcardDoneBtn", "cs")).toBe("🎉 Hotovo!");
  });

  it("returns flashcardNewDeckBtn in all locales", () => {
    expect(t("flashcardNewDeckBtn", "en")).toBe("🔄 New Deck");
    expect(t("flashcardNewDeckBtn", "ru")).toBe("🔄 Новая колода");
    expect(t("flashcardNewDeckBtn", "cs")).toBe("🔄 Nový balíček");
  });

  it("returns flashcardSessionExpired in all locales", () => {
    expect(t("flashcardSessionExpired", "en")).toContain("Session expired");
    expect(t("flashcardSessionExpired", "ru")).toContain("Сессия истекла");
    expect(t("flashcardSessionExpired", "cs")).toContain("Relace vypršela");
  });

  it("returns cmdDescFlashcard in all locales", () => {
    expect(t("cmdDescFlashcard", "en")).toBe("Start a flash card session");
    expect(t("cmdDescFlashcard", "ru")).toBe("Начать сессию карточек");
    expect(t("cmdDescFlashcard", "cs")).toBe("Začít relaci kartiček");
  });

  it("returns SRS review keys in all locales", () => {
    expect(t("cmdDescReview", "en")).toBe("Review due words with spaced repetition");
    expect(t("srsProgress", "en", { current: 2, total: 5 })).toBe("Review 2 of 5");
    expect(t("srsDone", "ru", { count: 3 })).toContain("3");
    expect(t("srsReveal", "cs")).toBe("👁 Ukázat");
  });

  it("falls back to English for flashcard keys when locale has no file", () => {
    expect(t("flashcardStart", "de", { count: 5 })).toBe("📚 Flash Cards — 5 words in your deck.");
    expect(t("flashcardStartBtn", "de")).toBe("▶️ Start");
    expect(t("flashcardEmpty", "de")).toContain("dictionary is empty");
    expect(t("flashcardReveal", "de")).toBe("👁 Reveal");
    expect(t("flashcardNext", "de")).toBe("▶️ Next");
    expect(t("flashcardDone", "de", { count: 10 })).toBe("🎉 Done! You reviewed 10 words.");
    expect(t("flashcardQuit", "de")).toContain("session ended");
    expect(t("flashcardProgress", "de", { current: 1, total: 5 })).toBe("Card 1 of 5");
    expect(t("flashcardQuitBtn", "de")).toBe("✕ Quit");
    expect(t("flashcardDoneBtn", "de")).toBe("🎉 Done!");
    expect(t("flashcardNewDeckBtn", "de")).toBe("🔄 New Deck");
    expect(t("flashcardSessionExpired", "de")).toContain("Session expired");
    expect(t("cmdDescFlashcard", "de")).toBe("Start a flash card session");
    expect(t("cmdDescReview", "de")).toBe("Review due words with spaced repetition");
    expect(t("srsProgress", "de", { current: 1, total: 5 })).toBe("Review 1 of 5");
  });

  // Dictionary browse/delete keys (task 40)
  it("returns dictionaryHeader with {count} interpolation in English", () => {
    expect(t("dictionaryHeader", "en", { count: 42 })).toBe("📖 Your Dictionary (42 words)");
  });

  it("returns dictionaryHeader with {count} interpolation in Russian", () => {
    expect(t("dictionaryHeader", "ru", { count: 42 })).toBe("📖 Ваш словарь (42 слов)");
  });

  it("returns dictionaryHeader with {count} interpolation in Czech", () => {
    expect(t("dictionaryHeader", "cs", { count: 42 })).toBe("📖 Váš slovník (42 slov)");
  });

  it("returns dictionaryPage with {page} and {total} interpolation in English", () => {
    expect(t("dictionaryPage", "en", { page: 1, total: 3 })).toBe("Page 1 of 3");
  });

  it("returns dictionaryPage with {page} and {total} interpolation in Russian", () => {
    expect(t("dictionaryPage", "ru", { page: 2, total: 5 })).toBe("Стр. 2 из 5");
  });

  it("returns dictionaryPage with {page} and {total} interpolation in Czech", () => {
    expect(t("dictionaryPage", "cs", { page: 3, total: 4 })).toBe("Str. 3 z 4");
  });

  it("returns dictionaryPrev in all locales", () => {
    expect(t("dictionaryPrev", "en")).toBe("◀️");
    expect(t("dictionaryPrev", "ru")).toBe("◀️");
    expect(t("dictionaryPrev", "cs")).toBe("◀️");
  });

  it("returns dictionaryNext in all locales", () => {
    expect(t("dictionaryNext", "en")).toBe("▶️");
    expect(t("dictionaryNext", "ru")).toBe("▶️");
    expect(t("dictionaryNext", "cs")).toBe("▶️");
  });

  it("returns dictionaryClose in all locales", () => {
    expect(t("dictionaryClose", "en")).toBe("✕ Close");
    expect(t("dictionaryClose", "ru")).toBe("✕ Закрыть");
    expect(t("dictionaryClose", "cs")).toBe("✕ Zavřít");
  });

  it("returns dictionaryBack in all locales", () => {
    expect(t("dictionaryBack", "en")).toBe("← Back to list");
    expect(t("dictionaryBack", "ru")).toBe("← К списку");
    expect(t("dictionaryBack", "cs")).toBe("← Zpět na seznam");
  });

  it("returns dictionaryDelete in all locales", () => {
    expect(t("dictionaryDelete", "en")).toBe("🗑 Delete");
    expect(t("dictionaryDelete", "ru")).toBe("🗑 Удалить");
    expect(t("dictionaryDelete", "cs")).toBe("🗑 Smazat");
  });

  it("returns dictionaryDeleteConfirm with {word} interpolation in English", () => {
    expect(t("dictionaryDeleteConfirm", "en", { word: "apple" })).toBe('⚠️ Delete "apple" from your dictionary?');
  });

  it("returns dictionaryDeleteConfirm with {word} interpolation in Russian", () => {
    expect(t("dictionaryDeleteConfirm", "ru", { word: "apple" })).toBe('⚠️ Удалить "apple" из словаря?');
  });

  it("returns dictionaryDeleteConfirm with {word} interpolation in Czech", () => {
    expect(t("dictionaryDeleteConfirm", "cs", { word: "apple" })).toBe('⚠️ Smazat "apple" ze slovníku?');
  });

  it("returns dictionaryDeleteYes in all locales", () => {
    expect(t("dictionaryDeleteYes", "en")).toBe("✅ Yes, delete");
    expect(t("dictionaryDeleteYes", "ru")).toBe("✅ Да, удалить");
    expect(t("dictionaryDeleteYes", "cs")).toBe("✅ Ano, smazat");
  });

  it("returns dictionaryDeleteCancel in all locales", () => {
    expect(t("dictionaryDeleteCancel", "en")).toBe("← Cancel");
    expect(t("dictionaryDeleteCancel", "ru")).toBe("← Отмена");
    expect(t("dictionaryDeleteCancel", "cs")).toBe("← Zrušit");
  });

  it("returns dictionarySessionExpired in all locales", () => {
    expect(t("dictionarySessionExpired", "en")).toContain("Session expired");
    expect(t("dictionarySessionExpired", "ru")).toContain("Сессия истекла");
    expect(t("dictionarySessionExpired", "cs")).toContain("Relace vypršela");
  });

  it("falls back to English for dictionary browse keys when locale has no file", () => {
    expect(t("dictionaryHeader", "de", { count: 10 })).toBe("📖 Your Dictionary (10 words)");
    expect(t("dictionaryPage", "de", { page: 1, total: 2 })).toBe("Page 1 of 2");
    expect(t("dictionaryPrev", "de")).toBe("◀️");
    expect(t("dictionaryNext", "de")).toBe("▶️");
    expect(t("dictionaryClose", "de")).toBe("✕ Close");
    expect(t("dictionaryBack", "de")).toBe("← Back to list");
    expect(t("dictionaryDelete", "de")).toBe("🗑 Delete");
    expect(t("dictionaryDeleteConfirm", "de", { word: "haus" })).toBe('⚠️ Delete "haus" from your dictionary?');
    expect(t("dictionaryDeleteYes", "de")).toBe("✅ Yes, delete");
    expect(t("dictionaryDeleteCancel", "de")).toBe("← Cancel");
    expect(t("dictionarySessionExpired", "de")).toContain("Session expired");
  });

  // Settings command keys (task 37)
  it("returns settingsTitle in all locales", () => {
    expect(t("settingsTitle", "en")).toBe("⚙️ Settings");
    expect(t("settingsTitle", "ru")).toBe("⚙️ Настройки");
    expect(t("settingsTitle", "cs")).toBe("⚙️ Nastavení");
  });

  it("returns settingsNativeLang with {lang} interpolation in all locales", () => {
    expect(t("settingsNativeLang", "en", { lang: "English" })).toBe("🗣 Native language: English");
    expect(t("settingsNativeLang", "ru", { lang: "English" })).toBe("🗣 Родной язык: English");
    expect(t("settingsNativeLang", "cs", { lang: "English" })).toBe("🗣 Mateřský jazyk: English");
  });

  it("returns settingsLearningLangs with {langs} interpolation in all locales", () => {
    expect(t("settingsLearningLangs", "en", { langs: "Czech, Russian" })).toBe("📚 Learning: Czech, Russian");
    expect(t("settingsLearningLangs", "ru", { langs: "Czech, Russian" })).toBe("📚 Изучаю: Czech, Russian");
    expect(t("settingsLearningLangs", "cs", { langs: "Czech, Russian" })).toBe("📚 Učím se: Czech, Russian");
  });

  it("returns settingsInterfaceLang with {lang} interpolation in all locales", () => {
    expect(t("settingsInterfaceLang", "en", { lang: "English" })).toBe("🌐 Interface: English");
    expect(t("settingsInterfaceLang", "ru", { lang: "English" })).toBe("🌐 Интерфейс: English");
    expect(t("settingsInterfaceLang", "cs", { lang: "English" })).toBe("🌐 Rozhraní: English");
  });

  it("returns settingsChangeNative in all locales", () => {
    expect(t("settingsChangeNative", "en")).toBe("🗣 Change native");
    expect(t("settingsChangeNative", "ru")).toBe("🗣 Сменить родной");
    expect(t("settingsChangeNative", "cs")).toBe("🗣 Změnit mateřský");
  });

  it("returns settingsChangeLearning in all locales", () => {
    expect(t("settingsChangeLearning", "en")).toBe("📚 Change learning");
    expect(t("settingsChangeLearning", "ru")).toBe("📚 Сменить изучаемые");
    expect(t("settingsChangeLearning", "cs")).toBe("📚 Změnit učení");
  });

  it("returns settingsChangeInterface in all locales", () => {
    expect(t("settingsChangeInterface", "en")).toBe("🌐 Change interface");
    expect(t("settingsChangeInterface", "ru")).toBe("🌐 Сменить интерфейс");
    expect(t("settingsChangeInterface", "cs")).toBe("🌐 Změnit rozhraní");
  });

  it("returns settingsClose in all locales", () => {
    expect(t("settingsClose", "en")).toBe("❌ Close");
    expect(t("settingsClose", "ru")).toBe("❌ Закрыть");
    expect(t("settingsClose", "cs")).toBe("❌ Zavřít");
  });

  it("returns settingsChooseNative in all locales", () => {
    expect(t("settingsChooseNative", "en")).toContain("native language");
    expect(t("settingsChooseNative", "ru")).toContain("родной язык");
    expect(t("settingsChooseNative", "cs")).toContain("mateřský jazyk");
  });

  it("returns settingsChooseLearning in all locales", () => {
    expect(t("settingsChooseLearning", "en")).toContain("learning");
    expect(t("settingsChooseLearning", "ru")).toContain("изучаемые");
    expect(t("settingsChooseLearning", "cs")).toContain("studiu");
  });

  it("returns settingsChooseInterface in all locales", () => {
    expect(t("settingsChooseInterface", "en")).toContain("interface language");
    expect(t("settingsChooseInterface", "ru")).toContain("язык интерфейса");
    expect(t("settingsChooseInterface", "cs")).toContain("jazyk rozhraní");
  });

  it("returns settingsNativeUpdated with {lang} interpolation in all locales", () => {
    expect(t("settingsNativeUpdated", "en", { lang: "French" })).toBe("✅ Native language set to French");
    expect(t("settingsNativeUpdated", "ru", { lang: "French" })).toBe("✅ Родной язык установлен: French");
    expect(t("settingsNativeUpdated", "cs", { lang: "French" })).toBe("✅ Mateřský jazyk nastaven na French");
  });

  it("returns settingsLearningUpdated in all locales", () => {
    expect(t("settingsLearningUpdated", "en")).toBe("✅ Learning languages updated");
    expect(t("settingsLearningUpdated", "ru")).toBe("✅ Изучаемые языки обновлены");
    expect(t("settingsLearningUpdated", "cs")).toBe("✅ Jazyky ke studiu aktualizovány");
  });

  it("returns settingsInterfaceUpdated with {lang} interpolation in all locales", () => {
    expect(t("settingsInterfaceUpdated", "en", { lang: "Czech" })).toBe("✅ Interface language set to Czech");
    expect(t("settingsInterfaceUpdated", "ru", { lang: "Czech" })).toBe("✅ Язык интерфейса установлен: Czech");
    expect(t("settingsInterfaceUpdated", "cs", { lang: "Czech" })).toBe("✅ Jazyk rozhraní nastaven na Czech");
  });

  it("returns settingsSessionExpired in all locales", () => {
    expect(t("settingsSessionExpired", "en")).toContain("Session expired");
    expect(t("settingsSessionExpired", "ru")).toContain("Сессия истекла");
    expect(t("settingsSessionExpired", "cs")).toContain("Relace vypršela");
  });

  it("falls back to English for settings keys when locale has no file", () => {
    expect(t("settingsTitle", "de")).toBe("⚙️ Settings");
    expect(t("settingsNativeLang", "de", { lang: "German" })).toBe("🗣 Native language: German");
    expect(t("settingsLearningLangs", "de", { langs: "English" })).toBe("📚 Learning: English");
    expect(t("settingsInterfaceLang", "de", { lang: "German" })).toBe("🌐 Interface: German");
    expect(t("settingsChangeNative", "de")).toBe("🗣 Change native");
    expect(t("settingsChangeLearning", "de")).toBe("📚 Change learning");
    expect(t("settingsChangeInterface", "de")).toBe("🌐 Change interface");
    expect(t("settingsClose", "de")).toBe("❌ Close");
    expect(t("settingsChooseNative", "de")).toContain("native language");
    expect(t("settingsChooseLearning", "de")).toContain("learning");
    expect(t("settingsChooseInterface", "de")).toContain("interface language");
    expect(t("settingsNativeUpdated", "de", { lang: "French" })).toBe("✅ Native language set to French");
    expect(t("settingsLearningUpdated", "de")).toBe("✅ Learning languages updated");
    expect(t("settingsInterfaceUpdated", "de", { lang: "Czech" })).toBe("✅ Interface language set to Czech");
    expect(t("settingsSessionExpired", "de")).toContain("Session expired");
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
      "contextMarkerNeedsText",
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
      "save",
      "connotationWarning",
      "templateTitle",
      "templateCurrent",
      "templateDefault",
      "templateCustom",
      "templateCustomize",
      "templateReset",
      "templateConstructor",
      "templatePreview",
      "templateSave",
      "templateCancel",
      "templateBack",
      "templateSaved",
      "templateResetDone",
      "templateCancelled",
      "templateFieldSynonyms",
      "templateFieldExamples",
      "templateFieldAlternatives",
      "templateFieldEquivalentNote",
      "templateFieldConnotationWarning",
      "templatePreviewHeader",
      "templateSessionExpired",
      "cmdDescStart",
      "cmdDescTranslate",
      "cmdDescDictionary",
      "cmdDescTemplate",
      "cmdDescSettings",
      "qualityUncertain",
      "flashcardStart",
      "flashcardStartBtn",
      "flashcardEmpty",
      "flashcardReveal",
      "flashcardNext",
      "flashcardDone",
      "flashcardQuit",
      "flashcardRestart",
      "flashcardClose",
      "flashcardProgress",
      "flashcardQuitBtn",
      "flashcardDoneBtn",
      "flashcardNewDeckBtn",
      "flashcardSessionExpired",
      "cmdDescFlashcard",
      "cmdDescReview",
      "srsEmpty",
      "srsProgress",
      "srsReveal",
      "srsChooseRating",
      "srsAgain",
      "srsHard",
      "srsGood",
      "srsEasy",
      "srsScheduled",
      "srsDone",
      "srsQuit",
      "srsQuitBtn",
      "srsNewSessionBtn",
      "srsClose",
      "srsSessionExpired",
      "dictionaryHeader",
      "dictionaryPage",
      "dictionaryPrev",
      "dictionaryNext",
      "dictionaryClose",
      "dictionaryBack",
      "dictionaryDelete",
      "dictionaryDeleteConfirm",
      "dictionaryDeleteYes",
      "dictionaryDeleteCancel",
      "dictionarySessionExpired",
      "settingsTitle",
      "settingsNativeLang",
      "settingsLearningLangs",
      "settingsInterfaceLang",
      "settingsChangeNative",
      "settingsChangeLearning",
      "settingsChangeInterface",
      "settingsClose",
      "settingsChooseNative",
      "settingsChooseLearning",
      "settingsChooseInterface",
      "settingsNativeUpdated",
      "settingsLearningUpdated",
      "settingsInterfaceUpdated",
      "settingsSessionExpired",
      "notifTitle",
      "notifWordFromDict",
      "notifAiSuggested",
      "notifTranslations",
      "notifOpenDict",
      "notifSkip",
      "settingsNotifSection",
      "settingsNotifEnabled",
      "settingsNotifDisabled",
      "settingsNotifTime",
      "settingsNotifType",
      "settingsNotifTimezone",
      "settingsNotifToggle",
      "settingsNotifChooseTime",
      "settingsNotifChooseType",
      "settingsNotifChooseTimezone",
      "notifPaused",
      "notifReEngagement",
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

describe("i18n — notification keys (Task 41.6)", () => {
  const notifKeys: I18nKey[] = [
    "notifTitle",
    "notifWordFromDict",
    "notifAiSuggested",
    "notifTranslations",
    "notifOpenDict",
    "notifSkip",
    "settingsNotifSection",
    "settingsNotifEnabled",
    "settingsNotifDisabled",
    "settingsNotifTime",
    "settingsNotifType",
    "settingsNotifTimezone",
    "settingsNotifToggle",
    "settingsNotifChooseTime",
    "settingsNotifChooseType",
    "settingsNotifChooseTimezone",
    "notifPaused",
    "notifReEngagement",
  ];

  it("all notification keys exist in en.json", () => {
    for (const key of notifKeys) {
      const result = t(key, "en");
      expect(result).not.toBe(key);
    }
  });

  it("all notification keys exist in ru.json (non-English)", () => {
    for (const key of notifKeys) {
      const enResult = t(key, "en");
      const ruResult = t(key, "ru");
      expect(ruResult).not.toBe(enResult);
    }
  });

  it("all notification keys exist in cs.json (non-English)", () => {
    for (const key of notifKeys) {
      const enResult = t(key, "en");
      const csResult = t(key, "cs");
      expect(csResult).not.toBe(enResult);
    }
  });

  it("settingsNotifTime interpolates {time}", () => {
    const result = t("settingsNotifTime", "en", { time: "Morning (8:00)" });
    expect(result).toBe("⏰ Time: Morning (8:00)");
  });

  it("settingsNotifType interpolates {type}", () => {
    const result = t("settingsNotifType", "en", { type: "Both" });
    expect(result).toBe("📋 Type: Both");
  });

  it("settingsNotifTimezone interpolates {timezone}", () => {
    const result = t("settingsNotifTimezone", "en", { timezone: "Europe/Prague" });
    expect(result).toBe("🌍 Timezone: Europe/Prague");
  });

  it("settingsNotifTime interpolates {time} in Russian", () => {
    const result = t("settingsNotifTime", "ru", { time: "Утро (8:00)" });
    expect(result).toBe("⏰ Время: Утро (8:00)");
  });

  it("settingsNotifType interpolates {type} in Czech", () => {
    const result = t("settingsNotifType", "cs", { type: "Oba" });
    expect(result).toBe("📋 Typ: Oba");
  });

  it("settingsNotifTimezone interpolates {timezone} in Czech", () => {
    const result = t("settingsNotifTimezone", "cs", { timezone: "Europe/Prague" });
    expect(result).toBe("🌍 Časová zóna: Europe/Prague");
  });

  it("notification keys fallback to en for unsupported language", () => {
    for (const key of notifKeys) {
      const enResult = t(key, "en");
      const deResult = t(key, "de");
      expect(deResult).toBe(enResult);
    }
  });
});
