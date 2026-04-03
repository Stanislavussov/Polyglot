/**
 * Flashcard callback handlers — fc:* callbacks for the flash card session.
 *
 * Handles: start, reveal, next, done, restart, quit, close.
 * Review logging is best-effort (never blocks UX).
 */

import { getAllLangs, userRepository, vocabularyRepository, wordReviewRepository } from "@polyglot/adapter-db";
import type { DictionaryPipelineDeps, SupportedLang } from "@polyglot/core";
import { createDictionaryPipeline, FLASHCARD_CONFIG, isSupported, t } from "@polyglot/core";
import { logger } from "@polyglot/infra";
import {
  buildFlashCardBackKeyboard,
  buildFlashCardDoneKeyboard,
  buildFlashCardFrontKeyboard,
  renderFlashCardBack,
  renderFlashCardFront,
} from "../../renderers/flashcard.renderer.js";
import type { BotContext } from "../../types.js";

/* ── Language resolution ───────────────────────────────────────── */

function getLangCodeById(id: number): string | undefined {
  const all = getAllLangs();
  return all.find((l) => l.id === id)?.code;
}

async function getUserLang(ctx: BotContext): Promise<SupportedLang> {
  const settings = await userRepository.getSettings(ctx.user.id);
  const lang = settings?.interfaceLang;
  return lang && isSupported(lang) ? lang : "en";
}

/* ── Pipeline deps ─────────────────────────────────────────────── */

const pipelineDeps: DictionaryPipelineDeps = {
  findEntriesByUser: async (userId) => {
    const entries = await vocabularyRepository.findByUserWithSourceLang(userId, (id) => getLangCodeById(id));
    return entries.map((e) => ({
      id: e.id,
      original: e.original,
      sourceLangId: e.sourceLangId,
      sourceLangCode: e.sourceLangCode,
      inputType: e.inputType,
      emoji: e.emoji,
      register: e.register,
      createdAt: e.createdAt,
      translations: e.translations.map((tr) => ({
        targetLangCode: getLangCodeById(tr.targetLangId) ?? "unknown",
        text: tr.text,
        cefr: tr.cefr,
        transcription: tr.transcription,
        register: tr.register,
        expressionType: tr.expressionType,
        equivalentNote: tr.equivalentNote,
        connotationWarning: tr.connotationWarning,
        details: tr.details as any,
      })),
    }));
  },
  getReviewCounts: async (userId) => {
    return wordReviewRepository.getReviewCounts(userId);
  },
};

const pipeline = createDictionaryPipeline(pipelineDeps);

/** Exported for use by flashcard.scene.ts. */
export function getPipeline() {
  return pipeline;
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

function logReviewSafe(userId: number, entryId: number): void {
  wordReviewRepository.logReview(userId, entryId, "flashcard").catch((err) => {
    logger.error({ err, userId, entryId }, "Failed to log flashcard review");
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
  if (currentWord) logReviewSafe(ctx.user.id, currentWord.id);

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
  if (lastWord) logReviewSafe(ctx.user.id, lastWord.id);

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
    if (currentWord) logReviewSafe(ctx.user.id, currentWord.id);
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
