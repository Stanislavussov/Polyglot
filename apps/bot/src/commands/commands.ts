import { logger, type SupportedLang, t } from "@polyglot/core";
import type { Api, RawApi } from "grammy";

/** Locales that have dedicated i18n locale files. */
const LOCALES_WITH_FILES: readonly SupportedLang[] = ["en", "ru", "cs"];

/** Shape matching Telegram BotCommand. */
export interface BotCommand {
  command: string;
  description: string;
}

/**
 * Emoji prefixed to each command description.
 *
 * Telegram forbids emoji in command *names*, so the icon goes at the start of the
 * description — it renders right next to the command in the menu. Icons are language
 * independent, which is why they live here instead of in the locale files, and each one
 * matches the emoji the feature already uses in-bot (📖 dictionary, ⚙️ settings, 🐛 report…).
 */
const COMMAND_ICONS = {
  learn: "🎓",
  dictionary: "📖",
  settings: "⚙️",
  report: "🐛",
} as const;

/**
 * Returns the bot commands with descriptions localized to the given language,
 * each prefixed with its icon from {@link COMMAND_ICONS}.
 *
 * Ordered by how often a learner needs the entry: the two things they came for, then the
 * configuration tail. Descriptions are one label, not a sentence — Telegram renders the
 * whole list at once, so a line that enumerates what sits behind the command turns the
 * menu into a wall of text.
 *
 * `/menu` is deliberately absent, and this list is why: the hub behind it holds the
 * dictionary, the learning modes, the settings and the bug report, which are the four
 * entries already here. A menu command inside the menu is one tap to reach the list the
 * user is already looking at.
 *
 * `/start` is absent for a different reason: Telegram offers its own START button on an
 * empty chat, and for everyone past onboarding the entry is only a way to lose their
 * setup by accident.
 *
 * All of them — plus `/translate`, `/pick`, `/flashcard`, `/videos`, `/template`,
 * `/review`, `/mentor`, `/changes` — stay registered in `bot-factory.ts`: only their
 * advertisement is gone, so typing one still works, and so does tapping one in old
 * chat history.
 */
export function getLocalizedCommands(lang: SupportedLang): BotCommand[] {
  return [
    { command: "learn", description: `${COMMAND_ICONS.learn} ${t("cmdDescLearn", lang)}` },
    { command: "dictionary", description: `${COMMAND_ICONS.dictionary} ${t("cmdDescDictionary", lang)}` },
    { command: "settings", description: `${COMMAND_ICONS.settings} ${t("cmdDescSettings", lang)}` },
    { command: "report", description: `${COMMAND_ICONS.report} ${t("cmdDescReport", lang)}` },
  ];
}

/**
 * Set bot commands for all available locales at startup.
 *
 * 1. Sets default (no language_code) to English — fallback for unsupported locales.
 * 2. Sets per-language commands for each locale that has an i18n file.
 *
 * Errors are logged but never thrown — bot startup is not blocked.
 */
export async function setBotCommands(api: Api<RawApi>): Promise<void> {
  // Default fallback (English) — for users whose Telegram lang doesn't match any locale
  try {
    await api.setMyCommands(getLocalizedCommands("en"));
    logger.info("Default bot commands set (en fallback)");
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, "Failed to set default bot commands");
  }

  // Per-locale commands
  for (const lang of LOCALES_WITH_FILES) {
    try {
      await api.setMyCommands(getLocalizedCommands(lang), { language_code: lang });
      logger.info({ lang }, "Bot commands set for locale");
    } catch (err) {
      logger.error(
        { lang, error: err instanceof Error ? err.message : String(err) },
        "Failed to set bot commands for locale",
      );
    }
  }
}

/**
 * Set commands for a specific user chat using BotCommandScopeChat.
 *
 * Called after onboarding or when the user changes their interface language.
 * Errors are logged but never thrown — user flow is not blocked.
 */
export async function setUserCommands(api: Api<RawApi>, chatId: number, lang: SupportedLang): Promise<void> {
  try {
    await api.setMyCommands(getLocalizedCommands(lang), {
      scope: { type: "chat", chat_id: chatId },
      language_code: lang,
    });
    logger.info({ chatId, lang }, "User-specific bot commands set");
  } catch (err) {
    logger.error(
      { chatId, lang, error: err instanceof Error ? err.message : String(err) },
      "Failed to set user-specific bot commands",
    );
  }
}
