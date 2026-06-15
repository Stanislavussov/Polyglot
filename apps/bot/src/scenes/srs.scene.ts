import type { SupportedLang } from "@polyglot/core";
import { isSupported, t } from "@polyglot/core";
import { buildSrsFrontKeyboard, renderSrsFront } from "../renderers/srs.renderer.js";
import type { BotContext } from "../types.js";
import { trackTechnicalMessage } from "../utils/message-cleanup.js";

const SRS_SESSION_LIMIT = 20;

async function getUserLang(ctx: BotContext): Promise<SupportedLang> {
  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const lang = settings?.interfaceLang;
  return lang && isSupported(lang) ? lang : "en";
}

function getLangCodeById(ctx: BotContext, id: number): string {
  return ctx.services.languageCache.getAllLangs().find((l) => l.id === id)?.code ?? "unknown";
}

export async function handleReviewCommand(ctx: BotContext): Promise<void> {
  const lang = await getUserLang(ctx);
  const deck = await ctx.services.vocabularyRepository.findDueForSrs(ctx.user.id, new Date(), SRS_SESSION_LIMIT);

  if (deck.length === 0) {
    await ctx.reply(t("srsEmpty", lang));
    return;
  }

  ctx.session.srs = {
    deck,
    currentIndex: 0,
  };

  const card = deck[0]!;
  const text = renderSrsFront(
    card,
    getLangCodeById(ctx, card.sourceLangId),
    getLangCodeById(ctx, card.targetLangId),
    1,
    deck.length,
    lang,
  );
  const msg = await ctx.reply(text, { parse_mode: "HTML", reply_markup: buildSrsFrontKeyboard(lang) });
  trackTechnicalMessage(ctx, msg.message_id);
  ctx.session.srs.cardMsgId = msg.message_id;
}

export { SRS_SESSION_LIMIT };
