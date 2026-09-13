import type { SupportedLang } from "@polyglot/core";
import { isSupported, t } from "@polyglot/core";
import type { BotContext } from "../types.js";
import { buildSrsFront, SRS_SESSION_LIMIT } from "./helpers/srs.helper.js";

async function getUserLang(ctx: BotContext): Promise<SupportedLang> {
  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const lang = settings?.interfaceLang;
  return lang && isSupported(lang) ? lang : "en";
}

export async function handleReviewCommand(ctx: BotContext): Promise<void> {
  const lang = await getUserLang(ctx);
  const deck = await ctx.services.vocabularyRepository.findDueForSrs(ctx.user.id, new Date(), SRS_SESSION_LIMIT);

  if (deck.length === 0) {
    // "Nothing due" and "nothing saved" are different states that used to share
    // one message. `srsEmpty` opens with ✅ and reads as "you're all caught up" —
    // which is right for a returning user, and actively misleading for someone
    // with an empty dictionary, who is told they finished something they never
    // started. Onboarding makes that the common case: the final screen offers a
    // 🎯 Practice button to a user whose dictionary is necessarily empty.
    const saved = await ctx.services.vocabularyRepository.countByUser(ctx.user.id);
    await ctx.reply(t(saved === 0 ? "srsNoSavedWords" : "srsEmpty", lang));
    return;
  }

  ctx.session.srs = {
    deck,
    currentIndex: 0,
  };

  const { text, keyboard } = await buildSrsFront(ctx, deck, 0, lang);
  const msg = await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
  ctx.session.srs.cardMsgId = msg.message_id;
}
