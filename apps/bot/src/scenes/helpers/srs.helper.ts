import {
  applySm2Review,
  errorFields,
  isSupported,
  logEvent,
  type SrsDueVocabularyCard,
  type SrsRating,
  type SupportedLang,
  t,
} from "@polyglot/core";
import type { InlineKeyboard } from "grammy";
import { recordMatureIfCrossed } from "../../momentum/momentum.wiring.js";
import { resolvePraiseLine } from "../../momentum/praise.footer.js";
import {
  buildSrsBackKeyboard,
  buildSrsDoneKeyboard,
  buildSrsFrontKeyboard,
  renderSrsBack,
  renderSrsFront,
} from "../../renderers/srs.renderer.js";
import type { BotContext } from "../../types.js";
import { editMessageTextOrReply } from "./edit-message.helper.js";

export const SRS_SESSION_LIMIT = 20;

type SrsSession = NonNullable<BotContext["session"]["srs"]>;

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

/** The front of `deck[index]`, rendered with the user's card settings as they are now. */
export async function buildSrsFront(
  ctx: BotContext,
  deck: readonly SrsDueVocabularyCard[],
  index: number,
  lang: SupportedLang,
): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const card = deck[index]!;
  const fields = await ctx.services.cardTemplateRepository.getFields(ctx.user.id);
  return {
    text: renderSrsFront(
      card,
      getLangCodeById(ctx, card.sourceLangId),
      getLangCodeById(ctx, card.targetLangId),
      index + 1,
      deck.length,
      lang,
      fields,
    ),
    keyboard: buildSrsFrontKeyboard(lang, card.entryId),
  };
}

async function showCurrentFront(ctx: BotContext, srs: SrsSession, lang: SupportedLang): Promise<void> {
  const { text, keyboard } = await buildSrsFront(ctx, srs.deck, srs.currentIndex, lang);
  try {
    await editMessageTextOrReply(ctx, text, { parse_mode: "HTML", reply_markup: keyboard });
  } catch {
    /* ignore */
  }
}

async function finishSession(ctx: BotContext, srs: SrsSession, lang: SupportedLang): Promise<void> {
  logEvent("srs.session_finished", { reviewed: srs.deck.length });
  const praise = await resolvePraiseLine(ctx, lang, "srs_done", new Date(), {
    ...(srs.maturedTranslationId !== undefined
      ? {
          matureCrossedNow: {
            translationId: srs.maturedTranslationId,
            entryWord: srs.deck.find((c) => c.translationId === srs.maturedTranslationId)?.original,
          },
        }
      : {}),
    hardWordRecalledToday: srs.hardRecalled === true,
  });
  const done = t("srsDone", lang, { count: String(srs.deck.length) });
  const text = praise ? `${done}\n\n${praise}` : done;
  const { enabled: showProgress } = await ctx.services.settings.getMotivationConfig();
  ctx.session.srs = undefined;
  try {
    await editMessageTextOrReply(ctx, text, {
      parse_mode: "HTML",
      reply_markup: buildSrsDoneKeyboard(lang, { showProgress }),
    });
  } catch {
    /* ignore */
  }
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
    await editMessageTextOrReply(ctx, text, {
      parse_mode: "HTML",
      reply_markup: buildSrsBackKeyboard(lang, card.entryId),
    });
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
    if (
      await recordMatureIfCrossed(ctx.services.momentumService, {
        userId: ctx.user.id,
        entryId: card.entryId,
        translationId: card.translationId,
        interval: nextState.interval,
      })
    ) {
      srs.maturedTranslationId = card.translationId;
    }
    // "You marked this one hard — and today you knew it": only a correct recall counts.
    if (card.difficulty === "hard" && (rating === "good" || rating === "easy")) {
      srs.hardRecalled = true;
    }
    await ctx.services.wordReviewRepository.logReview(ctx.user.id, card.entryId, "srs");
    // The scheduling decision itself: a card resurfacing too soon or never
    // again is only explainable from the interval/ease the rating produced.
    logEvent("srs.card_rated", {
      rating,
      entryId: card.entryId,
      translationId: card.translationId,
      previousInterval: card.srsInterval,
      nextInterval: nextState.interval,
      easeFactor: nextState.easeFactor,
      reviewCount: nextState.reviewCount,
      position: srs.currentIndex + 1,
      deckSize: srs.deck.length,
    });
  } catch (err) {
    logEvent("srs.rating_persist_failed", { rating, translationId: card.translationId, ...errorFields(err) }, "error");
  }

  const lang = await getUserLang(ctx);
  srs.currentIndex++;

  if (srs.currentIndex >= srs.deck.length) {
    await finishSession(ctx, srs, lang);
  } else {
    await showCurrentFront(ctx, srs, lang);
  }
  await ctx.answerCallbackQuery({ text: t("srsScheduled", lang) });
}

