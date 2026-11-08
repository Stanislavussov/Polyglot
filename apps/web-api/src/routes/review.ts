import { logEvent, rateEntry } from "@polyglot/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { WebServices } from "../services.js";
import { langCode } from "./dictionary.js";

const rateSchema = z.object({ rating: z.enum(["again", "hard", "good", "easy"]) });
const paramsSchema = z.object({ entryId: z.coerce.number().int().positive() });

/**
 * Stateless "next card": the deck the bot builds is due cards first, then
 * practice-ahead ones, so the head of that order is the due card or, with none
 * due, the weakest card ahead. The web keeps no session deck between requests.
 */
async function nextCard(services: WebServices, userId: number) {
  const now = new Date();
  const [due] = await services.vocabularyRepository.findDueForSrs(userId, now, 1);
  const [ahead] = due ? [] : await services.vocabularyRepository.findAheadForSrs(userId, now, 1);
  const head = due ?? ahead;
  const dueCount = await services.vocabularyRepository.countDueForSrs(userId, now);
  if (!head) return { card: null, dueCount };

  const entry = await services.vocabularyRepository.findById(head.entryId);
  return {
    card: {
      entryId: head.entryId,
      original: head.original,
      sourceLang: langCode(services, head.sourceLangId),
      emoji: head.emoji,
      back: (entry?.translations ?? []).map((t) => ({ lang: langCode(services, t.targetLangId), text: t.text })),
    },
    dueCount,
  };
}

export function reviewRoutes(app: FastifyInstance, services: WebServices): void {
  app.get("/api/review/next", async (request) => nextCard(services, request.learner.id));

  // "Review this word now" from the dictionary: the card the deck would draw for it.
  app.get("/api/review/card/:entryId", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ code: "invalid_entry" });
    const userId = request.learner.id;
    const row = await services.vocabularyRepository.findEntrySrsCard(userId, params.data.entryId);
    if (!row) return reply.status(404).send({ code: "not_found" });
    const entry = await services.vocabularyRepository.findById(row.entryId);
    return {
      card: {
        entryId: row.entryId,
        original: row.original,
        sourceLang: langCode(services, row.sourceLangId),
        emoji: row.emoji,
        back: (entry?.translations ?? []).map((t) => ({ lang: langCode(services, t.targetLangId), text: t.text })),
      },
      dueCount: await services.vocabularyRepository.countDueForSrs(userId, new Date()),
    };
  });

  app.post("/api/review/:entryId", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const body = rateSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.status(400).send({ code: "invalid_rating" });
    const userId = request.learner.id;

    // Same write path as a bot flashcard rating: grade, SM-2 per language row, review log.
    const written = await rateEntry(
      { vocabulary: services.vocabularyRepository, reviews: services.wordReviewRepository },
      userId,
      params.data.entryId,
      body.data.rating,
      "web",
    );
    if (!written) return reply.status(404).send({ code: "not_found" });
    logEvent("web.card_rated", { entryId: params.data.entryId, rating: body.data.rating, scheduled: written.size });
    return nextCard(services, userId);
  });
}
