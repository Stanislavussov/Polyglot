/**
 * Cards session — `fc:*` callbacks over one deck built on the SM-2 state (Task 85).
 */
import {
  buildCardsDeck,
  type CardsDeckCard,
  errorFields,
  isSupported,
  logEvent,
  type SrsRating,
  type SupportedLang,
  scheduleCardRating,
  t,
  type VocabDifficulty,
} from "@polyglot/core";
import type { InlineKeyboard } from "grammy";
import { recordMatureIfCrossed } from "../../momentum/momentum.wiring.js";
import { resolvePraiseLine } from "../../momentum/praise.footer.js";
import {
  buildFlashCardBackKeyboard,
  buildFlashCardDoneKeyboard,
  buildFlashCardFrontKeyboard,
  renderFlashCardBack,
  renderFlashCardDone,
  renderFlashCardFront,
} from "../../renderers/flashcard.renderer.js";
import type { BotContext } from "../../types.js";
import { editMessageTextOrReply } from "./edit-message.helper.js";

type CardsSession = NonNullable<BotContext["session"]["cards"]>;

/** Rows fetched per query, as a multiple of the session size: one card per entry discards rows, and the deck should still fill. */
const CANDIDATE_OVERSHOOT = 4;

/** The notification grade each rating writes, so a word keeps one grade across notifications and Cards. */
const DIFFICULTY_BY_RATING: Record<SrsRating, VocabDifficulty> = {
  again: "hard",
  hard: "hard",
  good: "normal",
  easy: "easy",
};

export async function getUserLang(ctx: BotContext): Promise<SupportedLang> {
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
    await ctx.answerCallbackQuery({ text: t("flashcardSessionExpired", lang) });
  } catch {
    /* ignore */
  }
}

/** Due cards first, topped up with practice-ahead ones; null only when there is nothing to review at all. */
export async function buildCardsSession(ctx: BotContext): Promise<CardsSession | null> {
  const { flashcardLimit } = await ctx.services.settings.getDictionaryConfig();
  const now = new Date();
  const candidates = flashcardLimit * CANDIDATE_OVERSHOOT;
  const due = await ctx.services.vocabularyRepository.findDueForSrs(ctx.user.id, now, candidates);
  let deck = buildCardsDeck(due, [], flashcardLimit);
  if (deck.length < flashcardLimit) {
    const ahead = await ctx.services.vocabularyRepository.findAheadForSrs(ctx.user.id, now, candidates);
    deck = buildCardsDeck(due, ahead, flashcardLimit);
  }
  if (deck.length === 0) return null;

  logEvent("cards.session_started", { deckSize: deck.length, ahead: deck.filter((card) => card.ahead).length });
  return { deck, currentIndex: 0, revealed: false, recalled: 0 };
}

/** Rendered with the user's card settings as they are now, so a toggle changed mid-deck applies from the next card. */
export async function buildCurrentFront(
  ctx: BotContext,
  cards: CardsSession,
  lang: SupportedLang,
): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const card = cards.deck[cards.currentIndex]!;
  const fields = await ctx.services.cardTemplateRepository.getFields(ctx.user.id);
  return {
    text: renderFlashCardFront(
      card,
      getLangCodeById(ctx, card.sourceLangId),
      getLangCodeById(ctx, card.targetLangId),
      cards.currentIndex + 1,
      cards.deck.length,
      lang,
      fields,
    ),
    keyboard: buildFlashCardFrontKeyboard(lang, card.entryId),
  };
}

async function showCurrentFront(ctx: BotContext, cards: CardsSession, lang: SupportedLang): Promise<void> {
  const { text, keyboard } = await buildCurrentFront(ctx, cards, lang);
  await editMessageTextOrReply(ctx, text, { parse_mode: "HTML", reply_markup: keyboard });
}

