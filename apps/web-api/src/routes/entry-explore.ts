import { composeCardMentorTurn, getLanguageName, logEvent, t, toTranslateOutput } from "@polyglot/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { WebServices } from "../services.js";
import { speakableCard } from "./card-audio.js";
import { answerEtymology, mentorTurns } from "./card-explore.js";
import { ownedLiveEntry } from "./dictionary.js";
import { langCode } from "./lang-code.js";
import { answerMentorTurn, mentorHistorySchema } from "./mentor-chat.js";

const entryParams = z.object({ entryId: z.coerce.number().int().positive() });
const mentorBody = z.object({
  question: z.string().trim().min(1).max(2_000).optional(),
  history: mentorHistorySchema.optional(),
});

/** The dictionary card's "Ask" pages: the mentor and the etymology of a word the learner saved. */
export function entryExploreRoutes(app: FastifyInstance, services: WebServices): void {
  // Saved on the entry: asked once, shown on the card for good and never billed again.
  app.post("/api/dictionary/:entryId/etymology", async (request, reply) => {
    const params = entryParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ code: "invalid_entry" });
    const entry = await ownedLiveEntry(services, request.learner.id, params.data.entryId);
    if (!entry) return reply.status(404).send({ code: "not_found" });
    if (entry.etymology) return { etymology: entry.etymology };

    const card = speakableCard(services, entry);
    const etymology = await answerEtymology(services, request.learner, reply, {
      original: entry.original,
      sourceLang: card.sourceLang,
      inputType: entry.inputType,
    });
    if (etymology === null) return reply;
    await services.vocabularyRepository.updateEntry(entry.id, { etymology });
    return { etymology };
  });

  app.post("/api/dictionary/:entryId/mentor", async (request, reply) => {
    const params = entryParams.safeParse(request.params);
    const body = mentorBody.safeParse(request.body);
    if (!params.success || !body.success) return reply.status(400).send({ code: "invalid_question" });
    const entry = await ownedLiveEntry(services, request.learner.id, params.data.entryId);
    if (!entry) return reply.status(404).send({ code: "not_found" });

    // The full saved card, as the bot hands its own card to the mentor.
    const output = toTranslateOutput(entry, (id) => langCode(services, id) || undefined);
    if (!output) return reply.status(404).send({ code: "not_found" });
    const { question, history = [] } = body.data;
    let asked = question ?? "";
    const answer = await answerMentorTurn(services, request.learner, reply, (lang) => {
      asked =
        question ??
        t("cardMentorQuestion", lang, { text: entry.original, lang: getLanguageName(output.sourceLang, lang) });
      return mentorTurns(
        (q) => composeCardMentorTurn({ output, ...(entry.etymology ? { etymology: entry.etymology } : {}) }, q),
        history,
        asked,
      );
    });
    if (answer === null) return reply;
    logEvent("card.mentor_asked", {
      lang: output.sourceLang,
      withCard: true,
      explain: question === undefined,
      channel: "web",
    });
    return { question: asked, answer };
  });
}
