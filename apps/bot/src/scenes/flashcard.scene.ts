/**
 * Flashcard scene — /flashcard command handler.
 *
 * Starts a flash card session by running the dictionary pipeline
 * and storing the deck in session state.
 *
 * All DB access through repositories. All text via i18n.
 */

import { userRepository } from "@polyglot/adapter-db";
import type { SupportedLang } from "@polyglot/core";
import { FLASHCARD_CONFIG, isSupported, t } from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import type { BotContext } from "../types.js";
import { getPipeline } from "./helpers/flashcard.helper.js";

/** Resolve user's interface language. */
async function getUserLang(ctx: BotContext): Promise<SupportedLang> {
  const settings = await userRepository.getSettings(ctx.user.id);
  const lang = settings?.interfaceLang;
  return lang && isSupported(lang) ? lang : "en";
}

/** /flashcard command — start a new flash card session. */
export async function handleFlashcardCommand(ctx: BotContext): Promise<void> {
  const lang = await getUserLang(ctx);
  const pipeline = getPipeline();

  const result = await pipeline.run(ctx.user.id, FLASHCARD_CONFIG);

  if (result.words.length === 0) {
    await ctx.reply(t("flashcardEmpty", lang));
    return;
  }

  ctx.session.flashcard = {
    deck: result.words,
    currentIndex: 0,
    config: FLASHCARD_CONFIG,
  };

  const kb = new InlineKeyboard().text(t("flashcardStartBtn", lang), "fc:start");
  const msg = await ctx.reply(t("flashcardStart", lang, { count: String(result.words.length) }), {
    parse_mode: "HTML",
    reply_markup: kb,
  });
  ctx.session.flashcard.cardMsgId = msg.message_id;
}
