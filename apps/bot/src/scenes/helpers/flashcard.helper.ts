/**
 * Flashcard callback handlers — fc:* callbacks for the flash card session.
 *
 * Handles: start, reveal, next, done, restart, quit, close.
 * Review logging is best-effort (never blocks UX).
 */
import type { DictionaryPipelineDeps, SupportedLang } from "@polyglot/core";
import { createDictionaryPipeline, FLASHCARD_CONFIG, isSupported, logger, t } from "@polyglot/core";
import {
  buildFlashCardBackKeyboard,
  buildFlashCardDoneKeyboard,
  buildFlashCardFrontKeyboard,
  renderFlashCardBack,
  renderFlashCardFront,
} from "../../renderers/flashcard.renderer.js";
import type { BotContext } from "../../types.js";

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

  const lang = await getUserLang(ctx);
  const word = fc.deck[0]!;
  const text = renderFlashCardFront(word, 1, fc.deck.length, lang);
  const kb = buildFlashCardFrontKeyboard(lang);

  try {
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
  } catch {
    /* message not modified */
  }
  await ctx.answerCallbackQuery();
}

/* ── fc:reveal ─────────────────────────────────────────────────── */

export async function handleFcReveal(ctx: BotContext): Promise<void> {
  const fc = ctx.session.flashcard;
  if (!fc) return void answerExpired(ctx);

  const lang = await getUserLang(ctx);
  const word = fc.deck[fc.currentIndex]!;
  const isLast = fc.currentIndex >= fc.deck.length - 1;
  const text = renderFlashCardBack(word, fc.currentIndex + 1, fc.deck.length, lang);
  const kb = buildFlashCardBackKeyboard(isLast, lang);

  try {
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
  } catch {
    /* ignore */
  }
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

  try {
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
  } catch {
    /* ignore */
  }
  await ctx.answerCallbackQuery();
}

/* ── fc:done ───────────────────────────────────────────────────── */

export async function handleFcDone(ctx: BotContext): Promise<void> {
  const fc = ctx.session.flashcard;
  if (!fc) return void answerExpired(ctx);

  const lang = await getUserLang(ctx);
  const lastWord = fc.deck[fc.currentIndex];
  if (lastWord) logReviewSafe(ctx, lastWord.id);

  const text = t("flashcardDone", lang, { count: String(fc.deck.length) });
  const kb = buildFlashCardDoneKeyboard(lang);

  try {
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
  } catch {
    /* ignore */
  }
  ctx.session.flashcard = undefined;
  await ctx.answerCallbackQuery();
}

/* ── fc:restart ────────────────────────────────────────────────── */

export async function handleFcRestart(ctx: BotContext): Promise<void> {
  const lang = await getUserLang(ctx);
  const pipeline = getPipeline(ctx);
  const result = await pipeline.run(ctx.user.id, FLASHCARD_CONFIG);

  if (result.words.length === 0) {
    try {
      await ctx.editMessageText(t("flashcardEmpty", lang));
    } catch {
      /* ignore */
    }
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

  try {
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
  } catch {
    /* ignore */
  }
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
  try {
    await ctx.editMessageText(t("flashcardQuit", lang));
  } catch {
    /* ignore */
  }
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
