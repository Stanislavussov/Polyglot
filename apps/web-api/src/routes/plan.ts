import {
  ALL_FEATURES,
  decidePurchase,
  defaultFeatureAccess,
  isTrial,
  logEvent,
  purchasableLadder,
} from "@polyglot/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { WebApiConfig } from "../config.js";
import type { WebServices } from "../services.js";

const FREE_PLAN = "free";

const checkoutBody = z.object({ plan: z.string().min(1).max(50) });
const settleBody = z.object({ chargeId: z.string().min(1).max(100) });
const notifyBody = z.object({ transId: z.string().min(1).max(100) });

/**
 * The plan screen: the learner's plan, the admin-owned catalog, and — when the
 * shop has a card provider — a web checkout onto the same ledger the bot sells
 * on. Without one, the page links to the bot's plan screen instead.
 */
export function planRoutes(
  app: FastifyInstance,
  services: WebServices,
  config: Pick<WebApiConfig, "botUsername" | "appOrigin">,
): void {
  app.get("/api/plan", async (request) => {
    const user = request.learner;
    const access = services.featureAccess ?? defaultFeatureAccess;
    const [catalog, active, granted] = await Promise.all([
      services.settings.getPlanLimits(),
      services.subscriptionRepository?.findActiveByUser(user.id) ?? null,
      access.listFeatures(user),
    ]);
    const current = catalog.find((plan) => plan.name === user.subscriptionPlan);

    // Every tier side by side, as a price page reads: Free, then the ladder on sale,
    // then the learner's own plan when it is none of those (an internal plan).
    const free = catalog.find((plan) => plan.name === FREE_PLAN && plan.isActive);
    const tiers = [...(free ? [free] : []), ...purchasableLadder(catalog)];
    if (current && !tiers.some((plan) => plan.name === current.name)) tiers.push(current);

    const plans = await Promise.all(
      tiers.map(async (plan) => {
        const features = await access.listPlanFeatures(plan.name);
        return {
          name: plan.name,
          label: plan.label,
          priceUsdCents: plan.name === FREE_PLAN ? 0 : plan.priceUsdCents,
          translationLimit: plan.translationLimit,
          video: plan.videoWindow !== "none" && plan.videoLimit !== 0,
          features: ALL_FEATURES.filter((key) => features.has(key)),
          current: plan.name === user.subscriptionPlan,
          buyable: decidePurchase(catalog, user.subscriptionPlan, active, plan.name).ok,
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
      checkout: Boolean(services.hostedCheckout),
      upgradeUrl: `https://t.me/${config.botUsername}?start=plan`,
    };
  });

  app.post("/api/plan/checkout", async (request, reply) => {
    const checkout = services.hostedCheckout;
    if (!checkout) return reply.status(503).send({ code: "checkout_closed" });
    const parsed = checkoutBody.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: "bad_request" });
    const user = request.learner;
    const [catalog, active] = await Promise.all([
      services.settings.getPlanLimits(),
      services.subscriptionRepository?.findActiveByUser(user.id) ?? null,
    ]);
    const decision = decidePurchase(catalog, user.subscriptionPlan, active, parsed.data.plan);
    if (!decision.ok) {
      return reply.status(409).send({ code: decision.reason });
    }
    const started = await checkout.start({
      userId: user.id,
      plan: decision.plan.name,
      label: `Polyglot ${decision.plan.label}`,
      // Comgate substitutes ${id} with its transaction id on the way back.
      returnUrl: `${config.appOrigin}/plan?charge=\${id}`,
    });
    if (!started.ok) return reply.status(409).send({ code: "not_for_sale" });
    logEvent("payment.checkout_started", { userId: user.id, plan: decision.plan.name, provider: checkout.provider });
    return { url: started.url };
  });

  // The return from the checkout page. The notification usually arrives first;
  // settling here too means the page shows the new plan even when it is late.
  app.post("/api/plan/settle", async (request, reply) => {
    const checkout = services.hostedCheckout;
    if (!checkout) return reply.status(503).send({ code: "checkout_closed" });
    const parsed = settleBody.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: "bad_request" });
    return { outcome: await checkout.settle(parsed.data.chargeId) };
  });

  app.post("/api/payments/comgate/notify", async (request, reply) => {
    const checkout = services.hostedCheckout;
    if (!checkout) return reply.status(503).send({ code: "checkout_closed" });
    const parsed = notifyBody.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: "bad_request" });
    // A thrown settle answers 500, so Comgate resends; any answered outcome is final for this notice.
    const outcome = await checkout.settle(parsed.data.transId);
    logEvent("payment.notified", { provider: checkout.provider, outcome });
    return reply.status(200).send({ ok: true });
  });
}
