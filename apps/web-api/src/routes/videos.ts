import {
  extractVideoId,
  fetchMetadata,
  fetchTranscript,
  formatSegmentedTranscript,
  TranscriptNotAvailableError,
} from "@polyglot/adapter-youtube";
import {
  buildQuotaPorts,
  checkVideoAllowance,
  getVideoSuggestionsForLangs,
  logEvent,
  processVideo,
  recordAiUsage,
  resolveVideoSuggestion,
  saveAllVideoPhrases,
  saveVideoPhrase,
  type TranscriptSource,
  type User,
  type VideoProcess,
} from "@polyglot/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { WebServices } from "../services.js";
import { learnerSettings, meterCredits } from "./learn-shared.js";

const PAGE_SIZE = 5;
const PHRASES_PER_PAGE = 10;
/** A run older than this never finished (a restart mid-extraction); expiring it refunds the slot. */
const STALE_PROCESS_MINUTES = 10;

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

const submitBody = z.union([
  z.object({ url: z.string().trim().min(1).max(500) }),
  z.object({ suggestion: z.object({ lang: z.string().min(2).max(8), index: z.number().int().min(0) }) }),
]);
const idParam = z.object({ id: z.coerce.number().int().positive() });
const pageQuery = z.object({ page: z.coerce.number().int().min(1).default(1) });

function processView(process: VideoProcess) {
  return {
    id: process.id,
    title: process.title,
    url: process.videoUrl,
    durationSeconds: process.durationSeconds,
    language: process.language,
    status: process.status,
    createdAt: process.createdAt.toISOString(),
  };
}

async function ownProcess(services: WebServices, user: User, id: number): Promise<VideoProcess | null> {
  const process = await services.videoVocabularyRepository.findProcessById(id);
  return process && process.userId === user.id ? process : null;
}

