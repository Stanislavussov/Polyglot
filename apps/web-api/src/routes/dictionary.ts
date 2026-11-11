import {
  acceptDictionaryName,
  type Example,
  type LanguageOrderContext,
  logEvent,
  selectPronounceableLangs,
  type VocabularyDictionary,
  type VocabularyEntryWithTranslations,
} from "@polyglot/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { WebServices } from "../services.js";
import { audioAccess, languageOrder, speakableCard } from "./card-audio.js";
import { langCode } from "./lang-code.js";

export const DICTIONARY_PAGE_SIZE = 20;

const querySchema = z.object({
  q: z.string().max(100).optional(),
  sort: z.enum(["recent", "alpha"]).default("recent"),
  page: z.coerce.number().int().min(1).default(1),
  lang: z.string().max(10).optional(),
  type: z.enum(["word", "phrase", "sentence"]).optional(),
  difficulty: z.enum(["hard", "normal", "easy"]).optional(),
  review: z.enum(["due", "new", "learned"]).optional(),
  dictionary: z.coerce.number().int().positive().optional(),
});

// One emoji, possibly several code points (flags, skin tones, ZWJ sequences) — never free text.
const iconValue = z.string().trim().min(1).max(16).nullable();
const nameSchema = z.object({ name: z.string().max(200), icon: iconValue.optional() });
const iconSchema = z.object({ icon: iconValue });
const dictionaryParams = z.object({ dictionaryId: z.coerce.number().int().positive() });
const entryParams = z.object({ entryId: z.coerce.number().int().positive() });
const targetQuery = z.object({ dictionary: z.coerce.number().int().positive().optional() });
const placeBody = z.object({ to: z.number().int().positive(), from: z.number().int().positive().optional() });

export function toDictionaryItem(
  services: WebServices,
  entry: VocabularyEntryWithTranslations,
  order?: LanguageOrderContext,
) {
  const sourceLang = langCode(services, entry.sourceLangId);
  return {
    id: entry.id,
    original: entry.original,
    sourceLang,
    emoji: entry.emoji,
    // The same rule the audio route checks, so the speaker only shows where tapping it plays.
    speakable: order ? selectPronounceableLangs(speakableCard(services, entry), order).includes(sourceLang) : false,
    createdAt: entry.createdAt.toISOString(),
    translations: entry.translations.map((t) => ({ lang: langCode(services, t.targetLangId), text: t.text })),
  };
}

function toDictionaryView(dictionary: VocabularyDictionary & { entryCount?: number }) {
  return {
    id: dictionary.id,
    name: dictionary.name,
    icon: dictionary.icon,
    isDefault: dictionary.isDefault,
    count: dictionary.entryCount ?? 0,
  };
}

async function ownedLiveEntry(services: WebServices, userId: number, entryId: number) {
  const entry = await services.vocabularyRepository.findById(entryId);
  return entry && entry.userId === userId && entry.isActive ? entry : null;
}

