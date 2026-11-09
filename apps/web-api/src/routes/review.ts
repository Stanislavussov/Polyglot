import {
  type CardFrontFields,
  logEvent,
  orderRecordEntries,
  rateEntry,
  recordMatureIfCrossed,
  type SrsDueVocabularyCard,
  type User,
} from "@polyglot/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { WebServices } from "../services.js";
import { cardAudio, languageOrder } from "./card-audio.js";
import { toDictionaryDetail } from "./dictionary.js";

const rateSchema = z.object({ rating: z.enum(["again", "hard", "good", "easy"]) });
const paramsSchema = z.object({ entryId: z.coerce.number().int().positive() });

/**
 * The hidden-answer side, as the bot's `renderCardFront` builds it: the citation
 * headword plus only the recall aids the user's card settings switch on.
 */
function cardFront(detail: ReturnType<typeof toDictionaryDetail>, recallHint: string | null, fields: CardFrontFields) {
  const usage = detail.sourceUsage;
  return {
    headword: usage?.headword?.trim() ? usage.headword : detail.original,
    synonyms: fields.synonyms ? (usage?.synonyms ?? []) : [],
    example: fields.example ? (usage?.examples[0]?.target ?? null) : null,
    hint: fields.hint ? recallHint?.trim() || null : null,
    // Whether the word has each aid at all, independent of the settings: an aid it lacks cannot be switched on.
    available: {
      hint: Boolean(recallHint?.trim()),
      synonyms: (usage?.synonyms.length ?? 0) > 0,
      example: Boolean(usage?.examples[0]?.target),
    },
  };
}

/** The answer is the saved word exactly as the dictionary shows it, as on the bot's flipped card. */
async function toReviewCard(services: WebServices, user: User, head: SrsDueVocabularyCard, ahead: boolean) {
  const entry = await services.vocabularyRepository.findById(head.entryId);
  if (!entry) return null;
  const [order, fields] = await Promise.all([
    languageOrder(services, user.id),
    services.cardTemplateRepository.getFields(user.id),
  ]);
  const detail = toDictionaryDetail(services, entry);
  const byLang = Object.fromEntries(detail.details.map((d) => [d.lang, d]));
  return {
    entryId: entry.id,
    ahead,
    front: cardFront(detail, entry.sourceUsage?.recallHint ?? null, fields),
    detail: { ...detail, details: orderRecordEntries(byLang, order).map(([, d]) => d) },
    audio: await cardAudio(services, user, entry, order),
  };
}

/**
 * Stateless "next card": the deck the bot builds is due cards first, then
 * practice-ahead ones, so the head of that order is the due card or, with none
 * due, the weakest card ahead. The web keeps no session deck between requests.
 */
async function nextCard(services: WebServices, user: User) {
  const now = new Date();
  const [due] = await services.vocabularyRepository.findDueForSrs(user.id, now, 1);
  const [ahead] = due ? [] : await services.vocabularyRepository.findAheadForSrs(user.id, now, 1);
  const head = due ?? ahead;
  const dueCount = await services.vocabularyRepository.countDueForSrs(user.id, now);
  return { card: head ? await toReviewCard(services, user, head, !due) : null, dueCount };
}

export function reviewRoutes(app: FastifyInstance, services: WebServices): void {
  app.get("/api/review/next", async (request) => nextCard(services, request.learner));

  // "Review this word now" from the dictionary: the card the deck would draw for it.
  app.get("/api/review/card/:entryId", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ code: "invalid_entry" });
    const user = request.learner;
    const row = await services.vocabularyRepository.findEntrySrsCard(user.id, params.data.entryId);
    const card = row ? await toReviewCard(services, user, row, false) : null;
    if (!card) return reply.status(404).send({ code: "not_found" });
    return { card, dueCount: await services.vocabularyRepository.countDueForSrs(user.id, new Date()) };
  });

  app.post("/api/review/:entryId", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const body = rateSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.status(400).send({ code: "invalid_rating" });
    const user = request.learner;

    // Same write path as a bot flashcard rating: grade, SM-2 per language row, review log.
    const written = await rateEntry(
      { vocabulary: services.vocabularyRepository, reviews: services.wordReviewRepository },
      user.id,
      params.data.entryId,
      body.data.rating,
      "web",
    );
    if (!written) return reply.status(404).send({ code: "not_found" });
    for (const [translationId, result] of written) {
      await recordMatureIfCrossed(services.momentumService, {
        userId: user.id,
        entryId: params.data.entryId,
        translationId,
        interval: result.interval,
      });
    }
    logEvent("web.card_rated", { entryId: params.data.entryId, rating: body.data.rating, scheduled: written.size });
    return nextCard(services, user);
  });
}
