/**
 * The video-vocabulary flow both channels run: the plan allowance, the extraction
 * pipeline, and saving phrases into the dictionary. The bot and the web app differ
 * only in how they show it.
 */
import { logger } from "../../logger.js";
import type { ServiceContainer } from "../../ports/container.js";
import type { AudienceGroup } from "../../ports/user.repository.js";
import type { VideoPhrase, VideoProcess } from "../../ports/video-vocabulary.repository.js";
import { resolveEntitlements } from "../entitlements/entitlements.js";
import { type EnrichEntryInput, enrichSavedEntry } from "../vocabulary/enrich-saved-entry.js";
import { extractPhrasesFromTranscript } from "./extraction.service.js";
import { computePhraseTarget } from "./target.js";

export type VideoFlowDeps = Pick<
  ServiceContainer,
  | "userRepository"
  | "settings"
  | "ai"
  | "languageCache"
  | "vocabularyRepository"
  | "vocabularyDictionaryRepository"
  | "videoVocabularyRepository"
  | "translationTemplateRepository"
>;

/**
 * Feature launch date — the free-tier lifetime video trial only counts analyses
 * created on or after this date, so existing users aren't retroactively locked out.
 * Overridable via env for staging/testing.
 */
const DEFAULT_VIDEO_TRIAL_START = "2026-07-04T00:00:00Z";

function videoTrialStart(): Date {
  const parsed = new Date(process.env.FEATURE_LAUNCH_DATE ?? DEFAULT_VIDEO_TRIAL_START);
  return Number.isNaN(parsed.getTime()) ? new Date(DEFAULT_VIDEO_TRIAL_START) : parsed;
}

/** Current calendar month as `YYYY-MM`, in UTC (matches the DB monthly-count boundaries). */
function currentYearMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface VideoAllowanceSubject {
  id: number;
  audienceGroup: AudienceGroup;
  subscriptionPlan: string | null;
}

export type VideoAllowance =
  | { ok: true; isTrial: boolean; remaining: number | null; limit: number | null }
  | { ok: false };

/**
 * Whether this user may start one more video. `fromOnboarding` marks a curated
 * starter video: if the user has not spent their giveaway yet, the run skips the
 * plan allowance and is recorded as a trial — but only when the plan cannot pay for
 * the video itself. Since Task 84 a brand-new user spends their first week on the
 * Plus trial, whose monthly allowance covers a starter video; spending the
 * once-per-account giveaway there would leave them with nothing the first time they
 * open Videos after the trial expires, which is exactly the screen it exists for.
 */
export async function checkVideoAllowance(
  deps: Pick<VideoFlowDeps, "settings" | "videoVocabularyRepository">,
  user: VideoAllowanceSubject,
  options: { fromOnboarding?: boolean } = {},
): Promise<VideoAllowance> {
  const plan = user.subscriptionPlan ?? "free";
  const planConfig = await deps.settings.getPlanLimit(plan);
  const { video } = resolveEntitlements({ audienceGroup: user.audienceGroup, plan, planConfig, planFeatures: [] });

  const planCoversVideo = video.window !== "none";
  const isTrial =
    options.fromOnboarding && !planCoversVideo
      ? !(await deps.videoVocabularyRepository.hasCompletedTrial(user.id))
      : false;
  if (isTrial) return { ok: true, isTrial, remaining: video.limit, limit: video.limit };
  if (video.window === "none") return { ok: false };
  if (video.limit === null) return { ok: true, isTrial, remaining: null, limit: null };

  const used =
    video.window === "lifetime"
      ? await deps.videoVocabularyRepository.getLifetimeUsageCount(user.id, videoTrialStart())
      : await deps.videoVocabularyRepository.getMonthlyUsageCount(user.id, currentYearMonth());
  if (used >= video.limit) return { ok: false };
  return { ok: true, isTrial, remaining: video.limit - used, limit: video.limit };
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
    const seconds = Number.parseInt(match[1] ?? "0", 10);
    if (seconds > max) max = seconds;
  }
  return max;
}

/** The YouTube side, injected so core stays free of the adapter. */
export interface TranscriptSource {
  fetch(videoId: string, language: string): Promise<{ text: string; type: string; language: string }>;
  /** A failure that will not resolve on retry (no captions at all). */
  isPermanent(error: unknown): boolean;
}

