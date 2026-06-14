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
 * Returns the 7 bot commands with descriptions localized to the given language.
 * Uses i18n keys: cmdDescStart, cmdDescTranslate, cmdDescDictionary, cmdDescTemplate, cmdDescSettings, cmdDescFlashcard, cmdDescReview, cmdDescReport.
 */
export function getLocalizedCommands(lang: SupportedLang, options: { includeChanges?: boolean } = {}): BotCommand[] {
  const commands = [
    { command: "start", description: t("cmdDescStart", lang) },
    { command: "translate", description: t("cmdDescTranslate", lang) },
    { command: "flashcard", description: t("cmdDescFlashcard", lang) },
    { command: "review", description: t("cmdDescReview", lang) },
    { command: "dictionary", description: t("cmdDescDictionary", lang) },
    { command: "template", description: t("cmdDescTemplate", lang) },
    { command: "settings", description: t("cmdDescSettings", lang) },
    { command: "report", description: t("cmdDescReport", lang) },
  ];

  if (options.includeChanges) {
    commands.push({ command: "changes", description: t("cmdDescChanges", lang) });
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
