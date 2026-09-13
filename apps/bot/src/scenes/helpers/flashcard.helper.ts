/**
 * Flashcard callback handlers — fc:* callbacks for the flash card session.
 *
 * Handles: start, reveal, next, grade, delete, done, restart, quit, close.
 * Review logging is best-effort (never blocks UX).
 */
import type { DictionaryPipelineDeps, I18nKey, SupportedLang, VocabDifficulty, WordDisplayData } from "@polyglot/core";
import { createDictionaryPipeline, FLASHCARD_CONFIG, isSupported, logEvent, logger, t } from "@polyglot/core";
import type { InlineKeyboard } from "grammy";
import { resolvePraiseLine } from "../../momentum/praise.footer.js";
import {
  buildFlashCardBackKeyboard,
  buildFlashCardDoneKeyboard,
  buildFlashCardFrontKeyboard,
  renderFlashCardBack,
  renderFlashCardFront,
} from "../../renderers/flashcard.renderer.js";
import type { BotContext } from "../../types.js";
import { resolveLanguageOrder } from "../../utils/language-order.js";
import { editMessageTextOrReply } from "./edit-message.helper.js";

/* ── Language resolution ───────────────────────────────────────── */

/**
 * Get language code by ID using the injected language cache service.
 */
function getLangCodeById(ctx: BotContext, id: number): string | undefined {
  const all = ctx.services.languageCache.getAllLangs();
  return all.find((l) => l.id === id)?.code;
}

async function getUserLang(ctx: BotContext): Promise<SupportedLang> {
  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const lang = settings?.interfaceLang;
  return lang && isSupported(lang) ? lang : "en";
}

/* ── Pipeline deps factory ─────────────────────────────────────── */

/**
 * Creates pipeline deps that use ctx.services for data access.
 * Called per-request to ensure fresh ctx.services access.
 */
function createPipelineDeps(ctx: BotContext): DictionaryPipelineDeps {
  return {
    findEntriesByUser: async (userId) => {
      const entries = await ctx.services.vocabularyRepository.findByUserWithSourceLang(userId, (id) =>
        getLangCodeById(ctx, id),
      );
      return entries.map((e) => ({
        id: e.id,
        original: e.original,
        nativeMeaning: e.nativeMeaning,
        sourceUsage: e.sourceUsage,
        sourceLangId: e.sourceLangId,
        sourceLangCode: e.sourceLangCode,
        inputType: e.inputType,
        emoji: e.emoji,
        createdAt: e.createdAt,
        translations: e.translations.map((tr) => ({
          targetLangCode: getLangCodeById(ctx, tr.targetLangId) ?? "unknown",
          text: tr.text,
          expressionType: tr.expressionType,
          equivalentNote: tr.equivalentNote,
          usageNote: tr.usageNote,
          connotationWarning: tr.connotationWarning,
          details: tr.details,
        })),
      }));
    },
    getReviewCounts: async (userId) => {
      return ctx.services.wordReviewRepository.getReviewCounts(userId);
    },
  };
}

/** Exported for use by flashcard.scene.ts. */
export function getPipeline(ctx: BotContext) {
  return createDictionaryPipeline(createPipelineDeps(ctx));
}

/* ── Shared helpers ────────────────────────────────────────────── */

async function answerExpired(ctx: BotContext): Promise<void> {
  const lang = await getUserLang(ctx);
  try {
    await ctx.answerCallbackQuery({ text: t("flashcardSessionExpired", lang) });
  } catch {
    /* ignore */
  }
}

function logReviewSafe(ctx: BotContext, entryId: number): void {
  ctx.services.wordReviewRepository.logReview(ctx.user.id, entryId, "flashcard").catch((err) => {
    logger.error({ err, userId: ctx.user.id, entryId }, "Failed to log flashcard review");
  });
}

/**
 * The front of `deck[index]`, rendered with the user's card settings — read on
 * every render rather than stored in the session, so a toggle changed mid-deck
 * applies from the next card.
 */
export async function buildFlashCardFront(
  ctx: BotContext,
  deck: readonly WordDisplayData[],
  index: number,
  lang: SupportedLang,
): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const word = deck[index]!;
  const fields = await ctx.services.cardTemplateRepository.getFields(ctx.user.id);
  return {
    text: renderFlashCardFront(word, index + 1, deck.length, lang, fields),
    keyboard: buildFlashCardFrontKeyboard(lang, word.id),
  };
}