const RETRY_DELAYS_MS = [2000, 4000];

/**
 * Collect every phrase the user already has in a given language so extraction can
 * skip them: the originals of their saved vocabulary in that source language, plus
 * every phrase generated in their previous videos of the same language.
 */
async function collectKnownPhrases(
  deps: VideoFlowDeps,
  userId: number,
  language: string,
  currentProcessId: number,
): Promise<string[]> {
  const sourceLang = deps.languageCache.getLang(language);
  const [savedOriginals, priorPhrases] = await Promise.all([
    sourceLang ? deps.vocabularyRepository.findOriginalsByUserAndSource(userId, sourceLang.id) : Promise.resolve([]),
    deps.videoVocabularyRepository.findKnownPhrasesByUser(userId, language, currentProcessId),
  ]);
  return [...savedOriginals, ...priorPhrases];
}

export type VideoProcessOutcome = { status: "completed"; phraseCount: number } | { status: "failed"; error: string };

/**
 * Transcript → phrases → saved, with retries; a failed run is marked failed, which
 * refunds the allowance slot. Never throws.
 */
export async function processVideo(
  deps: VideoFlowDeps,
  processId: number,
  userId: number,
  transcripts: TranscriptSource,
  retryDelaysMs: readonly number[] = RETRY_DELAYS_MS,
): Promise<VideoProcessOutcome> {
  const process = await deps.videoVocabularyRepository.findProcessById(processId);
  if (!process) return { status: "failed", error: "Process not found" };

  let lastError: unknown;
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    try {
      await deps.videoVocabularyRepository.updateProcessStatus(processId, "processing");

      let transcriptText: string;
      // process.language is a guess from user settings; the fetch may fall back
      // to the video's real caption track, so track the actual language here.
      let videoLang = process.language;
      const cached = await deps.videoVocabularyRepository.findCachedTranscript(process.videoId, process.language);
      if (cached) {
        transcriptText = cached.transcript;
      } else {
        const transcript = await transcripts.fetch(process.videoId, process.language);
        transcriptText = transcript.text;
        if (transcript.language !== "unknown" && transcript.language !== process.language) {
          videoLang = transcript.language;
          await deps.videoVocabularyRepository.updateProcessLanguage(processId, videoLang);
        }
        await deps.videoVocabularyRepository.cacheTranscript(
          process.videoId,
          transcript.language,
          transcriptText,
          transcript.type,
        );
      }

      const levels = await deps.userRepository.getLanguageLevels(userId);
      const userLevel = levels.find((l) => l.languageCode === videoLang)?.proficiencyLevel ?? "B1";
      const config = await deps.settings.getVideoVocabularyConfig();
      const userSettings = await deps.userRepository.getSettings(userId);
      const nativeLang = userSettings?.nativeLang ?? "en";
      const targetPhrases = computePhraseTarget(
        estimateDurationSeconds(transcriptText),
        config.minPhrases,
        config.maxPhrases,
      );
      const knownPhrases = await collectKnownPhrases(deps, userId, videoLang, processId);

      const phrases = await extractPhrasesFromTranscript(
        transcriptText,
        videoLang,
        userLevel,
        targetPhrases,
        deps.ai.generateObject,
        config.extractionModelId,
        nativeLang,
        knownPhrases,
      );

      await deps.videoVocabularyRepository.savePhrases(
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
      await deps.videoVocabularyRepository.updateProcessStatus(processId, "completed");
      logger.info({ processId, phraseCount: phrases.length, userId }, "Video processing completed");
      return { status: "completed", phraseCount: phrases.length };
    } catch (error) {
      lastError = error;
      logger.error(
        { processId, attempt: attempt + 1, error: error instanceof Error ? error.message : String(error) },
        "Video processing attempt failed",
      );
      if (transcripts.isPermanent(error)) break;
      const delay = retryDelaysMs[attempt];
      if (delay !== undefined) await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  const errorMsg = lastError instanceof Error ? lastError.message : "Unknown error";
  await deps.videoVocabularyRepository.updateProcessStatus(processId, "failed", errorMsg);
  logger.error({ processId, userId, error: errorMsg }, "Video processing failed after all retries");
  return { status: "failed", error: errorMsg };
}

export interface SaveVideoPhraseOptions {
  plan?: string;
  onEnriched?: EnrichEntryInput["onOutcome"];
}

type SavedPhrase = { phrase: VideoPhrase; entryId: number; created: boolean };

async function savePhraseEntry(
  deps: VideoFlowDeps,
  userId: number,
  process: VideoProcess,
  phrase: VideoPhrase,
  sourceLangId: number,
  nativeLangCode: string | null | undefined,
): Promise<SavedPhrase> {
  const existing = await deps.vocabularyRepository.findByOriginalAndSource(userId, phrase.phrase, sourceLangId);
  if (existing) {
    await deps.videoVocabularyRepository.markPhraseSaved(phrase.id, existing.id);
    return { phrase, entryId: existing.id, created: false };
  }

  // The context sentence from the video rides along as the one example.
  const nativeLang = nativeLangCode ? deps.languageCache.getLang(nativeLangCode) : null;
  const translations =
    phrase.nativeTranslation && nativeLang
      ? [
          {
            targetLangId: nativeLang.id,
            text: phrase.nativeTranslation,
            details: {
              synonyms: [],
              examples: phrase.context ? [{ context: phrase.context, target: phrase.nativeTranslation }] : [],
            },
          },
        ]
      : [];
  const sourceUsage = phrase.context
    ? {
        explanation: phrase.nativeTranslation ?? "",
        synonyms: [],
        examples: [{ context: phrase.context, target: phrase.nativeTranslation ?? "" }],
      }
    : undefined;

  const entry = await deps.vocabularyRepository.create(userId, {
    original: phrase.phrase,
    sourceLangId,
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
  await deps.vocabularyDictionaryRepository.addEntryToDefault(userId, entry.id);
  await deps.videoVocabularyRepository.markPhraseSaved(phrase.id, entry.id);
  return { phrase, entryId: entry.id, created: true };
}

function enrichPhrase(
  deps: VideoFlowDeps,
  saved: SavedPhrase,
  process: VideoProcess,
  userId: number,
  options: SaveVideoPhraseOptions,
) {
  return enrichSavedEntry(deps, {
    entryId: saved.entryId,
    word: saved.phrase.phrase,
    inputType: saved.phrase.phraseType === "word" ? "word" : "phrase",
    sourceLangCode: process.language,
    userId,
    ...(options.plan ? { plan: options.plan } : {}),
    ...(options.onEnriched ? { onOutcome: options.onEnriched } : {}),
  });
}

/** Saves one phrase (or links the entry the user already has) and enriches a new entry in the background. */
export async function saveVideoPhrase(
  deps: VideoFlowDeps,
  userId: number,
  process: VideoProcess,
  phrase: VideoPhrase,
  sourceLangId: number,
  options: SaveVideoPhraseOptions = {},
): Promise<void> {
  const settings = await deps.userRepository.getSettings(userId);
  const saved = await savePhraseEntry(deps, userId, process, phrase, sourceLangId, settings?.nativeLang);
  if (saved.created) void enrichPhrase(deps, saved, process, userId, options);
}

/** Saves every unsaved phrase of a video; returns how many were saved. New entries enrich one after another. */
export async function saveAllVideoPhrases(
  deps: VideoFlowDeps,
  userId: number,
  process: VideoProcess,
  sourceLangId: number,
  options: SaveVideoPhraseOptions = {},
): Promise<number> {
  const all = await deps.videoVocabularyRepository.findPhrasesByProcess(process.id, 0, 100);
  const settings = await deps.userRepository.getSettings(userId);
  const created: SavedPhrase[] = [];
  let count = 0;
  for (const phrase of all.filter((p) => !p.savedEntryId)) {
    const saved = await savePhraseEntry(deps, userId, process, phrase, sourceLangId, settings?.nativeLang);
    if (saved.created) created.push(saved);
    count++;
  }
  if (created.length > 0) {
    void (async () => {
      for (const saved of created) await enrichPhrase(deps, saved, process, userId, options);
    })();
  }
  return count;
}
