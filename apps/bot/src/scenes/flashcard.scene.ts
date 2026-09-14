/**
 * Cards — `/flashcard`, `/review`, the 🎴 hot button, the Learning hub and onboarding's
 * training button all open the same SRS-backed deck (Task 85).
 */

import { t } from "@polyglot/core";
import type { BotContext } from "../types.js";
import { buildCardsSession, buildCurrentFront, getUserLang } from "./helpers/flashcard.helper.js";

export async function handleFlashcardCommand(ctx: BotContext): Promise<void> {
  const lang = await getUserLang(ctx);
  const cards = await buildCardsSession(ctx);
  if (!cards) {
    await ctx.reply(t("cardsNoSavedWords", lang));
    return;
  }

  ctx.session.cards = cards;
  const { text, keyboard } = await buildCurrentFront(ctx, cards, lang);
  await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
}
