import { applySm2Review, isSupported, logger, type SrsRating, type SupportedLang, t } from "@polyglot/core";
import {
  buildSrsBackKeyboard,
  buildSrsDoneKeyboard,
  buildSrsFrontKeyboard,
  renderSrsBack,
  renderSrsFront,
} from "../../renderers/srs.renderer.js";
import type { BotContext } from "../../types.js";
import { cleanupTechnicalMessages } from "../../utils/message-cleanup.js";
import { SRS_SESSION_LIMIT } from "../srs.scene.js";

async function getUserLang(ctx: BotContext): Promise<SupportedLang> {
  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const lang = settings?.interfaceLang;
  return lang && isSupported(lang) ? lang : "en";
}

function getLangCodeById(ctx: BotContext, id: number): string {
  return ctx.services.languageCache.getAllLangs().find((l) => l.id === id)?.code ?? "unknown";
}

async function answerExpired(ctx: BotContext): Promise<void> {
  const lang = await getUserLang(ctx);
  try {
    await ctx.answerCallbackQuery({ text: t("srsSessionExpired", lang) });
  } catch {
    /* ignore */
  }
}

function currentCard(ctx: BotContext) {
  const srs = ctx.session.srs;
  if (!srs) return undefined;
  return srs.deck[srs.currentIndex];
}

export async function handleSrsReveal(ctx: BotContext): Promise<void> {
  const card = currentCard(ctx);
  const srs = ctx.session.srs;
  if (!card || !srs) return void answerExpired(ctx);

  const lang = await getUserLang(ctx);
  const text = renderSrsBack(
    card,
    getLangCodeById(ctx, card.sourceLangId),
    getLangCodeById(ctx, card.targetLangId),
    srs.currentIndex + 1,
    srs.deck.length,
    lang,
  );

  try {
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: buildSrsBackKeyboard(lang) });
  } catch {
    /* ignore */
  }
  await ctx.answerCallbackQuery();
}

export async function handleSrsRate(ctx: BotContext): Promise<void> {
  const rating = ctx.match?.[1] as SrsRating | undefined;
  if (!rating) return void answerExpired(ctx);

  const card = currentCard(ctx);
  const srs = ctx.session.srs;
  if (!card || !srs) return void answerExpired(ctx);

  const nextState = applySm2Review(
    {
      easeFactor: card.srsEaseFactor,
      interval: card.srsInterval,
      dueDate: card.srsDueDate,
      reviewCount: card.srsReviewCount,
    },
    rating,
  );

  try {
    await ctx.services.vocabularyRepository.updateSrsState(card.translationId, nextState);
    await ctx.services.wordReviewRepository.logReview(ctx.user.id, card.entryId, "srs");
  } catch (err) {
    logger.error({ err, userId: ctx.user.id, translationId: card.translationId }, "Failed to update SRS review");
  }

  const lang = await getUserLang(ctx);
  srs.currentIndex++;

  if (srs.currentIndex >= srs.deck.length) {
    const text = t("srsDone", lang, { count: String(srs.deck.length) });
    ctx.session.srs = undefined;
    await cleanupTechnicalMessages(ctx);
    try {
      await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: buildSrsDoneKeyboard(lang) });
    } catch {
      /* ignore */
    }
    await ctx.answerCallbackQuery({ text: t("srsScheduled", lang) });
    return;
  }

  const nextCard = srs.deck[srs.currentIndex]!;
  const text = renderSrsFront(
    nextCard,
    getLangCodeById(ctx, nextCard.sourceLangId),
    getLangCodeById(ctx, nextCard.targetLangId),
    srs.currentIndex + 1,
    srs.deck.length,
    lang,
  );

  try {
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: buildSrsFrontKeyboard(lang) });
  } catch {
    /* ignore */
  }
  await ctx.answerCallbackQuery({ text: t("srsScheduled", lang) });
}

export async function handleSrsRestart(ctx: BotContext): Promise<void> {
  const lang = await getUserLang(ctx);
  const deck = await ctx.services.vocabularyRepository.findDueForSrs(ctx.user.id, new Date(), SRS_SESSION_LIMIT);

  if (deck.length === 0) {
    ctx.session.srs = undefined;
    try {
      await ctx.editMessageText(t("srsEmpty", lang));
    } catch {
      /* ignore */
    }
    await ctx.answerCallbackQuery();
    return;
  }

  ctx.session.srs = { deck, currentIndex: 0 };
  const card = deck[0]!;
  const text = renderSrsFront(
    card,
    getLangCodeById(ctx, card.sourceLangId),
    getLangCodeById(ctx, card.targetLangId),
    1,
    deck.length,
    lang,
  );

  try {
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: buildSrsFrontKeyboard(lang) });
  } catch {
    /* ignore */
  }
  await ctx.answerCallbackQuery();
}

export async function handleSrsQuit(ctx: BotContext): Promise<void> {
  const lang = await getUserLang(ctx);
  ctx.session.srs = undefined;
  await cleanupTechnicalMessages(ctx);
  try {
    await ctx.editMessageText(t("srsQuit", lang));
  } catch {
    /* ignore */
  }
  await ctx.answerCallbackQuery();
}

export async function handleSrsClose(ctx: BotContext): Promise<void> {
  ctx.session.srs = undefined;
  await cleanupTechnicalMessages(ctx);
  try {
    await ctx.deleteMessage();
  } catch {
    /* ignore */
  }
  await ctx.answerCallbackQuery();
}