async function finishSession(ctx: BotContext, cards: CardsSession, lang: SupportedLang): Promise<void> {
  const reviewed = cards.deck.filter((card) => !card.retry).length;
  logEvent("cards.session_finished", {
    cards: reviewed,
    recalled: cards.recalled,
    retries: cards.deck.length - reviewed,
  });
  const matured = cards.maturedTranslationId;
  const praise = await resolvePraiseLine(ctx, lang, "flashcard_done", new Date(), {
    ...(matured !== undefined
      ? {
          matureCrossedNow: {
            translationId: matured,
            entryWord: cards.deck.find((card) => card.translationId === matured)?.original,
          },
        }
      : {}),
    hardWordRecalledToday: cards.hardRecalled === true,
  });
  const done = renderFlashCardDone(lang, { cards: reviewed, recalled: cards.recalled });
  const text = praise ? `${done}\n\n${praise}` : done;
  const { enabled: showProgress } = await ctx.services.settings.getMotivationConfig();
  ctx.session.cards = undefined;
  await editMessageTextOrReply(ctx, text, {
    parse_mode: "HTML",
    reply_markup: buildFlashCardDoneKeyboard(lang, { showProgress }),
  });
}

/**
 * Drop the current card — and a later retry of the same word — then show whatever
 * comes next: the next front or the finish screen.
 */
async function leaveCurrentCard(ctx: BotContext, cards: CardsSession, lang: SupportedLang): Promise<void> {
  const entryId = cards.deck[cards.currentIndex]?.entryId;
  cards.deck = cards.deck.filter((card, index) => index < cards.currentIndex || card.entryId !== entryId);
  cards.revealed = false;
  if (cards.deck.length === 0) {
    // Nothing reviewed to report, but the finish screen's buttons stay: a bare
    // "deleted" line left the chat with no way to a new deck.
    const { enabled: showProgress } = await ctx.services.settings.getMotivationConfig();
    ctx.session.cards = undefined;
    await editMessageTextOrReply(ctx, t("wordDeleted", lang), {
      reply_markup: buildFlashCardDoneKeyboard(lang, { showProgress }),
    });
  } else if (cards.currentIndex >= cards.deck.length) {
    await finishSession(ctx, cards, lang);
  } else {
    await showCurrentFront(ctx, cards, lang);
  }
}

export async function handleFcReveal(ctx: BotContext): Promise<void> {
  const cards = ctx.session.cards;
  const card = cards?.deck[cards.currentIndex];
  if (!cards || !card) {
    await answerExpired(ctx);
    return;
  }

  const lang = await getUserLang(ctx);
  const text = renderFlashCardBack(
    card,
    getLangCodeById(ctx, card.sourceLangId),
    getLangCodeById(ctx, card.targetLangId),
    cards.currentIndex + 1,
    cards.deck.length,
    lang,
  );
  cards.revealed = true;
  await editMessageTextOrReply(ctx, text, { parse_mode: "HTML", reply_markup: buildFlashCardBackKeyboard(lang, card) });
  await ctx.answerCallbackQuery();
}

export const FLASHCARD_RATE_PATTERN = /^fc:rate:(again|hard|good|easy):(\d+)$/;

/**
 * Everything a first presentation owes: the notification grade, the schedule, the
 * review log and the praise evidence. False only when the entry is gone. A storage
 * failure is logged and the deck carries on — as `/review` did — because a stuck
 * deck costs the user more than one lost rating.
 */
async function persistFirstRating(
  ctx: BotContext,
  cards: CardsSession,
  card: CardsDeckCard,
  rating: SrsRating,
): Promise<boolean> {
  try {
    const saved = await ctx.services.vocabularyRepository.setDifficulty(
      card.entryId,
      ctx.user.id,
      DIFFICULTY_BY_RATING[rating],
    );
    if (!saved) return false;

    // `srsDueDate` has been through jsonb and is a string by now; SM-2 never reads it.
    const next = scheduleCardRating(
      { easeFactor: card.srsEaseFactor, interval: card.srsInterval, reviewCount: card.srsReviewCount, dueDate: null },
      rating,
      card,
    );
    if (next) {
      await ctx.services.vocabularyRepository.updateSrsState(card.translationId, next);
      const crossed = await recordMatureIfCrossed(ctx.services.momentumService, {
        userId: ctx.user.id,
        entryId: card.entryId,
        translationId: card.translationId,
        interval: next.interval,
      });
      if (crossed) cards.maturedTranslationId = card.translationId;
    }
    // "You marked this one hard — and today you knew it": only a correct recall counts.
    if (card.difficulty === "hard" && (rating === "good" || rating === "easy")) cards.hardRecalled = true;
    await ctx.services.wordReviewRepository.logReview(ctx.user.id, card.entryId, "flashcard");
    // The scheduling decision itself: a card resurfacing too soon or never again is
    // only explainable from what this rating wrote, or that it wrote nothing.
    logEvent("cards.card_rated", {
      rating,
      ahead: card.ahead,
      entryId: card.entryId,
      translationId: card.translationId,
      previousInterval: card.srsInterval,
      scheduled: next !== null,
      ...(next ? { nextInterval: next.interval, easeFactor: next.easeFactor, reviewCount: next.reviewCount } : {}),
      position: cards.currentIndex + 1,
      deckSize: cards.deck.length,
    });
  } catch (err) {
    logEvent(
      "cards.rating_persist_failed",
      { rating, translationId: card.translationId, ...errorFields(err) },
      "error",
    );
  }
  return true;
}

