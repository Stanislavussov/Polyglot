import { type Example, logEvent, type VocabularyEntryWithTranslations } from "@polyglot/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { WebServices } from "../services.js";

export const DICTIONARY_PAGE_SIZE = 20;

const querySchema = z.object({
  q: z.string().max(100).optional(),
  sort: z.enum(["recent", "alpha"]).default("recent"),
  page: z.coerce.number().int().min(1).default(1),
  lang: z.string().max(10).optional(),
  type: z.enum(["word", "phrase", "sentence"]).optional(),
  difficulty: z.enum(["hard", "normal", "easy"]).optional(),
  review: z.enum(["due", "new", "learned"]).optional(),
});

export function langCode(services: WebServices, langId: number): string {
  return services.languageCache.getAllLangs().find((lang) => lang.id === langId)?.code ?? "";
}

export function toDictionaryItem(services: WebServices, entry: VocabularyEntryWithTranslations) {
  return {
    id: entry.id,
    original: entry.original,
    sourceLang: langCode(services, entry.sourceLangId),
    emoji: entry.emoji,
    createdAt: entry.createdAt.toISOString(),
    translations: entry.translations.map((t) => ({ lang: langCode(services, t.targetLangId), text: t.text })),
  };
}

export function dictionaryRoutes(app: FastifyInstance, services: WebServices): void {
  // The default dictionary is the one the bot's /dictionary opens and every save lands in.
  app.get("/api/dictionary", async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ code: "invalid_query" });
    const { q, sort, page, lang, type, difficulty, review } = parsed.data;
    const userId = request.learner.id;
    const search = q?.trim() || undefined;
    const langId = lang ? services.languageCache.getLang(lang)?.id : undefined;
    if (lang && langId === undefined) return reply.status(400).send({ code: "invalid_query" });
    const filters = { langId, inputType: type, difficulty, review };

    const dictionary = await services.vocabularyDictionaryRepository.getOrCreateDefault(userId);
    const total = await services.vocabularyRepository.countByUser(userId, dictionary.id, search, filters);
    const entries = await services.vocabularyRepository.findByUserPaginated(
      userId,
      (page - 1) * DICTIONARY_PAGE_SIZE,
      DICTIONARY_PAGE_SIZE,
      dictionary.id,
      { sort, search, ...filters },
    );
    return {
      items: entries.map((entry) => toDictionaryItem(services, entry)),
      total,
      page,
      pageSize: DICTIONARY_PAGE_SIZE,
    };
  });

  const entryParams = z.object({ entryId: z.coerce.number().int().positive() });

  // Soft delete and its undo, owner-scoped in the repository: the same pair the
  // bot's Remove / Save buttons use, so a word removed here is gone there too.
  app.delete("/api/dictionary/:entryId", async (request, reply) => {
    const params = entryParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ code: "invalid_entry" });
    if (!(await services.vocabularyRepository.delete(params.data.entryId, request.learner.id))) {
      return reply.status(404).send({ code: "not_found" });
    }
    logEvent("vocabulary.removed", { entryId: params.data.entryId, surface: "web" });
    return reply.status(204).send();
  });

  app.post("/api/dictionary/:entryId/restore", async (request, reply) => {
    const params = entryParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ code: "invalid_entry" });
    if (!(await services.vocabularyRepository.restore(params.data.entryId, request.learner.id))) {
      return reply.status(404).send({ code: "not_found" });
    }
    logEvent("vocabulary.restored", { entryId: params.data.entryId, surface: "web" });
    return reply.status(204).send();
  });

  // The full saved card: everything the bot shows on a saved word, plus its review schedule.
  app.get("/api/dictionary/:entryId", async (request, reply) => {
    const params = entryParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ code: "invalid_entry" });
    const entry = await services.vocabularyRepository.findById(params.data.entryId);
    if (!entry || entry.userId !== request.learner.id || !entry.isActive) {
      return reply.status(404).send({ code: "not_found" });
    }
    return toDictionaryDetail(services, entry);
  });
}

const exampleView = (e: Example) => ({ context: e.context, target: e.target, native: e.native ?? null });

export function toDictionaryDetail(services: WebServices, entry: VocabularyEntryWithTranslations) {
  return {
    ...toDictionaryItem(services, entry),
    inputType: entry.inputType,
    nativeMeaning: entry.nativeMeaning,
    difficulty: entry.difficulty,
    sourceUsage: entry.sourceUsage
      ? {
          headword: entry.sourceUsage.headword ?? null,
          explanation: entry.sourceUsage.explanation,
          synonyms: entry.sourceUsage.synonyms.map((x) => x.text),
          examples: entry.sourceUsage.examples.map(exampleView),
        }
      : null,
    details: entry.translations.map((t) => ({
      lang: langCode(services, t.targetLangId),
      text: t.text,
      expressionType: t.expressionType,
      equivalentNote: t.equivalentNote,
      usageNote: t.usageNote,
      connotationWarning: t.connotationWarning,
      synonyms: (t.details?.synonyms ?? []).map((x) => x.text),
      alternatives: (t.details?.alternatives ?? []).map((x) => x.text),
      examples: (t.details?.examples ?? []).map(exampleView),
      review: {
        dueAt: t.srsDueDate ? t.srsDueDate.toISOString() : null,
        intervalDays: t.srsInterval,
        reviewCount: t.srsReviewCount,
      },
    })),
  };
}
