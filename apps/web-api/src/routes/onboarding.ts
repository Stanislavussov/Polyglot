import {
  errorFields,
  getHookWords,
  grantOnboardingTrial,
  isTrial,
  isUnlimitedRole,
  logEvent,
  TRIAL_DAYS,
  TRIAL_EXTENSION_DAYS,
  TRIAL_EXTENSION_WORDS,
  type User,
} from "@polyglot/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { WebServices } from "../services.js";

// The bot's onboarding (apps/bot/src/onboarding): native language, learning languages,
// a demo card from a curated hook word, then done. Step numbers are the bot's
// `users.onboarding_step` storage contract (ONBOARDING_STEPS), never renumbered.
const STEPS = { native: 1, languages: 2, demo: 3 } as const;
// The first three hook words per language are the bot's demo picks.
const HOOK_PICKS = 3;

const stepSchema = z.object({ step: z.enum(["native", "languages", "demo"]) });

// A gift, not a step: a failure leaves the learner on free and onboarding goes on, as in the bot.
async function grantTrialQuietly(services: WebServices, user: User): Promise<void> {
  const subscriptions = services.subscriptionRepository;
  if (!subscriptions || isUnlimitedRole(user.audienceGroup)) return;
  try {
    const grant = await grantOnboardingTrial({ subscriptions, users: services.userRepository }, user.id);
    if (grant.granted) logEvent("onboarding.trial_granted", { plan: grant.plan, days: grant.days, surface: "web" });
    else logEvent("onboarding.trial_not_granted", { reason: grant.reason, surface: "web" });
  } catch (err) {
    logEvent("onboarding.trial_grant_failed", { ...errorFields(err), surface: "web" }, "error");
  }
}

export function onboardingRoutes(app: FastifyInstance, services: WebServices): void {
  app.get("/api/onboarding", async (request) => {
    const user = request.learner;
    const settings = await services.userRepository.getSettings(user.id);
    const learningLangs = settings?.learningLangs ?? [];
    return {
      onboarded: user.onboarded,
      step: user.onboardingStep,
      hookWords: Object.fromEntries(
        learningLangs.map((lang) => [
          lang,
          getHookWords(lang)
            .slice(0, HOOK_PICKS)
            .map((w) => w.headword),
        ]),
      ),
    };
  });

  app.post("/api/onboarding/step", async (request, reply) => {
    const parsed = stepSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: "invalid_step" });
    const user = request.learner;
    if (user.onboarded) return reply.status(204).send();
    await services.userRepository.updateOnboardingStep(user.id, STEPS[parsed.data.step]);
    // The bot grants the trial as the demo screen opens, so the demo card already shows Pro.
    if (parsed.data.step === "demo") await grantTrialQuietly(services, user);
    logEvent("onboarding.screen_rendered", { step: STEPS[parsed.data.step], surface: "web" });
    return reply.status(204).send();
  });

  app.post("/api/onboarding/complete", async (request) => {
    const user = request.learner;
    const settings = await services.userRepository.getSettings(user.id);
    if (!user.onboarded) {
      await services.userRepository.markOnboarded(user.id);
      logEvent("onboarding.completed", {
        nativeLang: settings?.nativeLang,
        learningLangs: settings?.learningLangs,
        surface: "web",
      });
    }
    const active = await services.subscriptionRepository?.findActiveByUser(user.id).catch(() => null);
    return {
      trial:
        active && isTrial(active)
          ? { days: TRIAL_DAYS, words: TRIAL_EXTENSION_WORDS, extraDays: TRIAL_EXTENSION_DAYS }
          : null,
    };
  });
}
