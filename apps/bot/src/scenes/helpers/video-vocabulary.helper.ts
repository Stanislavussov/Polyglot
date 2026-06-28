/**
 * Video Vocabulary handlers — YouTube video phrase extraction flow.
 */

import { videoVocabularyRepository, vocabularyDictionaryRepository, vocabularyRepository } from "@polyglot/adapter-db";
import {
  extractVideoId,
  fetchMetadata,
  fetchTranscript,
  formatSegmentedTranscript,
  TranscriptNotAvailableError,
} from "@polyglot/adapter-youtube";
import {
  extractPhrasesFromTranscript,
  isSupported,
  logger,
  resolveOutputConfig,
  type SupportedLang,
  t,
  translateWithContext,
} from "@polyglot/core";
import {
  buildConfirmationKeyboard,
  buildPhraseListKeyboard,
  buildVideoListKeyboard,
  renderConfirmation,
  renderPhraseList,
  renderVideoList,
} from "../../renderers/video-vocabulary.renderer.js";
import type { BotContext } from "../../types.js";
import { resolveDefaultAIModel } from "../../utils/ai-model.js";
import { trackTechnicalMessage } from "../../utils/message-cleanup.js";
import { toVocabularyInput } from "../../utils/vocabulary-mapper.js";

const PHRASES_PER_PAGE = 5;
const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [2000, 4000];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function resolveInterfaceLang(ctx: BotContext): Promise<SupportedLang> {
  const settings = ctx.user?.settings;
  const rawLang = settings?.interfaceLang ?? "en";
  return isSupported(rawLang) ? rawLang : "en";
}

interface VideoPhraseForSave {
  nativeTranslation: string | null;
  emoji: string | null;
  context: string | null;
  phrase: string;
}

type TranslationInput = {
  targetLangId: number;
  text: string;
  details: {
    synonyms: Array<{ text: string }>;
    examples: Array<{ context: string; target: string; native?: string | null }>;
  };
};

/**
 * Build translations array with native language translation from extraction data.
 * Includes context sentence from the video as an example.
 */
function buildNativeTranslation(phrase: VideoPhraseForSave, ctx: BotContext): TranslationInput[] {
  const translations: TranslationInput[] = [];

  if (phrase.nativeTranslation) {
    const nativeLangCode = ctx.user?.settings?.nativeLang;
    if (nativeLangCode) {
      const nativeLang = ctx.services.languageCache.getLang(nativeLangCode);
      if (nativeLang) {
        // Use context sentence from the video as an example
        const examples: Array<{ context: string; target: string; native?: string | null }> = [];
        if (phrase.context) {
          examples.push({
            context: phrase.context,
            target: phrase.nativeTranslation,
          });
        }

        translations.push({
          targetLangId: nativeLang.id,
          text: phrase.nativeTranslation,
          details: { synonyms: [], examples },
        });
      }
    }
  }

  return translations;
}

function getCurrentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Enrich a vocabulary entry in the background with full template translation.
 * Called after optimistic save — errors are logged but not surfaced to user.
 */
async function enrichVideoEntryInBackground(
  entryId: number,
  phrase: string,
  inputType: "word" | "phrase",
  sourceLangCode: string,
  userId: number,
  ctx: BotContext,
): Promise<void> {
  try {
    const savedTemplate = await ctx.services.translationTemplateRepository.getByUserId(userId);
    const userTpl = savedTemplate ? { name: savedTemplate.name, fields: savedTemplate.fields } : null;
    const outputConfig = resolveOutputConfig(userTpl, inputType, phrase.length);

    const userSettings = await ctx.services.userRepository.getSettings(userId);
    const nativeLang = userSettings?.nativeLang ?? "en";
    const learningLangs = userSettings?.learningLangs ?? [];

    // Build target languages: all user's learning languages except the source
    const targetLangs = learningLangs.filter((l) => l !== sourceLangCode);
    if (targetLangs.length === 0) targetLangs.push(nativeLang);

    const model = await resolveDefaultAIModel(ctx.services.settings, ctx.user?.subscriptionPlan);

    const decision = await translateWithContext(
      {
        word: phrase,
        sourceLang: sourceLangCode,
        targetLangs,
        nativeLang,
        model,
        outputConfig,
        inputType,
        userId,
      },
      {
        lookupContext: async () => [],
        generateObjectFn: ctx.services.ai.generateObject,
      },
    );

    if (decision.status === "accepted" || decision.status === "needs_review") {
      const vocabInput = toVocabularyInput(
        decision.output,
        0, // sourceLangId not used for update path
        inputType,
        (code) => ctx.services.languageCache.getLang(code)?.id ?? null,
      );

      await vocabularyRepository.updateEntry(entryId, {
        emoji: vocabInput.emoji,
        nativeMeaning: vocabInput.nativeMeaning,
        sourceUsage: vocabInput.sourceUsage,
      });

      if (vocabInput.translations.length > 0) {
        await vocabularyRepository.updateAllTranslations(entryId, vocabInput.translations);
      }
    }
  } catch (error) {
    logger.error(
      { entryId, phrase, error: error instanceof Error ? error.message : String(error) },
      "Failed to enrich video vocabulary entry",
    );
  }
}

