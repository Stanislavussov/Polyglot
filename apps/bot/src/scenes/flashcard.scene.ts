/**
 * Flashcard scene — /flashcard command handler.
 *
 * Starts a flash card session by running the dictionary pipeline
 * and storing the deck in session state.
 *
 * All DB access through ctx.services. All text via i18n.
 */

import type { SupportedLang } from "@polyglot/core";
import { FLASHCARD_CONFIG, isSupported, t } from "@polyglot/core";
import type { BotContext } from "../types.js";
import { replyTechnical } from "../utils/message-cleanup.js";
import { getPipeline } from "./helpers/flashcard.helper.js";

/** Resolve user's interface language. */
async function getUserLang(ctx: BotContext): Promise<SupportedLang> {
  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const lang = settings?.interfaceLang;
  return lang && isSupported(lang) ? lang : "en";
}

/** /flashcard command — start a new flash card session. */
export async function handleFlashcardCommand(ctx: BotContext): Promise<void> {
  const lang = await getUserLang(ctx);
  const pipeline = getPipeline(ctx);

  const result = await pipeline.run(ctx.user.id, FLASHCARD_CONFIG);

  if (result.words.length === 0) {
    await replyTechnical(ctx, t("flashcardEmpty", lang));
    return;
  }

  ctx.session.flashcard = {
    deck: result.words,
    currentIndex: 0,
    config: FLASHCARD_CONFIG,
  };

  const word = result.words[0]!;
  const { renderFlashCardFront } = await import("../renderers/flashcard.renderer.js");
  const { buildFlashCardFrontKeyboard } = await import("../renderers/flashcard.renderer.js");
  const text = renderFlashCardFront(word, 1, result.words.length, lang);
  const kb = buildFlashCardFrontKeyboard(lang);

  const msg = await replyTechnical(ctx, text, { parse_mode: "HTML", reply_markup: kb });
  ctx.session.flashcard.cardMsgId = msg.message_id;
}
