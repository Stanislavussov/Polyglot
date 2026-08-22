import { logger, type SupportedLang, t } from "@polyglot/core";
import type { Api, RawApi } from "grammy";
import { canUseChangesCommand } from "./changes.js";

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
  start: "🚀",
  pick: "✨",
  translate: "🔤",
  dictionary: "📖",
  flashcard: "🎴",
  videos: "🎬",
  mentor: "🤖",
  review: "🔁",
  template: "📝",
  settings: "⚙️",
  report: "🐛",
  changes: "🆕",
} as const;

/**
 * Returns the bot commands with descriptions localized to the given language,
 * each prefixed with its icon from {@link COMMAND_ICONS}.
 *
 * The everyday entry points — pick words, dictionary, flash cards, videos — are also on the
 * persistent reply keyboard (`utils/main-menu.ts`), which is where a user is meant
 * to tap them. They stay listed here as the fallback path: a reply keyboard lives
 * on the message that delivered it, so clearing the chat history or deleting that
 * message takes the menu away, and without these entries the features would be
 * reachable only by typing the command from memory.
 */
export function getLocalizedCommands(lang: SupportedLang, options: { includeChanges?: boolean } = {}): BotCommand[] {
  const commands = [
    { command: "start", description: `${COMMAND_ICONS.start} ${t("cmdDescStart", lang)}` },
    { command: "translate", description: `${COMMAND_ICONS.translate} ${t("cmdDescTranslate", lang)}` },
    { command: "pick", description: `${COMMAND_ICONS.pick} ${t("cmdDescPick", lang)}` },
    { command: "dictionary", description: `${COMMAND_ICONS.dictionary} ${t("cmdDescDictionary", lang)}` },
    { command: "flashcard", description: `${COMMAND_ICONS.flashcard} ${t("cmdDescFlashcard", lang)}` },
    { command: "videos", description: `${COMMAND_ICONS.videos} ${t("cmdDescVideos", lang)}` },
    // { command: "mentor", description: `${COMMAND_ICONS.mentor} ${t("cmdDescMentor", lang)}` },
    // { command: "review", description: `${COMMAND_ICONS.review} ${t("cmdDescReview", lang)}` },
    { command: "template", description: `${COMMAND_ICONS.template} ${t("cmdDescTemplate", lang)}` },
    { command: "settings", description: `${COMMAND_ICONS.settings} ${t("cmdDescSettings", lang)}` },
    { command: "report", description: `${COMMAND_ICONS.report} ${t("cmdDescReport", lang)}` },
  ];

  if (options.includeChanges) {
    commands.push({ command: "changes", description: `${COMMAND_ICONS.changes} ${t("cmdDescChanges", lang)}` });
  }

  return commands;
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
export async function setUserCommands(
  api: Api<RawApi>,
  chatId: number,
  lang: SupportedLang,
  audienceGroup: string,
): Promise<void> {
  try {
    await api.setMyCommands(getLocalizedCommands(lang, { includeChanges: canUseChangesCommand(audienceGroup) }), {
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