/* ------------------------------------------------------------------ */
/*  Entry point — YouTube URL detected                                 */
/* ------------------------------------------------------------------ */

export async function handleVideoVocabularyUrl(ctx: BotContext, text: string): Promise<void> {
  const lang = await resolveInterfaceLang(ctx);
  const userId = ctx.user?.id;
  if (!userId) return;

  const videoId = extractVideoId(text);
  if (!videoId) return;

  // Check for duplicate processing
  const existing = await videoVocabularyRepository.findProcessByUserAndVideo(userId, videoId);
  if (existing?.status === "completed") {
    // Show existing results
    await showPhraseBrowser(ctx, existing.id, 1, lang);
    return;
  }
  if (existing?.status === "processing" || existing?.status === "pending") {
    const msg = await ctx.reply(t("videoAlreadyProcessing", lang));
    trackTechnicalMessage(ctx, msg.message_id);
    return;
  }

  // Check monthly limit
  const config = await ctx.services.settings.getVideoVocabularyConfig();
  const yearMonth = getCurrentYearMonth();
  const usageCount = await videoVocabularyRepository.getMonthlyUsageCount(userId, yearMonth);
  if (usageCount >= config.monthlyLimit) {
    const msg = await ctx.reply(t("videoLimitReached", lang));
    trackTechnicalMessage(ctx, msg.message_id);
    return;
  }

  // Fetch video metadata
  let metadata: { title: string; durationSeconds: number; language: string };
  try {
    const meta = await fetchMetadata(videoId);
    metadata = {
      title: meta.title,
      durationSeconds: meta.durationSeconds,
      language: "auto", // will be determined from transcript
    };
  } catch {
    const msg = await ctx.reply(t("videoMetadataError", lang));
    trackTechnicalMessage(ctx, msg.message_id);
    return;
  }

  // Create process record to reserve the limit
  const settings = ctx.user?.settings;
  const userLangs = settings?.learningLangs ?? [];
  const nativeLang = settings?.nativeLang ?? "en";
  const videoLang = userLangs[0] ?? nativeLang; // best guess, will be refined from transcript

  const process = await videoVocabularyRepository.createProcess({
    userId,
    videoId,
    videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
    title: metadata.title,
    durationSeconds: metadata.durationSeconds,
    language: videoLang,
  });

  metadata.language = videoLang;
  const remaining = config.monthlyLimit - usageCount;

  // Show confirmation
  const text2 = renderConfirmation(metadata, remaining, config.monthlyLimit, lang);
  const keyboard = buildConfirmationKeyboard(process.id, lang);
  const msg = await ctx.reply(text2, {
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
  trackTechnicalMessage(ctx, msg.message_id);
}

/* ------------------------------------------------------------------ */
/*  Callback handlers                                                  */
/* ------------------------------------------------------------------ */

export async function handleVideoConfirmCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) return;
  await ctx.answerCallbackQuery();

  const processId = Number.parseInt(data.split(":")[2], 10);
  if (Number.isNaN(processId)) return;

  const lang = await resolveInterfaceLang(ctx);
  const userId = ctx.user?.id;
  if (!userId) return;

  const process = await videoVocabularyRepository.findProcessById(processId);
  if (!process || process.userId !== userId) return;

  // Update status and start processing
  await ctx.editMessageText(t("videoProcessingStarted", lang), { parse_mode: "HTML" });

  // Start async processing (fire and forget)
  void processVideoInBackground(ctx, process.id, userId, lang);
}

export async function handleVideoCancelCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) return;
  await ctx.answerCallbackQuery();

  const processId = Number.parseInt(data.split(":")[2], 10);
  if (Number.isNaN(processId)) return;

  // Mark as failed (refund the limit slot)
  await videoVocabularyRepository.updateProcessStatus(processId, "failed", "Cancelled by user");

  try {
    await ctx.deleteMessage();
  } catch {
    // Message may already be deleted
  }
}