/** The bot's video vocabulary (`lrn:videos`): a YouTube link → phrases → the dictionary. */
export function videoRoutes(app: FastifyInstance, services: WebServices): void {
  app.get("/api/videos", async (request) => {
    const user = request.learner;
    const { page } = pageQuery.parse(request.query);
    // A failed run is noise to a learner; admins keep seeing it, as in the bot.
    const excludeFailed = user.audienceGroup !== "admin";
    const [processes, total, { settings }] = await Promise.all([
      services.videoVocabularyRepository.findProcessesByUser(user.id, page, PAGE_SIZE, excludeFailed),
      services.videoVocabularyRepository.countProcessesByUser(user.id, excludeFailed),
      learnerSettings(services, user),
    ]);
    return {
      videos: processes.map(processView),
      page,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      suggestions: getVideoSuggestionsForLangs(settings?.learningLangs ?? []).map((s) => ({
        lang: s.lang,
        index: s.index,
        title: s.title,
        channel: s.channel,
        flag: services.languageCache.getLangFlag(s.lang),
      })),
    };
  });

  app.post("/api/videos", async (request, reply) => {
    const parsed = submitBody.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: "invalid_url" });
    const user = request.learner;
    const fromOnboarding = "suggestion" in parsed.data;
    const url =
      "suggestion" in parsed.data
        ? resolveVideoSuggestion(parsed.data.suggestion.lang, parsed.data.suggestion.index)?.url
        : parsed.data.url;
    const videoId = url ? extractVideoId(url) : null;
    if (!videoId) return reply.status(400).send({ code: "invalid_url" });

    await services.videoVocabularyRepository.expireStaleProcesses(STALE_PROCESS_MINUTES);
    const existing = await services.videoVocabularyRepository.findProcessByUserAndVideo(user.id, videoId);
    if (existing?.status === "completed") return { status: "existing", video: processView(existing) };
    if (existing?.status === "processing" || existing?.status === "pending") {
      return reply.status(409).send({ code: "already_processing" });
    }

    const allowance = await checkVideoAllowance(services, user, { fromOnboarding });
    if (!allowance.ok) {
      logEvent("limit.reached", { userId: user.id, reason: "video", channel: "web" });
      return reply.status(429).send({ code: "video_limit" });
    }

    let metadata: { title: string; durationSeconds: number };
    try {
      metadata = await fetchMetadata(videoId);
    } catch {
      return reply.status(502).send({ code: "metadata_failed" });
    }

    // The process row reserves the allowance slot until confirm or cancel.
    const { settings } = await learnerSettings(services, user);
    const process = await services.videoVocabularyRepository.createProcess({
      userId: user.id,
      videoId,
      videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
      title: metadata.title,
      durationSeconds: metadata.durationSeconds,
      // A best guess the transcript refines.
      language: settings?.learningLangs?.[0] ?? settings?.nativeLang ?? "en",
      isTrial: allowance.isTrial,
    });
    return {
      status: "confirm",
      video: processView(process),
      remaining: allowance.remaining,
      limit: allowance.limit,
    };
  });

  app.post("/api/videos/:id/confirm", async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ code: "invalid_request" });
    const user = request.learner;
    const process = await ownProcess(services, user, params.data.id);
    if (!process) return reply.status(404).send({ code: "not_found" });
    if (process.status !== "pending") return reply.status(409).send({ code: "already_processing" });

    // Billed upfront, as in the bot: the extraction runs detached, so there is no later moment to bill on.
    const creditCost = await meterCredits(services, user, reply, "video");
    if (creditCost === null) return reply;
    await recordAiUsage(buildQuotaPorts(services), user.id, "video", creditCost);

    void processVideo(services, process.id, user.id, youtubeTranscripts);
    return reply.status(202).send({ status: "processing" });
  });

  app.post("/api/videos/:id/cancel", async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ code: "invalid_request" });
    const process = await ownProcess(services, request.learner, params.data.id);
    if (!process) return reply.status(404).send({ code: "not_found" });
    // Marked failed, which refunds the allowance slot.
    await services.videoVocabularyRepository.updateProcessStatus(process.id, "failed", "Cancelled by user");
    return reply.status(204).send();
  });

  app.get("/api/videos/:id", async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ code: "invalid_request" });
    const { page } = pageQuery.parse(request.query);
    const process = await ownProcess(services, request.learner, params.data.id);
    if (!process) return reply.status(404).send({ code: "not_found" });
    const [phrases, total] = await Promise.all([
      services.videoVocabularyRepository.findPhrasesByProcess(
        process.id,
        (page - 1) * PHRASES_PER_PAGE,
        PHRASES_PER_PAGE,
      ),
      services.videoVocabularyRepository.countPhrasesByProcess(process.id),
    ]);
    return {
      video: processView(process),
      page,
      totalPages: Math.max(1, Math.ceil(total / PHRASES_PER_PAGE)),
      phrases: phrases.map((p) => ({
        id: p.id,
        phrase: p.phrase,
        nativeTranslation: p.nativeTranslation,
        emoji: p.emoji,
        type: p.phraseType,
        level: p.level,
        context: p.context,
        timestampSeconds: p.timestampSeconds,
        saved: p.savedEntryId !== null,
      })),
    };
  });

  app.post("/api/videos/phrases/:id/save", async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ code: "invalid_request" });
    const user = request.learner;
    const phrase = await services.videoVocabularyRepository.findPhraseById(params.data.id);
    const process = phrase ? await ownProcess(services, user, phrase.videoProcessId) : null;
    if (!phrase || !process) return reply.status(404).send({ code: "not_found" });
    if (phrase.savedEntryId) return { saved: 0, alreadySaved: true };
    const sourceLang = services.languageCache.getLang(process.language);
    if (!sourceLang) return reply.status(422).send({ code: "language_not_found" });
    await saveVideoPhrase(services, user.id, process, phrase, sourceLang.id, { plan: user.subscriptionPlan });
    return { saved: 1, alreadySaved: false };
  });

  app.post("/api/videos/:id/save-all", async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ code: "invalid_request" });
    const user = request.learner;
    const process = await ownProcess(services, user, params.data.id);
    if (!process) return reply.status(404).send({ code: "not_found" });
    const sourceLang = services.languageCache.getLang(process.language);
    if (!sourceLang) return reply.status(422).send({ code: "language_not_found" });
    const saved = await saveAllVideoPhrases(services, user.id, process, sourceLang.id, { plan: user.subscriptionPlan });
    return { saved, alreadySaved: false };
  });
}
