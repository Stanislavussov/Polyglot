import {
  ArticleError,
  type ArticleErrorCode,
  extractArticle,
  fetchPage,
  parseArticleUrl,
} from "@polyglot/adapter-article";
import {
  type ArticleProcess,
  buildQuotaPorts,
  processArticle,
  recordAiUsage,
  saveAllArticlePhrases,
  saveArticlePhrase,
  type User,
} from "@polyglot/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { WebServices } from "../services.js";
import { learnerSettings, meterCredits } from "./learn-shared.js";

const PAGE_SIZE = 5;
const PHRASES_PER_PAGE = 10;
/** A run older than this never finished (a restart mid-extraction). */
const STALE_PROCESS_MINUTES = 10;
const EXCERPT_CHARS = 280;

const submitBody = z.object({ url: z.string().trim().min(1).max(2000) });
const idParam = z.object({ id: z.coerce.number().int().positive() });
const pageQuery = z.object({ page: z.coerce.number().int().min(1).default(1) });

const ERROR_STATUS: Record<ArticleErrorCode, number> = {
  invalid_url: 400,
  blocked_host: 400,
  fetch_failed: 502,
  too_large: 422,
  not_html: 422,
  not_an_article: 422,
};

function processView(process: ArticleProcess) {
  return {
    id: process.id,
    title: process.title,
    url: process.url,
    siteName: process.siteName,
    language: process.language,
    wordCount: process.wordCount,
    truncated: process.truncated,
    status: process.status,
    createdAt: process.createdAt.toISOString(),
  };
}

async function ownProcess(services: WebServices, user: User, id: number): Promise<ArticleProcess | null> {
  const process = await services.articleVocabularyRepository.findProcessById(id);
  return process && process.userId === user.id ? process : null;
}