export async function handleVideoBrowseCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) return;
  await ctx.answerCallbackQuery();

  const parts = data.split(":");
  const processId = Number.parseInt(parts[2], 10);
  const page = Number.parseInt(parts[3], 10);
  if (Number.isNaN(processId) || Number.isNaN(page)) return;

  const lang = await resolveInterfaceLang(ctx);
  await showPhraseBrowserEdit(ctx, processId, page, lang);
}

export async function handleVideoSavePhraseCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  const phraseId = Number.parseInt(data.split(":")[2], 10);
  if (Number.isNaN(phraseId)) return;

  const userId = ctx.user?.id;
  if (!userId) return;

  const phrase = await videoVocabularyRepository.findPhraseById(phraseId);
  if (!phrase) {
    await ctx.answerCallbackQuery({ text: "Phrase not found" });
    return;
  }

  if (phrase.savedEntryId) {
    await ctx.answerCallbackQuery({ text: "Already saved" });
    return;
  }

  const process = await videoVocabularyRepository.findProcessById(phrase.videoProcessId);
  if (!process) return;

  // Get source language ID from language cache
  const sourceLang = ctx.services.languageCache.getLang(process.language);
  if (!sourceLang) {
    await ctx.answerCallbackQuery({ text: "Language not found" });
    return;
  }

  // Check if already in vocabulary
  const existing = await vocabularyRepository.findByOriginalAndSource(userId, phrase.phrase, sourceLang.id);
  if (existing) {
    await videoVocabularyRepository.markPhraseSaved(phraseId, existing.id);
    await ctx.answerCallbackQuery({ text: "✅" });
  } else {
    // Build translations array — include native language translation if available
    const translations = buildNativeTranslation(phrase, ctx);

    // Build sourceUsage with context sentence from video as example
    const sourceUsage = phrase.context
      ? {
          explanation: phrase.nativeTranslation ?? "",
          synonyms: [],
          examples: [{ context: phrase.context, target: phrase.nativeTranslation ?? "" }],
        }
      : undefined;

    const entry = await vocabularyRepository.create(userId, {
      original: phrase.phrase,
      sourceLangId: sourceLang.id,
      inputType: phrase.phraseType === "word" ? "word" : "phrase",
      emoji: phrase.emoji ?? "",
      nativeMeaning: phrase.nativeTranslation ?? undefined,
      sourceUsage,
      source: {
        type: "video",
        videoUrl: process.videoUrl,
        videoTitle: process.title ?? "",
        timestampSeconds: phrase.timestampSeconds ?? null,
      },
      translations,
    });
    await vocabularyDictionaryRepository.addEntryToDefault(userId, entry.id);
    await videoVocabularyRepository.markPhraseSaved(phraseId, entry.id);
    await ctx.answerCallbackQuery({ text: "✅" });

    // Enrich with full template translation in background
    const entryInputType = phrase.phraseType === "word" ? ("word" as const) : ("phrase" as const);
    void enrichVideoEntryInBackground(entry.id, phrase.phrase, entryInputType, process.language, userId, ctx);
  }

  // Re-render the current page
  const lang = await resolveInterfaceLang(ctx);
  const currentPage = Math.ceil(phrase.sortOrder / PHRASES_PER_PAGE);
  await showPhraseBrowserEdit(ctx, phrase.videoProcessId, currentPage || 1, lang);
}

export async function handleVideoListCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) return;
  await ctx.answerCallbackQuery();

  const page = Number.parseInt(data.split(":")[2], 10) || 1;
  const lang = await resolveInterfaceLang(ctx);
  const userId = ctx.user?.id;
  if (!userId) return;

  await showVideoListEdit(ctx, userId, page, lang);
}

export async function handleVideoCloseCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  try {
    await ctx.deleteMessage();
  } catch {
    // Already deleted
  }
}

export async function handleVideoNoopCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
}