export async function handleFcRate(ctx: BotContext): Promise<void> {
  const rating = ctx.match?.[1] as SrsRating | undefined;
  const translationId = Number(ctx.match?.[2]);
  const cards = ctx.session.cards;
  const card = cards?.deck[cards.currentIndex];
  // A repeat carries its original's translation id, so only the reveal tells a second
  // tap on the same Again apart from a rating of the repeat.
  if (!rating || !cards || !card || !cards.revealed || card.translationId !== translationId) {
    await answerExpired(ctx);
    return;
  }

  const lang = await getUserLang(ctx);
  if (!card.retry) {
    if (!(await persistFirstRating(ctx, cards, card, rating))) {
      // Removed elsewhere since the deck was built: the card is dead weight.
      await leaveCurrentCard(ctx, cards, lang);
      await ctx.answerCallbackQuery({ text: t("wordDeleted", lang) });
      return;
    }
    if (rating === "good" || rating === "easy") cards.recalled++;
    // Not ahead any more: this rating has just set its schedule.
    if (rating === "again") cards.deck.push({ ...card, retry: true, ahead: false });
  }

  cards.currentIndex++;
  cards.revealed = false;
  if (cards.currentIndex >= cards.deck.length) {
    await finishSession(ctx, cards, lang);
  } else {
    await showCurrentFront(ctx, cards, lang);
  }
  await ctx.answerCallbackQuery();
}

export const FLASHCARD_DELETE_PATTERN = /^fc:del:(\d+)$/;

/**
 * Remove the current word from the dictionary for good and carry on with the deck.
 * Soft delete, like the notification's remove button: re-saving the word restores it.
 */
export async function handleFcDelete(ctx: BotContext): Promise<void> {
  const entryId = Number(ctx.match?.[1]);
  const cards = ctx.session.cards;
  const card = cards?.deck[cards.currentIndex];
  if (!cards || !card || card.entryId !== entryId) {
    await answerExpired(ctx);
    return;
  }

  const lang = await getUserLang(ctx);
  // A false result means the word was already gone; either way it leaves the deck.
  await ctx.services.vocabularyRepository.delete(entryId, ctx.user.id);
  await leaveCurrentCard(ctx, cards, lang);
  await ctx.answerCallbackQuery({ text: t("wordDeleted", lang) });
}

export async function handleFcRestart(ctx: BotContext): Promise<void> {
  const lang = await getUserLang(ctx);
  const cards = await buildCardsSession(ctx);
  ctx.session.cards = cards ?? undefined;
  if (cards) {
    await showCurrentFront(ctx, cards, lang);
  } else {
    await editMessageTextOrReply(ctx, t("cardsNoSavedWords", lang));
  }
  await ctx.answerCallbackQuery();
}

export async function handleFcQuit(ctx: BotContext): Promise<void> {
  const lang = await getUserLang(ctx);
  ctx.session.cards = undefined;
  await editMessageTextOrReply(ctx, t("flashcardQuit", lang));
  await ctx.answerCallbackQuery();
}

export async function handleFcClose(ctx: BotContext): Promise<void> {
  ctx.session.cards = undefined;
  try {
    await ctx.deleteMessage();
  } catch {
    /* ignore */
  }
  await ctx.answerCallbackQuery();
}

/**
 * Buttons of the decks before Task 85 — `/review`'s `srs:*` and the old flashcard's
 * next/done/start and grades — still sit in chat history. Unanswered, they spin forever.
 */
export const LEGACY_CARD_CALLBACK_PATTERN = /^(?:srs:|fc:(?:next|done|start)$|fc:fb:)/;

export async function handleLegacyCardCallback(ctx: BotContext): Promise<void> {
  await answerExpired(ctx);
}