type FlashcardSession = NonNullable<BotContext["session"]["flashcard"]>;

async function showCurrentFront(ctx: BotContext, fc: FlashcardSession, lang: SupportedLang): Promise<void> {
  const { text, keyboard } = await buildFlashCardFront(ctx, fc.deck, fc.currentIndex, lang);
  await editMessageTextOrReply(ctx, text, { parse_mode: "HTML", reply_markup: keyboard });
}

async function finishSession(ctx: BotContext, fc: FlashcardSession, lang: SupportedLang): Promise<void> {
  logEvent("flashcard.session_finished", { deckSize: fc.deck.length, reviewed: fc.currentIndex + 1 });
  // No SM-2 update here, so neither `mature` nor "recalled a hard word" can be
  // earned in a flashcard session — the only evidence this surface can carry is a
  // dictionary milestone, which `resolvePraiseLine` reads for itself.
  const praise = await resolvePraiseLine(ctx, lang, "flashcard_done", new Date());
  const done = t("flashcardDone", lang, { count: String(fc.deck.length) });
  const text = praise ? `${done}\n\n${praise}` : done;
  const { enabled: showProgress } = await ctx.services.settings.getMotivationConfig();
  const kb = buildFlashCardDoneKeyboard(lang, { showProgress });

  await editMessageTextOrReply(ctx, text, { parse_mode: "HTML", reply_markup: kb });
  ctx.session.flashcard = undefined;
}

/**
 * The session and the card the tapped button belongs to, or null when that
 * button is left over from a card the session has already moved past.
 */
function tappedCard(ctx: BotContext, entryId: number): { fc: FlashcardSession; word: WordDisplayData } | null {
  const fc = ctx.session.flashcard;
  const word = fc?.deck[fc.currentIndex];
  return fc && word && word.id === entryId ? { fc, word } : null;
}

/* ── fc:start ──────────────────────────────────────────────────── */

export async function handleFcStart(ctx: BotContext): Promise<void> {
  const fc = ctx.session.flashcard;
  if (!fc) return void answerExpired(ctx);

  logEvent("flashcard.session_started", { deckSize: fc.deck.length });
  const lang = await getUserLang(ctx);
  fc.currentIndex = 0;
  await showCurrentFront(ctx, fc, lang);
  await ctx.answerCallbackQuery();
}

/* ── fc:reveal ─────────────────────────────────────────────────── */

export async function handleFcReveal(ctx: BotContext): Promise<void> {
  const fc = ctx.session.flashcard;
  if (!fc) return void answerExpired(ctx);

  const lang = await getUserLang(ctx);
  const word = fc.deck[fc.currentIndex]!;
  const isLast = fc.currentIndex >= fc.deck.length - 1;
  const text = renderFlashCardBack(word, fc.currentIndex + 1, fc.deck.length, lang, await resolveLanguageOrder(ctx));
  const kb = buildFlashCardBackKeyboard(isLast, lang, word.id);

  await editMessageTextOrReply(ctx, text, { parse_mode: "HTML", reply_markup: kb });
  await ctx.answerCallbackQuery();
}

/* ── fc:next ───────────────────────────────────────────────────── */

export async function handleFcNext(ctx: BotContext): Promise<void> {
  const fc = ctx.session.flashcard;
  if (!fc) return void answerExpired(ctx);

  const lang = await getUserLang(ctx);
  const currentWord = fc.deck[fc.currentIndex];
  if (currentWord) logReviewSafe(ctx, currentWord.id);

  fc.currentIndex++;
  await showCurrentFront(ctx, fc, lang);
  await ctx.answerCallbackQuery();
}

/* ── fc:fb:{grade}:{entryId} ───────────────────────────────────── */

const GRADE_TOASTS: Record<VocabDifficulty, I18nKey> = {
  hard: "notifFbHardDone",
  normal: "notifFbNormalDone",
  easy: "notifFbEasyDone",
};

export const FLASHCARD_GRADE_PATTERN = /^fc:fb:(hard|normal|easy):(\d+)$/;

/**
 * Grade the revealed word and move on. The grade is the notification grade —
 * the same `difficulty` column — so "hard" here makes the word come back more
 * often in daily notifications, exactly as tapping it on a notification does.
 */