export async function handleVideoSaveAllCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  const processId = Number.parseInt(data.split(":")[2], 10);
  if (Number.isNaN(processId)) return;

  const userId = ctx.user?.id;
  if (!userId) return;

  const process = await videoVocabularyRepository.findProcessById(processId);
  if (!process || process.userId !== userId) {
    await ctx.answerCallbackQuery();
    return;
  }

  const sourceLang = ctx.services.languageCache.getLang(process.language);
  if (!sourceLang) {
    await ctx.answerCallbackQuery({ text: "Language not found" });
    return;
  }

  // Get all unsaved phrases
  const allPhrases = await videoVocabularyRepository.findPhrasesByProcess(processId, 0, 100);
  const unsaved = allPhrases.filter((p) => !p.savedEntryId);

  let savedCount = 0;
  const enrichmentQueue: Array<{ entryId: number; phrase: string; inputType: "word" | "phrase" }> = [];

  for (const phrase of unsaved) {
    const existing = await vocabularyRepository.findByOriginalAndSource(userId, phrase.phrase, sourceLang.id);
    if (existing) {
      await videoVocabularyRepository.markPhraseSaved(phrase.id, existing.id);
      savedCount++;
    } else {
      const translations = buildNativeTranslation(phrase, ctx);
      const sourceUsage = phrase.context
        ? {
            explanation: phrase.nativeTranslation ?? "",
            synonyms: [],
            examples: [{ context: phrase.context, target: phrase.nativeTranslation ?? "" }],
          }
        : undefined;
      const entryInputType = phrase.phraseType === "word" ? ("word" as const) : ("phrase" as const);
      const entry = await vocabularyRepository.create(userId, {
        original: phrase.phrase,
        sourceLangId: sourceLang.id,
        inputType: entryInputType,
        emoji: phrase.emoji ?? "",
        nativeMeaning: phrase.nativeTranslation ?? undefined,
        sourceUsage,
        source: {
          type: "video",
          videoUrl: process.videoUrl,
          videoTitle: process.title ?? "",
          timestampSeconds: phrase.timestampSeconds ?? null,
        },
        translations,
      });
      await vocabularyDictionaryRepository.addEntryToDefault(userId, entry.id);
      await videoVocabularyRepository.markPhraseSaved(phrase.id, entry.id);
      enrichmentQueue.push({ entryId: entry.id, phrase: phrase.phrase, inputType: entryInputType });
      savedCount++;
    }
  }

  await ctx.answerCallbackQuery({ text: `✅ ${savedCount}` });

  // Enrich all new entries with full template translations in background (sequentially)
  if (enrichmentQueue.length > 0) {
    void (async () => {
      for (const item of enrichmentQueue) {
        await enrichVideoEntryInBackground(item.entryId, item.phrase, item.inputType, process.language, userId, ctx);
      }
    })();
  }

  // Re-render current page
  const lang = await resolveInterfaceLang(ctx);
  await showPhraseBrowserEdit(ctx, processId, 1, lang);
}

/* ------------------------------------------------------------------ */
/*  /videos command                                                    */
/* ------------------------------------------------------------------ */

export async function handleVideosCommand(ctx: BotContext): Promise<void> {
  const userId = ctx.user?.id;
  if (!userId) return;

  const lang = await resolveInterfaceLang(ctx);
  const page = 1;
  const pageSize = 5;

  const processes = await videoVocabularyRepository.findProcessesByUser(userId, page, pageSize);
  const totalCount = await videoVocabularyRepository.countProcessesByUser(userId);
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const text = renderVideoList(processes, page, totalPages, lang);
  const keyboard = buildVideoListKeyboard(processes, page, totalPages, lang);

  const msg = await ctx.reply(text, {
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
  trackTechnicalMessage(ctx, msg.message_id);
}

/* ------------------------------------------------------------------ */
/*  Phrase browser                                                     */
/* ------------------------------------------------------------------ */

async function showPhraseBrowser(ctx: BotContext, processId: number, page: number, lang: SupportedLang): Promise<void> {
  const process = await videoVocabularyRepository.findProcessById(processId);
  if (!process) return;

  const offset = (page - 1) * PHRASES_PER_PAGE;
  const phrases = await videoVocabularyRepository.findPhrasesByProcess(processId, offset, PHRASES_PER_PAGE);
  const totalPhrases = await videoVocabularyRepository.countPhrasesByProcess(processId);
  const totalPages = Math.max(1, Math.ceil(totalPhrases / PHRASES_PER_PAGE));

  const text = renderPhraseList(phrases, page, totalPages, process.videoUrl, lang);
  const keyboard = buildPhraseListKeyboard(phrases, page, totalPages, processId, lang);

  const msg = await ctx.reply(text, {
    parse_mode: "HTML",
    reply_markup: keyboard,
    link_preview_options: { is_disabled: true },
  });
  trackTechnicalMessage(ctx, msg.message_id);
}

async function showPhraseBrowserEdit(
  ctx: BotContext,
  processId: number,
  page: number,
  lang: SupportedLang,
): Promise<void> {
  const process = await videoVocabularyRepository.findProcessById(processId);
  if (!process) return;

  const offset = (page - 1) * PHRASES_PER_PAGE;
  const phrases = await videoVocabularyRepository.findPhrasesByProcess(processId, offset, PHRASES_PER_PAGE);
  const totalPhrases = await videoVocabularyRepository.countPhrasesByProcess(processId);
  const totalPages = Math.max(1, Math.ceil(totalPhrases / PHRASES_PER_PAGE));

  const text = renderPhraseList(phrases, page, totalPages, process.videoUrl, lang);
  const keyboard = buildPhraseListKeyboard(phrases, page, totalPages, processId, lang);

  try {
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
      link_preview_options: { is_disabled: true },
    });
  } catch {
    // Message unchanged or deleted
  }
}

