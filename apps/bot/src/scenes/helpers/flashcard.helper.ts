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
  type SrsReviewResult,
  type SupportedLang,
  scheduleCardRating,
  t,
  type VocabDifficulty,
  type VocabularyEntryWithTranslations,
} from "@polyglot/core";
import type { InlineKeyboard } from "grammy";
import { recordMatureIfCrossed } from "../../momentum/momentum.wiring.js";
import { resolvePraiseLine } from "../../momentum/praise.footer.js";
import {
  buildFlashCardBackKeyboard,
  buildFlashCardDoneKeyboard,
  buildFlashCardFrontKeyboard,
  renderFlashCardBack,
  renderFlashCardBackFromCard,
  renderFlashCardDone,
  renderFlashCardFront,
} from "../../renderers/flashcard.renderer.js";
import type { BotContext } from "../../types.js";
import { makeLangCodeResolver, resolveLanguageOrder } from "../../utils/language-order.js";
import { toTranslateOutput } from "../../utils/vocabulary-mapper.js";
import { buildCardKeyboard } from "./card-keyboard.js";
import { editMessageTextOrReply } from "./edit-message.helper.js";
import { setTranslationEntry } from "./translation-map.helper.js";

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

/**
 * `findById` is not owner-scoped, so ownership is checked here — the same pair
 * the dictionary uses (`getOwnedEntry`). A soft-deleted entry counts as gone.
 */
async function loadOwnedEntry(ctx: BotContext, entryId: number): Promise<VocabularyEntryWithTranslations | null> {
  const entry = await ctx.services.vocabularyRepository.findById(entryId);
  if (!entry || entry.userId !== ctx.user.id || !entry.isActive) return null;
  return entry;
}

/**
 * The revealed card as an ordinary card: the session entry a freshly translated
 * word gets, so Explore, Save, the mentor and the rest work on a reviewed word
 * too. `reviewCard` is what keeps the deck's own buttons on it through every
 * later rebuild of the keyboard (`card-keyboard.ts`).
 */
function reviewCardEntry(
  ctx: BotContext,
  card: CardsDeckCard,
  entry: VocabularyEntryWithTranslations,
): NonNullable<BotContext["session"]["translationMap"]>[string] | null {
  const output = toTranslateOutput(entry, makeLangCodeResolver(ctx));
  if (!output) return null;
  return {
    output,
    inputType: entry.inputType,
    savedWordId: entry.id,
    reviewCard: { entryId: card.entryId, translationId: card.translationId },
  };
}

export async function handleFcReveal(ctx: BotContext): Promise<void> {
  const cards = ctx.session.cards;
  const card = cards?.deck[cards.currentIndex];
  if (!cards || !card) {
    await answerExpired(ctx);
    return;
  }

  const lang = await getUserLang(ctx);
  const [entry, order] = await Promise.all([loadOwnedEntry(ctx, card.entryId), resolveLanguageOrder(ctx)]);
  const text = entry
    ? renderFlashCardBack(entry, makeLangCodeResolver(ctx), cards.currentIndex + 1, cards.deck.length, lang, order)
    : renderFlashCardBackFromCard(
        card,
        getLangCodeById(ctx, card.sourceLangId),
        getLangCodeById(ctx, card.targetLangId),
        cards.currentIndex + 1,
        cards.deck.length,
        lang,
      );

  const cardEntry = entry ? reviewCardEntry(ctx, card, entry) : null;
  const nativeLang = order.nativeLang ?? cardEntry?.output.sourceLang ?? getLangCodeById(ctx, card.sourceLangId);
  // The `tr:*` buttons address their card by message id, so the card's state is
  // filed under the message the reveal actually lands on.
  const msgId = ctx.callbackQuery?.message?.message_id;
  /** File the card under a message id, and build the keyboard that addresses it. */
  const attachCardTo = async (id: number): Promise<InlineKeyboard> => {
    if (!cardEntry) return buildFlashCardBackKeyboard(lang, card);
    setTranslationEntry(ctx.session, id, cardEntry);
    return buildCardKeyboard(ctx, cardEntry, id, lang, nativeLang);
  };

  cards.revealed = true;
  const resent = await editMessageTextOrReply(ctx, text, {
    parse_mode: "HTML",
    reply_markup: msgId === undefined ? buildFlashCardBackKeyboard(lang, card) : await attachCardTo(msgId),
  });
  if (cardEntry && resent) {
    // Past Telegram's 48-hour edit limit the reveal could not edit in place and a
    // fresh message now owns the card; its actions have to address that one.
    try {
      await ctx.api.editMessageReplyMarkup(ctx.chat!.id, resent.message_id, {
        reply_markup: await attachCardTo(resent.message_id),
      });
    } catch (err) {
      // The ratings are already on screen; only the action menu was lost, and a
      // failed reveal would cost the reader the card itself.
      logEvent("cards.card_actions_failed", { entryId: card.entryId, ...errorFields(err) }, "warn");
    }
  }
  await ctx.answerCallbackQuery();
}

export const FLASHCARD_RATE_PATTERN = /^fc:rate:(again|hard|good|easy):(\d+)$/;

/**
 * A rating grades the word, not the row the deck happened to draw.
 *
 * The deck takes at most one card per entry and the back shows every language, so
 * one rating covers all of them. Each row is scheduled from its *own* SM-2 state —
 * copying the rated row's numbers across would reset schedules the reader earned
 * in another language — and a row still ahead of its due date is treated as
 * practice ahead, exactly as the deck itself classifies it.
 *
 * Returns the state written per translation id; rows SM-2 declined to touch are absent.
 */
async function rescheduleEntry(
  ctx: BotContext,
  card: CardsDeckCard,
  rating: SrsRating,
): Promise<Map<number, SrsReviewResult>> {
  const now = new Date();
  const rows = await ctx.services.vocabularyRepository.findEntrySrsRows(ctx.user.id, card.entryId);
  const written = new Map<number, SrsReviewResult>();
  for (const row of rows) {
    const next = scheduleCardRating(
      // `dueDate` is unused by SM-2; `ahead` above carries everything it says.
      { easeFactor: row.srsEaseFactor, interval: row.srsInterval, reviewCount: row.srsReviewCount, dueDate: null },
      rating,
      { ahead: row.srsDueDate !== null && row.srsDueDate.getTime() > now.getTime(), retry: card.retry },
      now,
    );
    if (!next) continue;
    await ctx.services.vocabularyRepository.updateSrsState(row.translationId, next);
    written.set(row.translationId, next);
  }
  return written;
}

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

    const next = await rescheduleEntry(ctx, card, rating);
    const own = next.get(card.translationId);
    if (own) {
      const crossed = await recordMatureIfCrossed(ctx.services.momentumService, {
        userId: ctx.user.id,
        entryId: card.entryId,
        translationId: card.translationId,
        interval: own.interval,
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
      scheduled: next.size,
      ...(own ? { nextInterval: own.interval, easeFactor: own.easeFactor, reviewCount: own.reviewCount } : {}),
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
