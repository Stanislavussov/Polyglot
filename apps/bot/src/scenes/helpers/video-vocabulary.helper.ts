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
  checkVideoAllowance,
  getVideoSuggestionsForLangs,
  isSupported,
  logger,
  processVideo,
  resolveVideoSuggestion,
  type SupportedLang,
  saveAllVideoPhrases,
  saveVideoPhrase,
  type TranscriptSource,
  t,
} from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import { videoEnrichmentCounter, videoProcessingCounter, videoProcessingDuration } from "../../metrics.js";
import { trackProductEvent } from "../../observability/product-events.js";
import {
  buildConfirmationKeyboard,
  buildPhraseListKeyboard,
  buildVideoListKeyboard,
  renderConfirmation,
  renderPhraseList,
  renderVideoList,
} from "../../renderers/video-vocabulary.renderer.js";
import type { BotContext } from "../../types.js";
import { ensureAiQuota, recordAiUsage } from "../../utils/ai-quota.js";
import { editMessageTextOrReply } from "./edit-message.helper.js";
import { buildUpgradeKeyboard } from "./subscription.helper.js";

const PHRASES_PER_PAGE = 5;

// Built here from the package's exports (not inside the adapter) so a test's module mock of them takes effect.
const youtubeTranscripts: TranscriptSource = {
  async fetch(videoId, language) {
    const transcript = await fetchTranscript(videoId, language);
    return {
      text: formatSegmentedTranscript(transcript.segments),
      type: transcript.type,
      language: transcript.language,
    };
  },
  isPermanent: (error) => error instanceof TranscriptNotAvailableError,
};

const enrichmentOptions = (ctx: BotContext) => ({
  plan: ctx.user.subscriptionPlan,
  onEnriched: (status: "success" | "error") => videoEnrichmentCounter.inc({ status }),
});

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
    await ctx.reply(t("videoAlreadyProcessing", lang));
    return;
  }

  const allowance = await checkVideoAllowance(ctx.services, ctx.user, options);
  if (!allowance.ok) {
    // No allowance on this plan, the free lifetime trial spent, or the Plus monthly
    // cap hit — the prime conversion moment, so the upgrade CTA rides along.
    trackProductEvent(ctx, "limit.reached", "video");
    await ctx.reply(t("videoLimitReached", lang), { reply_markup: buildUpgradeKeyboard(lang) });
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
    await ctx.reply(t("videoMetadataError", lang));
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
    isTrial: allowance.isTrial,
  });

  metadata.language = videoLang;

  const text2 = renderConfirmation(metadata, allowance.remaining, allowance.limit, lang);
  const keyboard = buildConfirmationKeyboard(process.id, lang);
  await ctx.reply(text2, {
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
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

  await saveVideoPhrase(ctx.services, userId, process, phrase, sourceLang.id, enrichmentOptions(ctx));
  await ctx.answerCallbackQuery({ text: "✅" });

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

  const savedCount = await saveAllVideoPhrases(ctx.services, userId, process, sourceLang.id, enrichmentOptions(ctx));
  await ctx.answerCallbackQuery({ text: `✅ ${savedCount}` });

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

  await ctx.reply(text, {
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
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

  await ctx.reply(lines.join("\n"), { reply_markup: keyboard });
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
 * from onboarding so the user's one free trial can absorb it — but only when
 * their plan has no video allowance of its own to pay for it (Task 84).
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
    await ctx.reply(t("videoOrSendLink", lang));
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

  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const text = renderPhraseList(
    phrases,
    page,
    totalPages,
    process.videoUrl,
    {
      source: process.language,
      native: settings?.nativeLang ?? undefined,
    },
    lang,
  );
  const keyboard = buildPhraseListKeyboard(phrases, page, totalPages, processId, lang);

  await ctx.reply(text, {
    parse_mode: "HTML",
    reply_markup: keyboard,
    link_preview_options: { is_disabled: true },
  });
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

  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const text = renderPhraseList(
    phrases,
    page,
    totalPages,
    process.videoUrl,
    {
      source: process.language,
      native: settings?.nativeLang ?? undefined,
    },
    lang,
  );
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

async function processVideoInBackground(
  ctx: BotContext,
  processId: number,
  userId: number,
  lang: SupportedLang,
): Promise<void> {
  const stopTimer = videoProcessingDuration.startTimer();
  const outcome = await processVideo(ctx.services, processId, userId, youtubeTranscripts);
  stopTimer();
  videoProcessingCounter.inc({ status: outcome.status });

  // Outside the retry scope — a failed notification never re-runs the extraction.
  const chatId = ctx.chat?.id;
  if (!chatId) return;
  try {
    if (outcome.status === "completed") {
      const keyboard = new InlineKeyboard().text(t("videoBrowse", lang), `vid:browse:${processId}:1`);
      await ctx.api.sendMessage(chatId, `✅ ${t("videoProcessingDone", lang)} (${outcome.phraseCount})`, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
    } else {
      await ctx.api.sendMessage(chatId, `❌ ${t("videoProcessingFailed", lang)}`);
    }
  } catch {
    logger.warn({ processId, chatId }, "Failed to send video completion notification");
  }
}
