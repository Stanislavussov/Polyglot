/**
 * Flashcard callback handlers — fc:* callbacks for the flash card session.
 *
 * Handles: start, reveal, next, done, restart, quit, close.
 * Review logging is best-effort (never blocks UX).
 */
import type { DictionaryPipelineDeps, SupportedLang } from "@polyglot/core";
import { createDictionaryPipeline, FLASHCARD_CONFIG, isSupported, logEvent, logger, t } from "@polyglot/core";
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

/* ── fc:start ──────────────────────────────────────────────────── */

export async function handleFcStart(ctx: BotContext): Promise<void> {
  const fc = ctx.session.flashcard;
  if (!fc) return void answerExpired(ctx);

  logEvent("flashcard.session_started", { deckSize: fc.deck.length });
  const lang = await getUserLang(ctx);
  const word = fc.deck[0]!;
  const text = renderFlashCardFront(word, 1, fc.deck.length, lang);
  const kb = buildFlashCardFrontKeyboard(lang);

  await editMessageTextOrReply(ctx, text, { parse_mode: "HTML", reply_markup: kb });
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
  const kb = buildFlashCardBackKeyboard(isLast, lang);

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
  const word = fc.deck[fc.currentIndex]!;
  const text = renderFlashCardFront(word, fc.currentIndex + 1, fc.deck.length, lang);
  const kb = buildFlashCardFrontKeyboard(lang);

  await editMessageTextOrReply(ctx, text, { parse_mode: "HTML", reply_markup: kb });
  await ctx.answerCallbackQuery();
}

/* ── fc:done ───────────────────────────────────────────────────── */

export async function handleFcDone(ctx: BotContext): Promise<void> {
  const fc = ctx.session.flashcard;
  if (!fc) return void answerExpired(ctx);

  logEvent("flashcard.session_finished", { deckSize: fc.deck.length, reviewed: fc.currentIndex + 1 });
  const lang = await getUserLang(ctx);
  const lastWord = fc.deck[fc.currentIndex];
  if (lastWord) logReviewSafe(ctx, lastWord.id);

  // No SM-2 update and no grading here, so neither `mature` nor "recalled a hard
  // word" can be earned in a flashcard session — the only evidence this surface can
  // carry is a dictionary milestone, which `resolvePraiseLine` reads for itself.
  const praise = await resolvePraiseLine(ctx, lang, "flashcard_done", new Date());
  const done = t("flashcardDone", lang, { count: String(fc.deck.length) });
  const text = praise ? `${done}\n\n${praise}` : done;
  const kb = buildFlashCardDoneKeyboard(lang);

  await editMessageTextOrReply(ctx, text, { parse_mode: "HTML", reply_markup: kb });
  ctx.session.flashcard = undefined;
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

  ctx.session.flashcard = {
    deck: result.words,
    currentIndex: 0,
    config: FLASHCARD_CONFIG,
  };

  const word = result.words[0]!;
  const text = renderFlashCardFront(word, 1, result.words.length, lang);
  const kb = buildFlashCardFrontKeyboard(lang);

  await editMessageTextOrReply(ctx, text, { parse_mode: "HTML", reply_markup: kb });
  if (ctx.callbackQuery?.message) {
    ctx.session.flashcard.cardMsgId = ctx.callbackQuery.message.message_id;
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
