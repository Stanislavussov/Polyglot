/**
 * Video Vocabulary handlers — YouTube video phrase extraction flow.
 */

import {
  extractVideoId,
  fetchMetadata,
  fetchTranscript,
  formatSegmentedTranscript,
  TranscriptNotAvailableError,
} from "@polyglot/adapter-youtube";
import {
  computePhraseTarget,
  extractPhrasesFromTranscript,
  getVideoSuggestionsForLangs,
  isSupported,
  logger,
  resolveEntitlements,
  resolveOutputConfig,
  resolveVideoSuggestion,
  type SupportedLang,
  t,
  translateWithContext,
} from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import { videoEnrichmentCounter, videoProcessingCounter, videoProcessingDuration } from "../../metrics.js";
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
import { ensureAiQuota, recordAiUsage } from "../../utils/ai-quota.js";
import { trackTechnicalMessage } from "../../utils/message-cleanup.js";
import { toVocabularyInput } from "../../utils/vocabulary-mapper.js";
import { editMessageTextOrReply } from "./edit-message.helper.js";
import { buildUpgradeKeyboard } from "./subscription.helper.js";

const PHRASES_PER_PAGE = 5;
const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [2000, 4000];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function resolveInterfaceLang(ctx: BotContext): Promise<SupportedLang> {
  const userId = ctx.user?.id;
  if (!userId) return "en";
  const settings = await ctx.services.userRepository.getSettings(userId);
  const rawLang = settings?.interfaceLang ?? "en";
  return isSupported(rawLang) ? rawLang : "en";
}

/**
 * Estimate video duration (seconds) from the [Ns] timestamp markers embedded in
 * a formatted transcript. oEmbed does not expose duration, so the last marker —
 * inserted roughly every 5 seconds — is the most reliable signal available for
 * both freshly fetched and cached transcripts.
 */
function estimateDurationSeconds(transcriptText: string): number {
  let max = 0;
  for (const match of transcriptText.matchAll(/\[(\d+)s\]/g)) {
    const seconds = Number.parseInt(match[1], 10);
    if (seconds > max) max = seconds;
  }
  return max;
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
function buildNativeTranslation(
  phrase: VideoPhraseForSave,
  nativeLangCode: string | null | undefined,
  ctx: BotContext,
): TranslationInput[] {
  const translations: TranslationInput[] = [];

  if (phrase.nativeTranslation) {
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

/**
 * Feature launch date — the free-tier lifetime video trial only counts analyses
 * created on or after this date, so existing users aren't retroactively locked out.
 * Overridable via env for staging/testing.
 */
const DEFAULT_VIDEO_TRIAL_START = "2026-07-04T00:00:00Z";
const VIDEO_TRIAL_START = parseTrialStart(process.env.FEATURE_LAUNCH_DATE);

/** Parse the launch date, falling back to the documented default on a malformed env value. */
function parseTrialStart(raw: string | undefined): Date {
  const parsed = new Date(raw ?? DEFAULT_VIDEO_TRIAL_START);
  return Number.isNaN(parsed.getTime()) ? new Date(DEFAULT_VIDEO_TRIAL_START) : parsed;
}

/** Current calendar month as `YYYY-MM`, in UTC (matches the DB monthly-count boundaries). */
function getCurrentYearMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
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

      await ctx.services.vocabularyRepository.updateEntry(entryId, {
        emoji: vocabInput.emoji,
        nativeMeaning: vocabInput.nativeMeaning,
        sourceUsage: vocabInput.sourceUsage,
      });

      if (vocabInput.translations.length > 0) {
        await ctx.services.vocabularyRepository.updateAllTranslations(entryId, vocabInput.translations);
      }
    }
    videoEnrichmentCounter.inc({ status: "success" });
  } catch (error) {
    videoEnrichmentCounter.inc({ status: "error" });
    logger.error(
      { entryId, phrase, error: error instanceof Error ? error.message : String(error) },
      "Failed to enrich video vocabulary entry",
    );
  }
}

