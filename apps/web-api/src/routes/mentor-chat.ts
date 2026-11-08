import {
  AITimeoutError,
  buildAiFailover,
  buildQuotaPorts,
  type ChatMessage,
  checkMentorDailyQuota,
  errorFields,
  FEATURE_KEYS,
  logEvent,
  MAX_MENTOR_HISTORY,
  MENTOR_MAX_INPUT_LENGTH,
  recordAiUsage,
  resolveMentorSetup,
  type SupportedLang,
  TRANSLATION_HARD_TIMEOUT_MS,
  type User,
} from "@polyglot/core";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { WebServices } from "../services.js";
import { featureLocked, hasFeature, learnerSettings, meterCredits } from "./learn-shared.js";

export const mentorHistorySchema = z
  .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(8_000) }))
  .max(MAX_MENTOR_HISTORY * 2);

/**
 * One mentor turn, gated and metered in the bot's order: the plan gate, the per-plan
 * daily cap, then the credit meter; billed only once the model answered. Returns the
 * answer, or null after sending the refusal.
 *
 * `compose` receives the interface language and returns the thread the model reads.
 */
export async function answerMentorTurn(
  services: WebServices,
  user: User,
  reply: FastifyReply,
  compose: (lang: SupportedLang) => ChatMessage[],
): Promise<string | null> {
  if (!(await hasFeature(services, user, FEATURE_KEYS.mentor))) {
    await featureLocked(reply, FEATURE_KEYS.mentor);
    return null;
  }
  const daily = await checkMentorDailyQuota(buildQuotaPorts(services), user);
  if (!daily.ok) {
    logEvent("limit.reached", { userId: user.id, reason: "mentor", channel: "web" });
    await reply.status(429).send({ code: "mentor_limit", limit: daily.limit });
    return null;
  }
  const creditCost = await meterCredits(services, user, reply, "mentor");
  if (creditCost === null) return null;

  const { settings, lang } = await learnerSettings(services, user);
  const setup = await resolveMentorSetup(services, user, settings, lang);
  try {
    const answer = await services.ai.generateChat(
      [{ role: "system", content: setup.systemPrompt }, ...compose(lang)],
      setup.model,
      {
        maxTokens: setup.maxTokens,
        userId: user.id,
        budgetMs: TRANSLATION_HARD_TIMEOUT_MS,
        failover: buildAiFailover(TRANSLATION_HARD_TIMEOUT_MS, setup.fallbackModel),
      },
    );
    await recordAiUsage(buildQuotaPorts(services), user.id, "mentor", creditCost);
    return answer;
  } catch (err) {
    logEvent("mentor.failed", { channel: "web", ...errorFields(err) }, "error");
    await reply.status(err instanceof AITimeoutError ? 504 : 502).send({ code: "mentor_failed" });
    return null;
  }
}

const chatBody = z.object({
  question: z.string().trim().min(1),
  history: mentorHistorySchema.optional(),
});

/**
 * The standalone mentor chat. Threads live in the browser: `mentor_messages` is keyed
 * by Telegram chat and message ids (both NOT NULL), so a web turn has no row to be;
 * the client holds each thread and sends its window back with every question.
 */
export function mentorChatRoutes(app: FastifyInstance, services: WebServices): void {
  app.post("/api/mentor/chat", async (request, reply) => {
    const parsed = chatBody.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: "invalid_question" });
    const { question, history = [] } = parsed.data;
    if (question.length > MENTOR_MAX_INPUT_LENGTH) {
      return reply.status(400).send({ code: "too_long", max: MENTOR_MAX_INPUT_LENGTH });
    }
    // The bot's window: the last MAX_MENTOR_HISTORY stored turns, then the new question.
    const turns: ChatMessage[] = [...history.slice(-MAX_MENTOR_HISTORY), { role: "user", content: question }];
    const answer = await answerMentorTurn(services, request.learner, reply, () => turns);
    if (answer === null) return reply;
    logEvent("mentor.asked", { withCard: false, channel: "web" });
    return { question, answer };
  });
}