async function showVideoListEdit(ctx: BotContext, userId: number, page: number, lang: SupportedLang): Promise<void> {
  const pageSize = 5;
  const processes = await videoVocabularyRepository.findProcessesByUser(userId, page, pageSize);
  const totalCount = await videoVocabularyRepository.countProcessesByUser(userId);
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const text = renderVideoList(processes, page, totalPages, lang);
  const keyboard = buildVideoListKeyboard(processes, page, totalPages, lang);

  try {
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  } catch {
    // Message unchanged or deleted
  }
}

/* ------------------------------------------------------------------ */
/*  Background processing                                              */
/* ------------------------------------------------------------------ */

async function processVideoInBackground(
  ctx: BotContext,
  processId: number,
  userId: number,
  lang: SupportedLang,
): Promise<void> {
  const process = await videoVocabularyRepository.findProcessById(processId);
  if (!process) return;

  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await videoVocabularyRepository.updateProcessStatus(processId, "processing");

      // 1. Get transcript (from cache or YouTube)
      let transcriptText: string;
      let transcriptType: string | undefined;

      const cached = await videoVocabularyRepository.findCachedTranscript(process.videoId, process.language);
      if (cached) {
        transcriptText = cached.transcript;
        transcriptType = cached.transcriptType ?? undefined;
      } else {
        const transcript = await fetchTranscript(process.videoId, process.language);
        transcriptText = formatSegmentedTranscript(transcript.segments);
        transcriptType = transcript.type;
        await videoVocabularyRepository.cacheTranscript(
          process.videoId,
          transcript.language,
          transcriptText,
          transcriptType,
        );
      }

      // 2. Get user's proficiency level for this language
      const levels = await ctx.services.userRepository.getLanguageLevels(userId);
      const levelEntry = levels.find((l) => l.languageCode === process.language);
      const userLevel = levelEntry?.proficiencyLevel ?? "B1";

      // 3. Get extraction config and user's native language
      const config = await ctx.services.settings.getVideoVocabularyConfig();
      const userSettings = await ctx.services.userRepository.getSettings(userId);
      const nativeLang = userSettings?.nativeLang ?? "en";

      // 4. Extract phrases using AI
      const phrases = await extractPhrasesFromTranscript(
        transcriptText,
        process.language,
        userLevel,
        config.maxPhrasesDefault,
        ctx.services.ai.generateObject,
        config.extractionModelId,
        nativeLang,
      );

      // 5. Save phrases to DB
      await videoVocabularyRepository.savePhrases(
        processId,
        phrases.map((p, i) => ({
          phrase: p.phrase,
          nativeTranslation: p.nativeTranslation,
          emoji: p.emoji,
          phraseType: p.type,
          level: p.level,
          context: p.context,
          timestampSeconds: p.timestampSeconds,
          sortOrder: i + 1,
        })),
      );

      // 6. Mark as completed
      await videoVocabularyRepository.updateProcessStatus(processId, "completed");

      // 7. Notify user
      const chatId = ctx.chat?.id;
      if (chatId) {
        const keyboard = new (await import("grammy")).InlineKeyboard().text(
          t("videoBrowse", lang),
          `vid:browse:${processId}:1`,
        );
        await ctx.api.sendMessage(chatId, `✅ ${t("videoProcessingDone", lang)} (${phrases.length})`, {
          parse_mode: "HTML",
          reply_markup: keyboard,
        });
      }

      return; // Success — exit retry loop
    } catch (error) {
      lastError = error;
      logger.error(
        {
          processId,
          attempt: attempt + 1,
          error: error instanceof Error ? error.message : String(error),
        },
        "Video processing failed",
      );

      if (error instanceof TranscriptNotAvailableError) {
        // Don't retry transcript errors — they won't resolve
        break;
      }

      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
      }
    }
  }

  // All retries failed
  const errorMsg = lastError instanceof Error ? lastError.message : "Unknown error";
  await videoVocabularyRepository.updateProcessStatus(processId, "failed", errorMsg);

  const chatId = ctx.chat?.id;
  if (chatId) {
    await ctx.api.sendMessage(chatId, `❌ ${t("videoProcessingFailed", lang)}`);
  }
}