export function dictionaryRoutes(app: FastifyInstance, services: WebServices): void {
  const repo = services.vocabularyDictionaryRepository;

  // The same collections the bot's dictionary switcher lists, default first.
  app.get("/api/dictionaries", async (request) => ({
    items: (await repo.listByUser(request.learner.id)).map(toDictionaryView),
  }));

  app.post("/api/dictionaries", async (request, reply) => {
    const body = nameSchema.safeParse(request.body);
    const userId = request.learner.id;
    const name = body.success
      ? acceptDictionaryName(repo.normalizeName(body.data.name), await repo.listByUser(userId))
      : null;
    if (!name) return reply.status(400).send({ code: "invalid_name" });
    const dictionary = await repo.create(userId, name, body.success ? (body.data.icon ?? null) : null);
    logEvent("dictionary.created", { dictionaryId: dictionary.id, nameLength: name.length, surface: "web" });
    return reply.status(201).send(toDictionaryView(dictionary));
  });

  app.patch("/api/dictionaries/:dictionaryId", async (request, reply) => {
    const params = dictionaryParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ code: "invalid_dictionary" });
    const { dictionaryId } = params.data;
    const userId = request.learner.id;
    const body = nameSchema.safeParse(request.body);
    const name = body.success
      ? acceptDictionaryName(repo.normalizeName(body.data.name), await repo.listByUser(userId), dictionaryId)
      : null;
    if (!name) return reply.status(400).send({ code: "invalid_name" });
    // The repository refuses the default dictionary, as the bot hides Rename on it.
    const renamed = await repo.rename(userId, dictionaryId, name);
    if (!renamed) return reply.status(404).send({ code: "not_found" });
    logEvent("dictionary.renamed", { dictionaryId, nameLength: name.length, surface: "web" });
    return toDictionaryView(renamed);
  });

  app.patch("/api/dictionaries/:dictionaryId/icon", async (request, reply) => {
    const params = dictionaryParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ code: "invalid_dictionary" });
    const body = iconSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ code: "invalid_icon" });
    const updated = await repo.setIcon(request.learner.id, params.data.dictionaryId, body.data.icon);
    if (!updated) return reply.status(404).send({ code: "not_found" });
    logEvent("dictionary.icon_set", { dictionaryId: updated.id, cleared: body.data.icon === null, surface: "web" });
    return toDictionaryView(updated);
  });

  app.delete("/api/dictionaries/:dictionaryId", async (request, reply) => {
    const params = dictionaryParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ code: "invalid_dictionary" });
    const { dictionaryId } = params.data;
    const deleted = await repo.delete(request.learner.id, dictionaryId);
    logEvent("dictionary.deleted", { dictionaryId, deleted, surface: "web" });
    if (!deleted) return reply.status(404).send({ code: "not_found" });
    return reply.status(204).send();
  });

  // Without `dictionary`, the default one: what the bot's /dictionary opens and every save lands in.
  app.get("/api/dictionary", async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ code: "invalid_query" });
    const { q, sort, page, lang, type, difficulty, review } = parsed.data;
    const userId = request.learner.id;
    const search = q?.trim() || undefined;
    const langId = lang ? services.languageCache.getLang(lang)?.id : undefined;
    if (lang && langId === undefined) return reply.status(400).send({ code: "invalid_query" });
    const filters = { langId, inputType: type, difficulty, review };

    const dictionary = parsed.data.dictionary
      ? await repo.findOwnedById(userId, parsed.data.dictionary)
      : await repo.getOrCreateDefault(userId);
    if (!dictionary) return reply.status(404).send({ code: "not_found" });
    const total = await services.vocabularyRepository.countByUser(userId, dictionary.id, search, filters);
    const entries = await services.vocabularyRepository.findByUserPaginated(
      userId,
      (page - 1) * DICTIONARY_PAGE_SIZE,
      DICTIONARY_PAGE_SIZE,
      dictionary.id,
      { sort, search, ...filters },
    );
    const order = await languageOrder(services, userId);
    return {
      items: entries.map((entry) => toDictionaryItem(services, entry, order)),
      audio: await audioAccess(services, request.learner),
      dictionary: toDictionaryView(dictionary),
      total,
      page,
      pageSize: DICTIONARY_PAGE_SIZE,
    };
  });

  // Soft delete and its undo, owner-scoped in the repository: the same pair the
  // bot's Remove / Save buttons use, so a word removed here is gone there too.
  // With `dictionary`, a word that also lives in another dictionary only leaves this
  // one, as the bot's dictionary delete does.
  app.delete("/api/dictionary/:entryId", async (request, reply) => {
    const params = entryParams.safeParse(request.params);
    const target = targetQuery.safeParse(request.query);
    if (!params.success || !target.success) return reply.status(400).send({ code: "invalid_entry" });
    const { entryId } = params.data;
    const dictionaryId = target.data.dictionary;
    const userId = request.learner.id;
    if (dictionaryId !== undefined) {
      if (!(await ownedLiveEntry(services, userId, entryId)) || !(await repo.findOwnedById(userId, dictionaryId))) {
        return reply.status(404).send({ code: "not_found" });
      }
      const memberships = await repo.listEntryDictionaries(userId, entryId);
      if (memberships.some((dictionary) => dictionary.id !== dictionaryId)) {
        await repo.removeEntry(dictionaryId, entryId);
        logEvent("dictionary.entry_removed", { dictionaryId, entryId, wordRemoved: false, surface: "web" });
        return reply.status(204).send();
      }
    }
    if (!(await services.vocabularyRepository.delete(entryId, userId))) {
      return reply.status(404).send({ code: "not_found" });
    }
    logEvent("vocabulary.removed", { entryId, surface: "web" });
    return reply.status(204).send();
  });

  app.post("/api/dictionary/:entryId/restore", async (request, reply) => {
    const params = entryParams.safeParse(request.params);
    const target = targetQuery.safeParse(request.query);
    if (!params.success || !target.success) return reply.status(400).send({ code: "invalid_entry" });
    const { entryId } = params.data;
    const dictionaryId = target.data.dictionary;
    const userId = request.learner.id;
    const restored = await services.vocabularyRepository.restore(entryId, userId);
    if (dictionaryId === undefined) {
      if (!restored) return reply.status(404).send({ code: "not_found" });
    } else {
      // Not restored is fine for a word that only left this dictionary: it stayed live.
      if (!(await ownedLiveEntry(services, userId, entryId)) || !(await repo.findOwnedById(userId, dictionaryId))) {
        return reply.status(404).send({ code: "not_found" });
      }
      await repo.addEntry(dictionaryId, entryId);
    }
    logEvent("vocabulary.restored", { entryId, surface: "web" });
    return reply.status(204).send();
  });

  // Add to another dictionary, or move there when `from` is given: the bot's dict:add / dict:move.
  app.post("/api/dictionary/:entryId/dictionaries", async (request, reply) => {
    const params = entryParams.safeParse(request.params);
    const body = placeBody.safeParse(request.body);
    if (!params.success || !body.success) return reply.status(400).send({ code: "invalid_entry" });
    const { entryId } = params.data;
    const { to, from } = body.data;
    const userId = request.learner.id;
    const target = await repo.findOwnedById(userId, to);
    if (!target || !(await ownedLiveEntry(services, userId, entryId))) {
      return reply.status(404).send({ code: "not_found" });
    }
    if (from === undefined) {
      await repo.addEntry(to, entryId);
      logEvent("dictionary.entry_added", { toDictionaryId: to, entryId, surface: "web" });
    } else {
      if (!(await repo.moveEntry(userId, from, to, entryId))) return reply.status(404).send({ code: "not_found" });
      logEvent("dictionary.entry_moved", { fromDictionaryId: from, toDictionaryId: to, entryId, surface: "web" });
    }
    return toDictionaryView(target);
  });

  // The full saved card: everything the bot shows on a saved word, plus its review schedule.
  app.get("/api/dictionary/:entryId", async (request, reply) => {
    const params = entryParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ code: "invalid_entry" });
    const entry = await ownedLiveEntry(services, request.learner.id, params.data.entryId);
    if (!entry) return reply.status(404).send({ code: "not_found" });
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
