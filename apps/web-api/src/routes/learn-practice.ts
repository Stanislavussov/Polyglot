import {
  AITimeoutError,
  buildAiFailover,
  buildQuotaPorts,
  checkGrammar,
  checkGrammarCheckDailyQuota,
  errorFields,
  GRAMMAR_CATEGORY_KEYS,
  GRAMMAR_CHECK_MAX_TOKENS,
  GRAMMAR_MAX_INPUT_LENGTH,
  generateExpression,
  logEvent,
  recordAiUsage,
  resolveDefaultAIModel,
  resolveMentorModels,
  TRANSLATION_HARD_TIMEOUT_MS,
  t,
} from "@polyglot/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { WebServices } from "../services.js";
import { learnerSettings, meterCredits } from "./learn-shared.js";

const grammarBody = z.object({ text: z.string().trim().min(1) });
const expressionBody = z.object({ avoid: z.array(z.string().max(300)).max(10).optional() });

/** The bot's two text practices on the web: grammar check and the expressions feed. */
export function learnPracticeRoutes(app: FastifyInstance, services: WebServices): void {
  app.post("/api/grammar-check", async (request, reply) => {
    const parsed = grammarBody.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: "invalid_text" });
    const { text } = parsed.data;
    if (text.length > GRAMMAR_MAX_INPUT_LENGTH) {
      return reply.status(400).send({ code: "too_long", max: GRAMMAR_MAX_INPUT_LENGTH });
    }
    const user = request.learner;

    // The daily cap is the check's only gate (every tier includes it), then the credit meter.
    const daily = await checkGrammarCheckDailyQuota(buildQuotaPorts(services), user);
    if (!daily.ok) {
      logEvent("limit.reached", { userId: user.id, reason: "grammar_check", channel: "web" });
      return reply.status(429).send({ code: "grammar_limit", limit: daily.limit });
    }
    const creditCost = await meterCredits(services, user, reply, "grammarCheck");
    if (creditCost === null) return reply;

    const { settings, lang } = await learnerSettings(services, user);
    const nativeLang = settings?.nativeLang ?? "en";
    const learningLangs = settings?.learningLangs ?? [];
    const { model, fallbackModel, levels } = await resolveMentorModels(services, user.id, user.subscriptionPlan);

    try {
      const outcome = await checkGrammar(
        { text, nativeLang, learningLangs, levels, interfaceLang: lang },
        services.ai.generateObject,
        model,
        {
          userId: user.id,
          maxTokens: GRAMMAR_CHECK_MAX_TOKENS,
          budgetMs: TRANSLATION_HARD_TIMEOUT_MS,
          failover: buildAiFailover(TRANSLATION_HARD_TIMEOUT_MS, fallbackModel),
        },
      );
      // Billed on any answer the model produced — a free refusal would be an unmetered
      // AI call — but an out-of-set text is billed under a tag the daily count skips.
      const ports = buildQuotaPorts(services);
      if (outcome.status === "unsupported_language") {
        await recordAiUsage(ports, user.id, "grammarCheckOutOfSet", creditCost);
        logEvent("grammar_check.unsupported_language", { detectedLanguage: outcome.detectedLanguage, channel: "web" });
        const languages = [nativeLang, ...learningLangs.filter((code) => code !== nativeLang)].map((code) =>
          services.languageCache.getLangDisplay(code),
        );
        return { status: "unsupported_language", languages };
      }
      await recordAiUsage(ports, user.id, "grammarCheck", creditCost, outcome.language);
      logEvent("grammar_check.completed", {
        language: outcome.language,
        issues: outcome.errors.length,
        channel: "web",
      });
      return {
        status: "checked",
        language: outcome.language,
        correctedText: outcome.correctedText,
        naturalAlternative: outcome.naturalAlternative ?? null,
        errors: outcome.errors.map((issue) => ({
          ...issue,
          categoryLabel: t(GRAMMAR_CATEGORY_KEYS[issue.category], lang),
        })),
      };
    } catch (err) {
      logEvent("grammar_check.failed", { textLength: text.length, channel: "web", ...errorFields(err) }, "error");
      return reply.status(err instanceof AITimeoutError ? 504 : 502).send({ code: "grammar_failed" });
    }
  });

  app.post("/api/expressions", async (request, reply) => {
    const parsed = expressionBody.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ code: "invalid_request" });
    const user = request.learner;
    const creditCost = await meterCredits(services, user, reply, "expression");
    if (creditCost === null) return reply;

    const { settings } = await learnerSettings(services, user);
    const nativeLang = settings?.nativeLang ?? "en";
    try {
      const model = await resolveDefaultAIModel(services.settings, user.subscriptionPlan);
      const expression = await generateExpression(
        {
          userId: user.id,
          nativeLang,
          learningLangs: settings?.learningLangs ?? [],
          // On demand there is no slot to stay stable for, so every request rolls a new angle.
          seed: Math.floor(Math.random() * 2 ** 31),
          avoid: parsed.data.avoid ?? [],
        },
        { generateObjectFn: services.ai.generateObject, modelId: model },
      );
      await recordAiUsage(buildQuotaPorts(services), user.id, "expression", creditCost, expression.lang, [nativeLang]);
      return { expression };
    } catch (err) {
      logEvent("expression.failed", { channel: "web", ...errorFields(err) }, "error");
      return reply.status(502).send({ code: "expression_failed" });
    }
  });
}