/* ------------------------------------------------------------------ */
/*  Entry point — YouTube URL detected                                 */
/* ------------------------------------------------------------------ */

export interface VideoVocabularyOptions {
  /**
   * This URL came from the onboarding suggestions. If the user has not spent
   * their giveaway yet, the run skips the plan allowance and is recorded as a
   * trial. Free plan is 3 videos *lifetime*, so charging one to a demo the user
   * has not yet seen the value of takes a third of everything they get.
   */
  fromOnboarding?: boolean;
}

export async function handleVideoVocabularyUrl(
  ctx: BotContext,
  text: string,
  options: VideoVocabularyOptions = {},
): Promise<void> {
  const lang = await resolveInterfaceLang(ctx);
  const userId = ctx.user?.id;
  if (!userId) return;

  const videoId = extractVideoId(text);
  if (!videoId) return;

  // Auto-expire processes stuck for more than 10 minutes
  const expiredCount = await ctx.services.videoVocabularyRepository.expireStaleProcesses(10);
  if (expiredCount > 0) {
    videoProcessingCounter.inc({ status: "timeout" }, expiredCount);
    logger.info({ expiredCount }, "Expired stale video processes");
  }

  // Check for duplicate processing
  const existing = await ctx.services.videoVocabularyRepository.findProcessByUserAndVideo(userId, videoId);
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

  // Plan-based video allowance (admin/tester get unlimited via role override).
  const plan = ctx.user.subscriptionPlan ?? "free";
  const planConfig = await ctx.services.settings.getPlanLimit(plan);
  const { video: videoEntitlement } = resolveEntitlements({
    audienceGroup: ctx.user.audienceGroup,
    plan,
    planConfig,
    planFeatures: [],
  });

  // Resolved before the allowance check so the giveaway can bypass it entirely.
  const isTrial = options.fromOnboarding
    ? !(await ctx.services.videoVocabularyRepository.hasCompletedTrial(userId))
    : false;

  let usageCount = 0;
  if (!isTrial && videoEntitlement.window === "none") {
    // Video not available on this plan → US-6 attaches the upgrade CTA keyboard here.
    const msg = await ctx.reply(t("videoLimitReached", lang), { reply_markup: buildUpgradeKeyboard(lang) });
    trackTechnicalMessage(ctx, msg.message_id);
    return;
  }
  if (!isTrial && videoEntitlement.limit !== null) {
    usageCount =
      videoEntitlement.window === "lifetime"
        ? await ctx.services.videoVocabularyRepository.getLifetimeUsageCount(userId, VIDEO_TRIAL_START)
        : await ctx.services.videoVocabularyRepository.getMonthlyUsageCount(userId, getCurrentYearMonth());
    if (usageCount >= videoEntitlement.limit) {
      // Free trial exhausted (3 lifetime) or Plus monthly cap hit — the prime
      // conversion moment, so surface the upgrade CTA here too.
      const msg = await ctx.reply(t("videoLimitReached", lang), { reply_markup: buildUpgradeKeyboard(lang) });
      trackTechnicalMessage(ctx, msg.message_id);
      return;
    }
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
  const settings = await ctx.services.userRepository.getSettings(userId);
  const userLangs = settings?.learningLangs ?? [];
  const nativeLang = settings?.nativeLang ?? "en";
  const videoLang = userLangs[0] ?? nativeLang; // best guess, will be refined from transcript

  const process = await ctx.services.videoVocabularyRepository.createProcess({
    userId,
    videoId,
    videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
    title: metadata.title,
    durationSeconds: metadata.durationSeconds,
    language: videoLang,
    isTrial,
  });

  metadata.language = videoLang;
  const remaining = videoEntitlement.limit === null ? null : videoEntitlement.limit - usageCount;

  // Show confirmation
  const text2 = renderConfirmation(metadata, remaining, videoEntitlement.limit, lang);
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

  const process = await ctx.services.videoVocabularyRepository.findProcessById(processId);
  if (!process || process.userId !== userId) return;

  // Meter credits before the expensive extraction (Fable T16): a video pass runs
  // a long-transcript prompt, so it is the heaviest paid call and is billed
  // upfront on confirm (the extraction runs fire-and-forget).
  const creditCost = await ensureAiQuota(ctx, ctx.user.subscriptionPlan, lang, "video");
  if (creditCost === null) {
    return;
  }
  await recordAiUsage(ctx, "video", creditCost);

  videoProcessingCounter.inc({ status: "initiated" });

  // Update status and start processing
  await editMessageTextOrReply(ctx, t("videoProcessingStarted", lang), { parse_mode: "HTML" });

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
  await ctx.services.videoVocabularyRepository.updateProcessStatus(processId, "failed", "Cancelled by user");

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

  const lang = await resolveInterfaceLang(ctx);

  const phrase = await ctx.services.videoVocabularyRepository.findPhraseById(phraseId);
  if (!phrase) {
    await ctx.answerCallbackQuery({ text: t("videoPhraseNotFound", lang) });
    return;
  }

  if (phrase.savedEntryId) {
    await ctx.answerCallbackQuery({ text: t("videoAlreadySaved", lang) });
    return;
  }

  const process = await ctx.services.videoVocabularyRepository.findProcessById(phrase.videoProcessId);
  if (!process) return;

  // Get source language ID from language cache
  const sourceLang = ctx.services.languageCache.getLang(process.language);
  if (!sourceLang) {
    await ctx.answerCallbackQuery({ text: t("videoLanguageNotFound", lang) });
    return;
  }

  // Check if already in vocabulary
  const existing = await ctx.services.vocabularyRepository.findByOriginalAndSource(
    userId,
    phrase.phrase,
    sourceLang.id,
  );
  if (existing) {
    await ctx.services.videoVocabularyRepository.markPhraseSaved(phraseId, existing.id);
    await ctx.answerCallbackQuery({ text: "✅" });
  } else {
    // Build translations array — include native language translation if available
    const settings = await ctx.services.userRepository.getSettings(userId);
    const translations = buildNativeTranslation(phrase, settings?.nativeLang, ctx);

    // Build sourceUsage with context sentence from video as example
    const sourceUsage = phrase.context
      ? {
          explanation: phrase.nativeTranslation ?? "",
          synonyms: [],
          examples: [{ context: phrase.context, target: phrase.nativeTranslation ?? "" }],
        }
      : undefined;

    const entry = await ctx.services.vocabularyRepository.create(userId, {
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
    await ctx.services.vocabularyDictionaryRepository.addEntryToDefault(userId, entry.id);
    await ctx.services.videoVocabularyRepository.markPhraseSaved(phraseId, entry.id);
    await ctx.answerCallbackQuery({ text: "✅" });

    // Enrich with full template translation in background
    const entryInputType = phrase.phraseType === "word" ? ("word" as const) : ("phrase" as const);
    void enrichVideoEntryInBackground(entry.id, phrase.phrase, entryInputType, process.language, userId, ctx);
  }

  // Re-render the current page
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

  const lang = await resolveInterfaceLang(ctx);

  const process = await ctx.services.videoVocabularyRepository.findProcessById(processId);
  if (!process || process.userId !== userId) {
    await ctx.answerCallbackQuery();
    return;
  }

  const sourceLang = ctx.services.languageCache.getLang(process.language);
  if (!sourceLang) {
    await ctx.answerCallbackQuery({ text: t("videoLanguageNotFound", lang) });
    return;
  }

  // Get all unsaved phrases
  const allPhrases = await ctx.services.videoVocabularyRepository.findPhrasesByProcess(processId, 0, 100);
  const unsaved = allPhrases.filter((p) => !p.savedEntryId);

  const settings = await ctx.services.userRepository.getSettings(userId);
  const nativeLangCode = settings?.nativeLang;

  let savedCount = 0;
  const enrichmentQueue: Array<{ entryId: number; phrase: string; inputType: "word" | "phrase" }> = [];

  for (const phrase of unsaved) {
    const existing = await ctx.services.vocabularyRepository.findByOriginalAndSource(
      userId,
      phrase.phrase,
      sourceLang.id,
    );
    if (existing) {
      await ctx.services.videoVocabularyRepository.markPhraseSaved(phrase.id, existing.id);
      savedCount++;
    } else {
      const translations = buildNativeTranslation(phrase, nativeLangCode, ctx);
      const sourceUsage = phrase.context
        ? {
            explanation: phrase.nativeTranslation ?? "",
            synonyms: [],
            examples: [{ context: phrase.context, target: phrase.nativeTranslation ?? "" }],
          }
        : undefined;
      const entryInputType = phrase.phraseType === "word" ? ("word" as const) : ("phrase" as const);
      const entry = await ctx.services.vocabularyRepository.create(userId, {
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
      await ctx.services.vocabularyDictionaryRepository.addEntryToDefault(userId, entry.id);
      await ctx.services.videoVocabularyRepository.markPhraseSaved(phrase.id, entry.id);
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
  const excludeFailed = ctx.user?.audienceGroup !== "admin";

  const processes = await ctx.services.videoVocabularyRepository.findProcessesByUser(
    userId,
    page,
    pageSize,
    excludeFailed,
  );
  const totalCount = await ctx.services.videoVocabularyRepository.countProcessesByUser(userId, excludeFailed);
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  // A user who has just finished onboarding has nothing here, and the bare
  // "send me a YouTube link" that used to fill this screen is a dead end: it
  // never says what kind of video works. Offer curated starters instead.
  if (processes.length === 0) {
    await showVideoSuggestions(ctx, userId, lang);
    return;
  }

  const text = renderVideoList(processes, page, totalPages, lang);
  const keyboard = buildVideoListKeyboard(processes, page, totalPages, lang);

  const msg = await ctx.reply(text, {
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
  trackTechnicalMessage(ctx, msg.message_id);
}

/**
 * The empty-state screen: curated starter videos for the languages the user
 * studies, plus the fallback invitation to paste any link.
 *
 * Degrades to the plain invitation when none of the user's learning languages has
 * a verified pick — better an honest empty screen than a suggestion in the wrong
 * language.
 */
async function showVideoSuggestions(ctx: BotContext, userId: number, lang: SupportedLang): Promise<void> {
  const settings = await ctx.services.userRepository.getSettings(userId);
  const suggestions = getVideoSuggestionsForLangs(settings?.learningLangs ?? []);

  const lines = [t("videoNoVideos", lang)];
  const keyboard = new InlineKeyboard();

  if (suggestions.length > 0) {
    lines.push("", t("videoTryThese", lang));
    for (const suggestion of suggestions) {
      const flag = ctx.services.languageCache.getLangFlag(suggestion.lang);
      const label = `${flag ? `${flag} ` : ""}${truncateLabel(suggestion.title)}`;
      keyboard.text(label, `${VIDEO_TRY_PREFIX}${suggestion.lang}:${suggestion.index}`).row();
    }
  }

  lines.push("", t("videoOrSendLink", lang));

  const msg = await ctx.reply(lines.join("\n"), { reply_markup: keyboard });
  trackTechnicalMessage(ctx, msg.message_id);
}

/** Telegram truncates long button labels unhelpfully; do it ourselves at a word boundary. */
function truncateLabel(title: string, max = 34): string {
  if (title.length <= max) return title;
  const cut = title.slice(0, max);
  const boundary = cut.lastIndexOf(" ");
  return `${(boundary > max / 2 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

/** Callback prefix for a tap on a curated starter video. */
export const VIDEO_TRY_PREFIX = "vid:try:";
export const VIDEO_TRY_PATTERN = /^vid:try:/;

/**
 * A curated starter video was tapped. Runs the normal pipeline, flagged as coming
 * from onboarding so the user's one free trial can absorb it instead of a third
 * of their lifetime free allowance.
 */
export async function handleVideoTryCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();

  const data = ctx.callbackQuery?.data;
  if (!data) return;

  const payload = data.slice(VIDEO_TRY_PREFIX.length);
  const separator = payload.lastIndexOf(":");
  if (separator <= 0) return;

  const suggestionLang = payload.slice(0, separator);
  const index = Number(payload.slice(separator + 1));
  if (!Number.isInteger(index)) return;

  const suggestion = resolveVideoSuggestion(suggestionLang, index);
  if (!suggestion) {
    // A stale keyboard from before the catalogue changed — say so rather than
    // silently doing nothing.
    const lang = await resolveInterfaceLang(ctx);
    const msg = await ctx.reply(t("videoOrSendLink", lang));
    trackTechnicalMessage(ctx, msg.message_id);
    return;
  }

  await handleVideoVocabularyUrl(ctx, suggestion.url, { fromOnboarding: true });
}

/* ------------------------------------------------------------------ */
/*  Phrase browser                                                     */
/* ------------------------------------------------------------------ */

async function showPhraseBrowser(ctx: BotContext, processId: number, page: number, lang: SupportedLang): Promise<void> {
  const process = await ctx.services.videoVocabularyRepository.findProcessById(processId);
  if (!process) return;

  const offset = (page - 1) * PHRASES_PER_PAGE;
  const phrases = await ctx.services.videoVocabularyRepository.findPhrasesByProcess(
    processId,
    offset,
    PHRASES_PER_PAGE,
  );
  const totalPhrases = await ctx.services.videoVocabularyRepository.countPhrasesByProcess(processId);
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
  const process = await ctx.services.videoVocabularyRepository.findProcessById(processId);
  if (!process) return;

  const offset = (page - 1) * PHRASES_PER_PAGE;
  const phrases = await ctx.services.videoVocabularyRepository.findPhrasesByProcess(
    processId,
    offset,
    PHRASES_PER_PAGE,
  );
  const totalPhrases = await ctx.services.videoVocabularyRepository.countPhrasesByProcess(processId);
  const totalPages = Math.max(1, Math.ceil(totalPhrases / PHRASES_PER_PAGE));

  const text = renderPhraseList(phrases, page, totalPages, process.videoUrl, lang);
  const keyboard = buildPhraseListKeyboard(phrases, page, totalPages, processId, lang);

  await editMessageTextOrReply(ctx, text, {
    parse_mode: "HTML",
    reply_markup: keyboard,
    link_preview_options: { is_disabled: true },
  });
}

async function showVideoListEdit(ctx: BotContext, userId: number, page: number, lang: SupportedLang): Promise<void> {
  const pageSize = 5;
  const excludeFailed = ctx.user?.audienceGroup !== "admin";
  const processes = await ctx.services.videoVocabularyRepository.findProcessesByUser(
    userId,
    page,
    pageSize,
    excludeFailed,
  );
  const totalCount = await ctx.services.videoVocabularyRepository.countProcessesByUser(userId, excludeFailed);
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const text = renderVideoList(processes, page, totalPages, lang);
  const keyboard = buildVideoListKeyboard(processes, page, totalPages, lang);

  await editMessageTextOrReply(ctx, text, {
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
}

/* ------------------------------------------------------------------ */
/*  Background processing                                              */
/* ------------------------------------------------------------------ */

/**
 * Collect every phrase the user already has in a given language so extraction can
 * skip them: the originals of their saved vocabulary in that source language, plus
 * every phrase generated in their previous videos of the same language. The source
 * language may be missing from the cache — in that case only prior video phrases
 * are used.
 */
async function collectKnownPhrases(
  ctx: BotContext,
  userId: number,
  language: string,
  currentProcessId: number,
): Promise<string[]> {
  const sourceLang = ctx.services.languageCache.getLang(language);
  const [savedOriginals, priorPhrases] = await Promise.all([
    sourceLang
      ? ctx.services.vocabularyRepository.findOriginalsByUserAndSource(userId, sourceLang.id)
      : Promise.resolve([]),
    ctx.services.videoVocabularyRepository.findKnownPhrasesByUser(userId, language, currentProcessId),
  ]);
  return [...savedOriginals, ...priorPhrases];
}

async function processVideoInBackground(
  ctx: BotContext,
  processId: number,
  userId: number,
  lang: SupportedLang,
): Promise<void> {
  const process = await ctx.services.videoVocabularyRepository.findProcessById(processId);
  if (!process) return;

  const stopTimer = videoProcessingDuration.startTimer();
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await ctx.services.videoVocabularyRepository.updateProcessStatus(processId, "processing");

      // 1. Get transcript (from cache or YouTube)
      let transcriptText: string;
      let transcriptType: string | undefined;

      const cached = await ctx.services.videoVocabularyRepository.findCachedTranscript(
        process.videoId,
        process.language,
      );
      if (cached) {
        transcriptText = cached.transcript;
        transcriptType = cached.transcriptType ?? undefined;
      } else {
        const transcript = await fetchTranscript(process.videoId, process.language);
        transcriptText = formatSegmentedTranscript(transcript.segments);
        transcriptType = transcript.type;
        await ctx.services.videoVocabularyRepository.cacheTranscript(
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

      // 4. Scale the phrase target to the video length
      const durationSeconds = estimateDurationSeconds(transcriptText);
      const targetPhrases = computePhraseTarget(durationSeconds, config.minPhrases, config.maxPhrases);

      // 4b. Gather phrases the user already knows in this language — their saved
      // dictionary plus everything generated in their previous videos — so the AI
      // does not regenerate them.
      const knownPhrases = await collectKnownPhrases(ctx, userId, process.language, processId);

      // 5. Extract phrases using AI
      const phrases = await extractPhrasesFromTranscript(
        transcriptText,
        process.language,
        userLevel,
        targetPhrases,
        ctx.services.ai.generateObject,
        config.extractionModelId,
        nativeLang,
        knownPhrases,
      );

      // 6. Save phrases to DB
      await ctx.services.videoVocabularyRepository.savePhrases(
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

      // 7. Mark as completed
      await ctx.services.videoVocabularyRepository.updateProcessStatus(processId, "completed");

      stopTimer();
      videoProcessingCounter.inc({ status: "completed" });
      logger.info({ processId, phraseCount: phrases.length, userId }, "Video processing completed");

      // 8. Notify user (outside retry scope — don't retry on notification failure)
      const chatId = ctx.chat?.id;
      if (chatId) {
        try {
          const keyboard = new (await import("grammy")).InlineKeyboard().text(
            t("videoBrowse", lang),
            `vid:browse:${processId}:1`,
          );
          await ctx.api.sendMessage(chatId, `✅ ${t("videoProcessingDone", lang)} (${phrases.length})`, {
            parse_mode: "HTML",
            reply_markup: keyboard,
          });
        } catch {
          logger.warn({ processId, chatId }, "Failed to send video completion notification");
        }
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
        "Video processing attempt failed",
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
  await ctx.services.videoVocabularyRepository.updateProcessStatus(processId, "failed", errorMsg);

  stopTimer();
  videoProcessingCounter.inc({ status: "failed" });
  logger.error({ processId, userId, error: errorMsg }, "Video processing failed after all retries");

  const chatId = ctx.chat?.id;
  if (chatId) {
    try {
      await ctx.api.sendMessage(chatId, `❌ ${t("videoProcessingFailed", lang)}`);
    } catch {
      logger.warn({ processId, chatId }, "Failed to send video failure notification");
    }
  }
}
