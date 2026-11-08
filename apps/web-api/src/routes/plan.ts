import { ALL_FEATURES, defaultFeatureAccess, isTrial } from "@polyglot/core";
import type { FastifyInstance } from "fastify";
import type { WebServices } from "../services.js";

/**
 * The plan screen: the learner's plan and the admin-owned catalog. Buying stays
 * in Telegram (payments are Telegram-bound), so the page links to the bot's own
 * plan comparison through a `/start plan` deep link instead of selling here.
 */
export function planRoutes(app: FastifyInstance, services: WebServices, botUsername: string): void {
  app.get("/api/plan", async (request) => {
    const user = request.learner;
    const access = services.featureAccess ?? defaultFeatureAccess;
    const [catalog, active, granted] = await Promise.all([
      services.settings.getPlanLimits(),
      services.subscriptionRepository?.findActiveByUser(user.id) ?? null,
      access.listFeatures(user),
    ]);
    const current = catalog.find((plan) => plan.name === user.subscriptionPlan);

    // Same ladder as the bot's upgrade screen: active, priced, cheapest first.
    const forSale = catalog
      .filter((plan) => plan.isActive && plan.priceUsdCents !== null)
      .sort((a, b) => (a.priceUsdCents ?? 0) - (b.priceUsdCents ?? 0));
    const plans = await Promise.all(
      forSale.map(async (plan) => {
        const features = await access.listPlanFeatures(plan.name);
        return {
          name: plan.name,
          label: plan.label,
          priceUsdCents: plan.priceUsdCents,
          translationLimit: plan.translationLimit,
          video: plan.videoWindow !== "none" && plan.videoLimit !== 0,
          features: ALL_FEATURES.filter((key) => features.has(key)),
        };
      }),
    );

    return {
      current: {
        name: user.subscriptionPlan,
        label: current?.label ?? user.subscriptionPlan,
        translationLimit: current?.translationLimit ?? null,
        features: ALL_FEATURES.filter((key) => granted.has(key)),
        periodEnd: active?.currentPeriodEnd.toISOString() ?? null,
        trial: active ? isTrial(active) : false,
      },
      plans,
      upgradeUrl: `https://t.me/${botUsername}?start=plan`,
    };
  });
}