/** A web article → its cleaned body → phrases → the dictionary; the video flow's steps, for pages. */
export function articleRoutes(app: FastifyInstance, services: WebServices): void {
  const repo = services.articleVocabularyRepository;

  app.get("/api/articles", async (request) => {
    const user = request.learner;
    const { page } = pageQuery.parse(request.query);
    const excludeFailed = user.audienceGroup !== "admin";
    const [processes, total] = await Promise.all([
      repo.findProcessesByUser(user.id, page, PAGE_SIZE, excludeFailed),
      repo.countProcessesByUser(user.id, excludeFailed),
    ]);
    return { articles: processes.map(processView), page, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
  });

  app.post("/api/articles", async (request, reply) => {
    const parsed = submitBody.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: "invalid_url" });
    const user = request.learner;

    let requested: string;
    try {
      requested = parseArticleUrl(parsed.data.url).toString();
    } catch (error) {
      const code = error instanceof ArticleError ? error.code : "invalid_url";
      return reply.status(ERROR_STATUS[code]).send({ code });
    }

    await repo.expireStaleProcesses(STALE_PROCESS_MINUTES);
    const sameLink = async (url: string) => {
      const existing = await repo.findProcessByUserAndUrl(user.id, url);
      if (existing?.status === "completed") return { status: "existing" as const, article: processView(existing) };
      if (existing?.status === "pending" || existing?.status === "processing") return "busy" as const;
      return null;
    };
    const before = await sameLink(requested);
    if (before === "busy") return reply.status(409).send({ code: "already_processing" });
    if (before) return before;

    // Checked before the page is fetched, so an exhausted meter costs no outbound request.
    if ((await meterCredits(services, user, reply, "article")) === null) return reply;

    let article: ReturnType<typeof extractArticle>;
    let finalUrl: string;
    try {
      const page = await fetchPage(requested);
      finalUrl = page.url;
      article = extractArticle(page.html, page.url);
    } catch (error) {
      const code = error instanceof ArticleError ? error.code : "fetch_failed";
      request.log.info(
        { url: requested, code, error: error instanceof Error ? error.message : String(error) },
        "Article fetch refused",
      );
      return reply.status(ERROR_STATUS[code]).send({ code });
    }
    if (finalUrl !== requested) {
      const after = await sameLink(finalUrl);
      if (after === "busy") return reply.status(409).send({ code: "already_processing" });
      if (after) return after;
    }

    const { settings } = await learnerSettings(services, user);
    // The declared language is a first guess; the extraction confirms or corrects it.
    const declared = article.language ? services.languageCache.normalizeToIso1(article.language) : undefined;
    const language =
      declared && services.languageCache.isKnownLang(declared)
        ? declared
        : (settings?.learningLangs?.[0] ?? settings?.nativeLang ?? "en");
    const process = await repo.createProcess({
      userId: user.id,
      url: finalUrl,
      title: article.title.slice(0, 300),
      siteName: article.siteName?.slice(0, 120) ?? null,
      language,
      content: article.text,
      wordCount: article.wordCount,
      truncated: article.truncated,
    });
    const excerpt =
      article.text.length > EXCERPT_CHARS ? `${article.text.slice(0, EXCERPT_CHARS).trimEnd()}…` : article.text;
    return { status: "confirm", article: processView(process), excerpt };
  });

  app.post("/api/articles/:id/confirm", async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ code: "invalid_request" });
    const user = request.learner;
    const process = await ownProcess(services, user, params.data.id);
    if (!process) return reply.status(404).send({ code: "not_found" });
    if (process.status !== "pending") return reply.status(409).send({ code: "already_processing" });

    // Billed upfront, as videos are: the extraction runs detached.
    const creditCost = await meterCredits(services, user, reply, "article");
    if (creditCost === null) return reply;
    await recordAiUsage(buildQuotaPorts(services), user.id, "article", creditCost);

    void processArticle(services, process.id);
    return reply.status(202).send({ status: "processing" });
  });

  app.post("/api/articles/:id/cancel", async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ code: "invalid_request" });
    const process = await ownProcess(services, request.learner, params.data.id);
    if (!process) return reply.status(404).send({ code: "not_found" });
    if (process.status === "pending") await repo.updateProcessStatus(process.id, "failed", "Cancelled by user");
    return reply.status(204).send();
  });

  app.get("/api/articles/:id", async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ code: "invalid_request" });
    const { page } = pageQuery.parse(request.query);
    const process = await ownProcess(services, request.learner, params.data.id);
    if (!process) return reply.status(404).send({ code: "not_found" });
    const [phrases, total] = await Promise.all([
      repo.findPhrasesByProcess(process.id, (page - 1) * PHRASES_PER_PAGE, PHRASES_PER_PAGE),
      repo.countPhrasesByProcess(process.id),
    ]);
    return {
      article: processView(process),
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
        saved: p.savedEntryId !== null,
      })),
    };
  });

  app.post("/api/articles/phrases/:id/save", async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ code: "invalid_request" });
    const user = request.learner;
    const phrase = await repo.findPhraseById(params.data.id);
    const process = phrase ? await ownProcess(services, user, phrase.articleProcessId) : null;
    if (!phrase || !process) return reply.status(404).send({ code: "not_found" });
    if (phrase.savedEntryId) return { saved: 0, alreadySaved: true };
    const sourceLang = services.languageCache.getLang(process.language);
    if (!sourceLang) return reply.status(422).send({ code: "language_not_found" });
    await saveArticlePhrase(services, user.id, process, phrase, sourceLang.id, user.subscriptionPlan ?? undefined);
    return { saved: 1, alreadySaved: false };
  });

  app.post("/api/articles/:id/save-all", async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ code: "invalid_request" });
    const user = request.learner;
    const process = await ownProcess(services, user, params.data.id);
    if (!process) return reply.status(404).send({ code: "not_found" });
    const sourceLang = services.languageCache.getLang(process.language);
    if (!sourceLang) return reply.status(422).send({ code: "language_not_found" });
    const saved = await saveAllArticlePhrases(
      services,
      user.id,
      process,
      sourceLang.id,
      user.subscriptionPlan ?? undefined,
    );
    return { saved, alreadySaved: false };
  });
}
