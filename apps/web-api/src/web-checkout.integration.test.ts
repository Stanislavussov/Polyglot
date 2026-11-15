/**
 * @business Buying a plan on the web, onto the ledger the bot reads (real Postgres).
 *
 * Spec:
 * - With a card provider configured, the plan page offers checkout; buying a plan
 *   opens the provider's page and records a pending payment.
 * - The provider's notification (no cookie, no Origin) grants the plan once the
 *   re-fetched charge is PAID; a repeated notification grants nothing more.
 * - The same user then holds the plan everywhere: the plan pointer the bot reads,
 *   and the web plan page, which no longer sells the plan they have.
 * - The bot-side renewal sweep charges the saved card at the price paid and
 *   extends the same subscription row.
 *
 * Comgate's HTTP is faked at fetch, the real adapter and repositories run.
 */
import { paymentRepository, settingsAdapter, subscriptionRepository, userRepository } from "@polyglot/adapter-db";
import { createComgateProvider } from "@polyglot/adapter-payments";
import {
  createHostedCheckoutService,
  createSubscriptionService,
  type PlanLimitConfig,
  routeRenewalsByProvider,
  SettingsService,
  type SubscriptionRepository,
} from "@polyglot/core";
import { describe, expect, it, vi } from "vitest";
import { arrangeOnboardedTranslator } from "../../bot/src/test-helpers/integration/arrange.js";
import { uniqueTelegramId } from "../../bot/src/test-helpers/integration/id-factory.js";
import { createWebHarness } from "./test-helpers/web-harness.js";

const PRICES: Record<string, number> = { plus: 500, pro: 1000 };

async function pricedCatalog(): Promise<PlanLimitConfig[]> {
  const real = await new SettingsService(settingsAdapter).getPlanLimits();
  return real.map((plan) =>
    PRICES[plan.name] ? { ...plan, isActive: true, priceUsdCents: PRICES[plan.name] ?? null } : plan,
  );
}

/** Comgate at the HTTP boundary: every created charge is PAID when asked. */
function fakeComgate() {
  let next = 0;
  const paid = new Set<string>();
  const http = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).replace("https://payments.comgate.cz/v2.0", "");
    const body = init?.body ? (JSON.parse(String(init.body)) as { price: number; curr: string }) : null;
    const reply = (() => {
      if (path === "/payment.json" || path === "/recurring.json") {
        next += 1;
        const transId = `T${Date.now()}-${next}`;
        paid.add(transId);
        return { code: 0, transId, redirect: `https://pay.test/${transId}`, price: body?.price, curr: body?.curr };
      }
      const status = path.match(/^\/payment\/transId\/(.+)\.json$/);
      if (status?.[1] && paid.has(status[1])) return { code: 0, status: "PAID", price: "500", curr: "USD" };
      return { code: 1400, message: "unknown" };
    })();
    return new Response(JSON.stringify(reply), { status: 200 });
  });
  return createComgateProvider({ merchant: "m", secret: "s", test: true, recurring: true, fetch: http });
}

describe("web checkout (integration)", () => {
  it("sells a plan by card and the bot's ledger sees it", async () => {
    // Arrange
    const catalog = await pricedCatalog();
    const web = await createWebHarness({ settings: { getPlanLimits: async () => catalog } });
    const provider = fakeComgate();
    const hostedCheckout = createHostedCheckoutService({
      provider,
      payments: paymentRepository,
      subscriptions: subscriptionRepository,
      users: userRepository,
      priceOf: async (plan) => (PRICES[plan] ? { amountMinor: PRICES[plan] ?? 0, currency: "USD" } : null),
    });
    Object.assign(web.bot.services, { hostedCheckout });
    const telegramId = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(telegramId);
    const { cookie } = await web.login(telegramId);

    // Act — open the checkout
    const page = await web.call(cookie, "GET", "/api/plan");
    const started = await web.call(cookie, "POST", "/api/plan/checkout", { plan: "plus" });

    // Assert — the page sells by card; a pending payment pins the price
    expect(page.body).toMatchObject({
      checkout: true,
      plans: expect.arrayContaining([expect.objectContaining({ name: "plus", buyable: true })]),
    });
    expect(started.status).toBe(200);
    const url = (started.body as { url: string }).url;
    const chargeId = url.replace("https://pay.test/", "");
    expect(await paymentRepository.findByCharge("comgate", chargeId)).toMatchObject({
      userId,
      plan: "plus",
      amountMinor: 500,
      currency: "USD",
      status: "pending",
    });

    // Act — Comgate's notification, twice, server to server
    const notify = () =>
      web.app.inject({
        method: "POST",
        url: "/api/payments/comgate/notify",
        payload: { transId: chargeId, secret: "x" },
      });
    const first = await notify();
    const repeat = await notify();

    // Assert — granted once, on the shared ledger and the bot's plan pointer
    expect([first.statusCode, repeat.statusCode]).toEqual([200, 200]);
    const active = await subscriptionRepository.findActiveByUser(userId);
    expect(active).toMatchObject({ plan: "plus", provider: "comgate", externalId: chargeId, status: "active" });
    expect((await userRepository.findById(userId))?.subscriptionPlan).toBe("plus");
    expect(await paymentRepository.findByCharge("comgate", chargeId)).toMatchObject({
      status: "paid",
      subscriptionId: active?.id,
    });
    const after = await web.call(cookie, "GET", "/api/plan");
    expect(after.body).toMatchObject({
      current: { name: "plus" },
      plans: expect.arrayContaining([expect.objectContaining({ name: "plus", buyable: false })]),
    });
    expect((await web.call(cookie, "POST", "/api/plan/checkout", { plan: "plus" })).status).toBe(409);

    // Act — the renewal sweep, as the bot runs it, once the month is over
    if (!active) throw new Error("no active subscription");
    await subscriptionRepository.extend(active.id, new Date(Date.now() - 60_000));
    const onlyThisUser: SubscriptionRepository = Object.assign(
      Object.create(subscriptionRepository) as SubscriptionRepository,
      {
        findExpired: async (now: Date) =>
          (await subscriptionRepository.findExpired(now)).filter((sub) => sub.userId === userId),
      },
    );
    const closed = { createCheckout: async () => ({ ok: false }), verifyRenewal: async () => ({ paid: false }) };
    const sweep = await createSubscriptionService({
      payment: routeRenewalsByProvider({ comgate: hostedCheckout }, closed),
      subscriptions: onlyThisUser,
      users: userRepository,
    }).processRenewals();

    // Assert — the same row runs on, paid by the saved card
    expect(sweep).toEqual({ renewed: 1, expired: 0 });
    const renewed = await subscriptionRepository.findActiveByUser(userId);
    expect(renewed?.id).toBe(active.id);
    expect(renewed!.currentPeriodEnd.getTime()).toBeGreaterThan(Date.now());
    expect(await paymentRepository.findLastPaidForSubscription(active.id)).toMatchObject({
      amountMinor: 500,
      status: "paid",
    });
  });
});