export const SRS_DELETE_PATTERN = /^srs:del:(\d+)$/;

/**
 * Remove the current word from the dictionary and carry on. A word is reviewed
 * once per target language, so every card of that entry leaves the deck — the
 * next one would otherwise ask about the word just removed.
 */
export async function handleSrsDelete(ctx: BotContext): Promise<void> {
  const entryId = Number(ctx.match?.[1]);
  const card = currentCard(ctx);
  const srs = ctx.session.srs;
  // A button left on an older card must not remove the word the session moved on to.
  if (!card || !srs || card.entryId !== entryId) return void answerExpired(ctx);

  const lang = await getUserLang(ctx);
  // A false result means the word was already gone; either way it leaves the deck.
  await ctx.services.vocabularyRepository.delete(entryId, ctx.user.id);
  const removedBefore = srs.deck.slice(0, srs.currentIndex).filter((c) => c.entryId === entryId).length;
  srs.deck = srs.deck.filter((c) => c.entryId !== entryId);
  srs.currentIndex -= removedBefore;

  if (srs.deck.length === 0) {
    ctx.session.srs = undefined;
    // The finish screen's buttons stay: a bare "deleted" line is a dead end.
    const { enabled: showProgress } = await ctx.services.settings.getMotivationConfig();
    try {
      await editMessageTextOrReply(ctx, t("wordDeleted", lang), {
        reply_markup: buildSrsDoneKeyboard(lang, { showProgress }),
      });
    } catch {
      /* ignore */
    }
  } else if (srs.currentIndex >= srs.deck.length) {
    await finishSession(ctx, srs, lang);
  } else {
    await showCurrentFront(ctx, srs, lang);
  }
  await ctx.answerCallbackQuery({ text: t("wordDeleted", lang) });
}

export async function handleSrsRestart(ctx: BotContext): Promise<void> {
  const lang = await getUserLang(ctx);
  const deck = await ctx.services.vocabularyRepository.findDueForSrs(ctx.user.id, new Date(), SRS_SESSION_LIMIT);

  if (deck.length === 0) {
    ctx.session.srs = undefined;
    try {
      await editMessageTextOrReply(ctx, t("srsEmpty", lang));
    } catch {
      /* ignore */
    }
    await ctx.answerCallbackQuery();
    return;
  }

  const srs: SrsSession = { deck, currentIndex: 0 };
  ctx.session.srs = srs;
  await showCurrentFront(ctx, srs, lang);
  await ctx.answerCallbackQuery();
}

export async function handleSrsQuit(ctx: BotContext): Promise<void> {
  const lang = await getUserLang(ctx);
  ctx.session.srs = undefined;
  try {
    await editMessageTextOrReply(ctx, t("srsQuit", lang));
  } catch {
    /* ignore */
  }
  await ctx.answerCallbackQuery();
}

export async function handleSrsClose(ctx: BotContext): Promise<void> {
  ctx.session.srs = undefined;
  try {
    await ctx.deleteMessage();
  } catch {
    /* ignore */
  }
  await ctx.answerCallbackQuery();
}