export async function handleFcGrade(ctx: BotContext): Promise<void> {
  const grade = ctx.match?.[1] as VocabDifficulty | undefined;
  const entryId = Number(ctx.match?.[2]);
  const tapped = grade ? tappedCard(ctx, entryId) : null;
  if (!grade || !tapped) return void answerExpired(ctx);
  const { fc, word } = tapped;

  const lang = await getUserLang(ctx);
  const saved = await ctx.services.vocabularyRepository.setDifficulty(word.id, ctx.user.id, grade);
  if (!saved) {
    // Removed from the dictionary elsewhere since the deck was built.
    await ctx.answerCallbackQuery({ text: t("noResults", lang) });
    return;
  }
  logReviewSafe(ctx, word.id);

  if (fc.currentIndex >= fc.deck.length - 1) {
    await finishSession(ctx, fc, lang);
  } else {
    fc.currentIndex++;
    await showCurrentFront(ctx, fc, lang);
  }
  await ctx.answerCallbackQuery({ text: t(GRADE_TOASTS[grade], lang) });
}

/* ── fc:del:{entryId} ──────────────────────────────────────────── */

export const FLASHCARD_DELETE_PATTERN = /^fc:del:(\d+)$/;

/**
 * Remove the current word from the dictionary for good and carry on with the
 * deck. Soft delete, like the notification's remove button: the word leaves every
 * dictionary, notifications and reviews, and re-saving it later restores it.
 */
export async function handleFcDelete(ctx: BotContext): Promise<void> {
  const tapped = tappedCard(ctx, Number(ctx.match?.[1]));
  if (!tapped) return void answerExpired(ctx);
  const { fc, word } = tapped;

  const lang = await getUserLang(ctx);
  // A false result means the word was already gone; either way it leaves the deck.
  await ctx.services.vocabularyRepository.delete(word.id, ctx.user.id);
  fc.deck.splice(fc.currentIndex, 1);

  if (fc.deck.length === 0) {
    await editMessageTextOrReply(ctx, t("wordDeleted", lang));
    ctx.session.flashcard = undefined;
  } else if (fc.currentIndex >= fc.deck.length) {
    fc.currentIndex = fc.deck.length - 1;
    await finishSession(ctx, fc, lang);
  } else {
    await showCurrentFront(ctx, fc, lang);
  }
  await ctx.answerCallbackQuery({ text: t("wordDeleted", lang) });
}

/* ── fc:done ───────────────────────────────────────────────────── */

export async function handleFcDone(ctx: BotContext): Promise<void> {
  const fc = ctx.session.flashcard;
  if (!fc) return void answerExpired(ctx);

  const lang = await getUserLang(ctx);
  const lastWord = fc.deck[fc.currentIndex];
  if (lastWord) logReviewSafe(ctx, lastWord.id);

  await finishSession(ctx, fc, lang);
  await ctx.answerCallbackQuery();
}

/* ── fc:restart ────────────────────────────────────────────────── */

export async function handleFcRestart(ctx: BotContext): Promise<void> {
  const lang = await getUserLang(ctx);
  const pipeline = getPipeline(ctx);
  const result = await pipeline.run(ctx.user.id, FLASHCARD_CONFIG);

  if (result.words.length === 0) {
    await editMessageTextOrReply(ctx, t("flashcardEmpty", lang));
    ctx.session.flashcard = undefined;
    await ctx.answerCallbackQuery();
    return;
  }

  const fc: FlashcardSession = {
    deck: result.words,
    currentIndex: 0,
    config: FLASHCARD_CONFIG,
  };
  ctx.session.flashcard = fc;

  await showCurrentFront(ctx, fc, lang);
  if (ctx.callbackQuery?.message) {
    fc.cardMsgId = ctx.callbackQuery.message.message_id;
  }
  await ctx.answerCallbackQuery();
}

/* ── fc:quit ───────────────────────────────────────────────────── */

export async function handleFcQuit(ctx: BotContext): Promise<void> {
  const fc = ctx.session.flashcard;
  const lang = await getUserLang(ctx);

  if (fc && fc.currentIndex > 0) {
    const currentWord = fc.deck[fc.currentIndex];
    if (currentWord) logReviewSafe(ctx, currentWord.id);
  }

  ctx.session.flashcard = undefined;
  await editMessageTextOrReply(ctx, t("flashcardQuit", lang));
  await ctx.answerCallbackQuery();
}

/* ── fc:close ──────────────────────────────────────────────────── */

export async function handleFcClose(ctx: BotContext): Promise<void> {
  ctx.session.flashcard = undefined;
  try {
    await ctx.deleteMessage();
  } catch {
    /* ignore */
  }
  await ctx.answerCallbackQuery();
}
