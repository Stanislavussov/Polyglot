/** Supported languages with labels and flag emojis */
export const LANGUAGES = [
  { code: "ru", label: "Русский", flag: "🇷🇺" },
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "cs", label: "Čeština", flag: "🇨🇿" },
  { code: "de", label: "Deutsch", flag: "🇩🇪" },
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "es", label: "Español", flag: "🇪🇸" },
  { code: "it", label: "Italiano", flag: "🇮🇹" },
  { code: "pt", label: "Português", flag: "🇵🇹" },
  { code: "uk", label: "Українська", flag: "🇺🇦" },
  { code: "pl", label: "Polski", flag: "🇵🇱" },
] as const;

export type LangCode = (typeof LANGUAGES)[number]["code"];

/** Max number of target languages a user can learn */
export const MAX_LEARNING_LANGS = 4;

/** Get language display string (flag + label) */
export function langDisplay(code: string): string {
  const lang = LANGUAGES.find((l) => l.code === code);
  return lang ? `${lang.flag} ${lang.label}` : code;
}

/** Interface texts per language (minimal i18n until i18n module is created) */
export const TEXTS: Record<string, Record<string, string>> = {
  en: {
    chooseInterfaceLang: "🌍 Which language would you like to continue in?",
    chooseNativeLang: "🏠 What is your native language?",
    chooseLearningLangs:
      "📚 Which languages are you learning? (select 1–4, then press ✅ Done)",
    done: "✅ Done",
    enterWord:
      "✨ Great! Now enter any word or phrase to see a demo translation:",
    demoResult:
      "Here's what your translation card will look like.\n\n🔤 *{word}*\n\n_(AI translation will appear here once connected)_\n\n💾 Save to dictionary?",
    yes: "✅ Yes",
    no: "❌ No",
    onboardingComplete:
      "🎉 Onboarding complete! You're all set.\n\nUse /translate to translate words and phrases.",
    onboardingCompleteNoSave:
      "👍 No problem! Use /translate anytime to translate words.\n\nOnboarding complete!",
    welcomeBack:
      "👋 Welcome back! Use the menu to get started.\n\n/translate — Translate a word or phrase\n/dictionary — Personal dictionary\n/settings — Language & notification settings",
    maxLangsReached: "⚠️ You can select up to {max} languages.",
    selectAtLeastOne: "Please select at least one language.",
    langAdded: "Added: {lang}",
    langRemoved: "Removed: {lang}",
  },
  ru: {
    chooseInterfaceLang: "🌍 На каком языке продолжить?",
    chooseNativeLang: "🏠 Какой ваш родной язык?",
    chooseLearningLangs:
      "📚 Какие языки вы изучаете? (выберите 1–4, затем нажмите ✅ Готово)",
    done: "✅ Готово",
    enterWord:
      "✨ Отлично! Введите любое слово или фразу, чтобы увидеть демо-перевод:",
    demoResult:
      "Вот как будет выглядеть карточка перевода.\n\n🔤 *{word}*\n\n_(AI-перевод появится здесь после подключения)_\n\n💾 Сохранить в словарь?",
    yes: "✅ Да",
    no: "❌ Нет",
    onboardingComplete:
      "🎉 Онбординг завершён! Всё готово.\n\nИспользуйте /translate для перевода слов и фраз.",
    onboardingCompleteNoSave:
      "👍 Без проблем! Используйте /translate для перевода слов.\n\nОнбординг завершён!",
    welcomeBack:
      "👋 С возвращением! Используйте меню.\n\n/translate — Перевести слово или фразу\n/dictionary — Личный словарь\n/settings — Настройки языков и уведомлений",
    maxLangsReached: "⚠️ Можно выбрать максимум {max} языков.",
    selectAtLeastOne: "Выберите хотя бы один язык.",
    langAdded: "Добавлено: {lang}",
    langRemoved: "Удалено: {lang}",
  },
  cs: {
    chooseInterfaceLang: "🌍 V jakém jazyce chcete pokračovat?",
    chooseNativeLang: "🏠 Jaký je váš mateřský jazyk?",
    chooseLearningLangs:
      "📚 Jaké jazyky se učíte? (vyberte 1–4, pak stiskněte ✅ Hotovo)",
    done: "✅ Hotovo",
    enterWord:
      "✨ Skvělé! Zadejte libovolné slovo nebo frázi pro ukázkový překlad:",
    demoResult:
      "Takto bude vypadat vaše překladová karta.\n\n🔤 *{word}*\n\n_(AI překlad se zobrazí po připojení)_\n\n💾 Uložit do slovníku?",
    yes: "✅ Ano",
    no: "❌ Ne",
    onboardingComplete:
      "🎉 Onboarding dokončen! Jste připraveni.\n\nPoužijte /translate pro překlad slov a frází.",
    onboardingCompleteNoSave:
      "👍 Žádný problém! Použijte /translate kdykoli pro překlad slov.\n\nOnboarding dokončen!",
    welcomeBack:
      "👋 Vítejte zpět! Použijte nabídku.\n\n/translate — Přeložit slovo nebo frázi\n/dictionary — Osobní slovník\n/settings — Nastavení jazyků a notifikací",
    maxLangsReached: "⚠️ Můžete vybrat maximálně {max} jazyků.",
    selectAtLeastOne: "Vyberte alespoň jeden jazyk.",
    langAdded: "Přidáno: {lang}",
    langRemoved: "Odebráno: {lang}",
  },
};

/** Get a text string in the given language with optional interpolation */
export function t(
  key: string,
  lang: string,
  params?: Record<string, string | number>,
): string {
  const texts = TEXTS[lang] ?? TEXTS["en"]!;
  let text = texts[key] ?? TEXTS["en"]![key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}
