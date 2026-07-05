# Payment Integration — High-Level Architecture Plan

Status: **proposed** · Date: 2026-07-05 · Scope: replace the mock `PaymentPort` behind the paid-tiers feature (Plus/Pro) with real recurring payments.
Companion visualization: `@docs/reports/payments-architecture.html` (published to the admin panel via `pnpm reports:sync-admin` → `/reports/payments-architecture.html`).

## 1. Context

The paid-tiers feature (`feature/plans` branch) already ships the seams a real provider needs:

- `PaymentPort` (`packages/core/src/ports/payment.port.ts`) — `createCheckout` + `verifyRenewal`, currently implemented by `apps/bot/src/payment.ts` (mock, always succeeds).
- `subscriptions` ledger (`packages/adapters/db/src/schema.ts`) — `plan`, `status` (`active|past_due|canceled|expired`), `provider` (default `"mock"`), `externalId`, `currentPeriodEnd`.
- `resolveEntitlements` — single source of truth for access; the app never asks a provider "is this user paid?" at request time.
- Renewal sweep — `processRenewals(now)` driven by the node-cron scheduler tick (`packages/adapters/notifications/src/scheduler.ts`).
- Bot: grammY, **long-polling** (no HTTP surface); admin-api is a Fastify app (candidate webhook ingress).

Gaps: no payments/transactions table, no webhook/update idempotency layer, no price storage, no reconciliation, no admin visibility into subscriptions/payments.

## 2. The governing constraint (decides the provider question)

**Telegram's Bot Developer ToS requires digital goods/services sold inside a bot to be paid exclusively in Telegram Stars.** Third-party providers via BotFather (Telegram Payments 2.0) are physical-goods-only *and* have no recurring support. Linking out from the bot to an external checkout (Stripe/Mollie/…) for a digital service is an explicit ToS violation — enforcement ranges from the bot being hidden on mobile clients to removal from the Bot Platform. ([bot ToS](https://telegram.org/tos/bot-developers), [Stars docs](https://core.telegram.org/bots/payments-stars))

Consequences:

1. **In-bot purchases must be Stars subscriptions.** Non-negotiable for a bot-first product.
2. **Mollie (or any fiat PSP) is only usable for purchases originating outside Telegram** — e.g. a checkout on the landing page that users reach on their own. It is a *second channel*, not an alternative.
3. The architecture must therefore be **provider-agnostic at the core** with per-channel adapters, all feeding the same subscription ledger and entitlements.

## 3. Provider strategy

| | **Telegram Stars** (Phase 1 — mandatory) | **Mollie** (Phase 3 — optional web channel) | Paddle (alternative to Mollie) |
|---|---|---|---|
| Role | Only compliant in-bot channel | EU fiat via landing page | Merchant of Record via landing page |
| Recurring | Native subscriptions, **30-day period only** (`subscription_period=2592000`), ≤10,000 Stars | Mandates (card / SEPA DD / PayPal); charge on our own schedule via Payments API `sequenceType: "recurring"`, or Mollie's Subscriptions engine | Full subscription engine |
| Renewal signal | Push: repeated `successful_payment` updates. **No failed/expired event — expiry is inferred by our cron** | Webhook per generated payment (ID-only, re-fetch to verify) | Signed webhooks |
| Fees/net | Net ≈ **$0.013/Star** via Fragment/TON; 21-day hold; ~30% lost when user bought Stars on iOS/Android | 1.80% + €0.25 (EEA cards), **€0.35 flat SEPA DD**; weekly payout | ~5% + $0.50, but VAT handled for us |
| Tax | Consumer payment handled inside Telegram ecosystem | **We are merchant of record → EU VAT OSS is ours** | Paddle is MoR → no VAT burden |
| Card data | None | Hosted checkout → SAQ-A | Hosted → none |

**Recommendation:** ship Stars first (Phases 0–2). Defer the web-fiat channel; when it becomes relevant, decide Mollie vs Paddle primarily on VAT appetite — Mollie is ~3pp cheaper but leaves quarterly OSS filings to us; if we do choose Mollie, charge on **our own schedule** via mandates + Payments API (reuses our renewal cron and keeps subscription state in our DB) rather than Mollie's Subscriptions engine (which auto-cancels after failed retries and pushes no subscription-canceled webhook).

## 4. Target architecture

```
                 ┌────────────────────────── packages/core ──────────────────────────┐
                 │  Subscription state machine  ·  Entitlements resolver (unchanged) │
                 │  Billing service: grant/extend/expire/cancel/refund (idempotent)  │
                 │  PaymentPort v2 (checkout, cancelAtPeriodEnd, refund)             │
                 └──────────────┬──────────────────────────────┬─────────────────────┘
        implements             │                              │ implements
┌──────────────────────────────┴───────┐      ┌───────────────┴───────────────────────┐
│ Stars adapter (apps/bot)             │      │ Mollie adapter (Phase 3)              │
│ createInvoiceLink · pre_checkout     │      │ hosted checkout · mandates ·          │
│ successful_payment · editUserStar…   │      │ recurring charges · refunds           │
│ refundStarPayment · getStarTransact. │      │ webhook ingress: admin-api Fastify    │
└──────────────────────────────────────┘      └───────────────────────────────────────┘
                 │  both write through the same tables  │
┌────────────────┴──────────────────────────────────────┴───────────────────────────────┐
│ DB: subscriptions (extended) · payments (NEW, unique charge id = idempotency ledger)  │
│     payment_events inbox (NEW, raw event dedup) · plan_prices (NEW, immutable versions)│
└────────────────────────────────────────────────────────────────────────────────────────┘
        ▲                        ▲                          ▲
  renewal/grace sweep      reconciliation job         admin surfaces
  (existing cron, v2)      (getStarTransactions /     (ledger view, refunds,
  + dunning bot DMs        Mollie refetch, drift       manual comp, prices)
                           alerts)
```

### 4.1 Data model changes

- **`payments` (new)** — one row per charge: `id`, `userId`, `subscriptionId`, `provider`, `providerChargeId` (**UNIQUE — the exactly-once anchor**), `amount`, `currency` (`XTR`/`EUR`), `status` (`paid|refunded|failed|charged_back`), `payload`, `periodStart/End`, `createdAt`. Persist `telegram_payment_charge_id` forever (needed for refunds *and* `editUserStarSubscription`).
- **`payment_events` (new, inbox pattern)** — raw provider events keyed by a stable dedup id; processed flag; lets handlers be replay-safe and auditable.
- **`plan_prices` (new)** — immutable versioned price rows (`plan`, `version`, `currency`, `amount`, `activeFrom`); subscription pins its `priceVersion` at purchase → price changes never silently reprice existing subscribers.
- **`subscriptions` (extend)** — add `cancelAtPeriodEnd` boolean, `graceUntil`, `priceVersion`, `anchorAt`; partial unique index `(user_id) WHERE status IN ('active','past_due')` as the last line of defense against duplicate active subs.

### 4.2 Subscription state machine

`active → past_due (grace, access retained) → expired (downgrade to free)`; `cancelAtPeriodEnd` is a **flag on active**, not a state. Legal transitions are enumerated and enforced in `packages/core`; every transition is logged with cause + timestamp. Entitlement expiry (`graceUntil`) is deliberately separate from billing status.

### 4.3 Key flows (Stars)

- **Purchase**: plan picker → `createInvoiceLink` (payload encodes `userId + plan + priceVersion + nonce`) → `pre_checkout_query` handler answers **within 10 s** after validating: payload user == payer, plan exists, no duplicate active sub (Telegram itself allows concurrent duplicates and links are forwardable/re-payable) → `successful_payment` → billing service grants idempotently (insert into `payments` on `providerChargeId` unique; extension = `max(currentPeriodEnd, now) + 30d` in the same transaction).
- **Renewal**: Telegram auto-debits Stars every 30 days → a fresh `successful_payment` (`is_recurring=true`) → same idempotent grant path. No charge initiation on our side.
- **Expiry (inferred)**: no event exists for failed renewal/cancel-by-user. The cron sweep v2: at `currentPeriodEnd` + skew buffer → `past_due` + grace (proposal: 48 h) + bot DM "top up Stars"; at `graceUntil` → `expired`, downgrade, win-back DM. Pre-expiry reminder DM at T-3 days keyed off stored `subscription_expiration_date`.
- **Cancel**: in-bot button → `editUserStarSubscription(is_canceled=true)` → flag `cancelAtPeriodEnd`, access until period end. User-side cancel via Telegram settings produces **no update** — detected only as a missed renewal (same expiry path).
- **Upgrade Plus→Pro**: charge-first — issue Pro invoice; on `successful_payment`, bot-cancel the old Plus sub and credit unused Plus days converted at price ratio onto the Pro period end (Stars has no proration; this is our own day-math). Downgrades: at period end only, no credit math.
- **Refund**: `/paysupport` command (required by Telegram) → admin-approved `refundStarPayment` → atomically mark payment refunded + shorten/revoke entitlement. Treat `CHARGE_ALREADY_REFUNDED` as *possibly-success* (known API bug on recurring charges) and verify via `getStarTransactions`.

### 4.4 Safety nets

- **Reconciliation job (daily)**: page through `getStarTransactions`, diff against `payments`; backfill missing grants, alert on payment-without-entitlement / entitlement-without-payment (both should be zero). This one job catches failures in every other mechanism.
- **Cron dead-man switch**: sweep writes a heartbeat metric; Grafana alerts if the last successful run is stale (a silently dead cron ≡ missed webhooks).
- **Observability**: renewal success rate, grace-recovery rate, drift count, refund/dispute count, `past_due > N days` stuck-state gauge; append-only audit log of every money/entitlement mutation.
- **Clock injection**: billing service takes a `now()` dependency — there are **no test Stars** and renewals can't be compressed, so renewal/grace/expiry paths are verified with simulated time + replayed `successful_payment` fixtures (duplicated and out of order, per spec-first testing).

## 5. Pitfalls register (researched) and our answers

Telegram-specific:

1. **No failed-renewal/expiry event, no subscription-list API** → own cron infers expiry from stored `subscription_expiration_date`; reconciliation via `getStarTransactions`. (core.telegram.org/api/subscriptions)
2. **Invoice links stay valid, are forwardable, payable by anyone, multiple times** → payload carries intended `userId` + nonce; `pre_checkout_query` rejects mismatched payer or duplicate active sub.
3. **Telegram permits concurrent duplicate subscriptions per user** → reject at pre-checkout + DB partial unique index; if one slips through (paid before we could reject): auto-refund flow.
4. **10-second `pre_checkout_query` deadline** → handler does index-backed reads only; no AI/network calls; monitored latency.
5. **User cancels via Telegram UI silently** → no special handling needed by design: expiry path covers it; "My subscriptions" client UI lag (tdesktop#28657) documented for support.
6. **`refundStarPayment` false `CHARGE_ALREADY_REFUNDED` on recurring charges** (tdlib/telegram-bot-api#690) → treat as possibly-success, verify via transactions, never double-refund.
7. **No test Stars; renewals can't be time-compressed** → clock-injected core + replayed update fixtures; one real-money smoke test with self-refund.
8. **Stars economics** — ~$0.013/Star net, 21-day hold, ~30% mobile top-up leakage → price plans off the withdrawal rate, not the user's purchase price; cash-flow lag documented.
9. **`successful_payment` carries no invoice details** → everything needed for the grant lives in `invoice_payload`.

General recurring-billing (apply to Stars now, Mollie later):

10. **Duplicate event delivery / double grant** → `payments.providerChargeId UNIQUE` + grant in same DB transaction (inbox pattern); extension formula `max(currentPeriodEnd, now)+period` is naturally replay-safe.
11. **Out-of-order events** → handlers converge to the same state regardless of arrival order; on webhook (Mollie) always re-fetch current object state, never trust the notification.
12. **Provider↔DB status drift** → local DB is the entitlement source of truth; webhooks/updates keep it fresh; daily reconciliation repairs drift.
13. **Race: two concurrent purchases** → row-lock per user in the billing service + the partial unique index as backstop.
14. **Calendar math** (Jan 31 + 1 month, DST, epoch drift) → Stars fixes the period at 30 days (Telegram computes it); our own math only does `max()+30d` and day-credits; any future fiat cycle uses calendar-aware arithmetic with an explicit anchor, end-of-month clamping, UTC storage.
15. **Cron double-fire / not firing** → sweep is query-driven (`currentPeriodEnd <= now`), idempotent, row-locked per subscription; heartbeat-alerted.
16. **Dunning / involuntary churn** → bot DMs are the dunning channel (T-3 reminder, past_due notice with top-up deep link, win-back after expiry); Telegram nags on low Star balance on its own.
17. **Refund/chargeback without entitlement revocation** → refund handler atomically flips payment status *and* entitlement; (Mollie/SEPA: 8-week no-questions chargeback — treat any SEPA revenue as provisional for 8 weeks, revoke on `charged_back`).
18. **Price changes repricing existing subscribers** → immutable `plan_prices` versions pinned per subscription; new version affects new purchases only.
19. **Upgrade paid but plan flip failed / plan flipped but charge failed** → charge-first ordering; entitlement changes only inside the payment-success transaction.
20. **Cancellation semantics confusion** → default `cancelAtPeriodEnd`; immediate revocation reserved for refunds/fraud; reactivation after expiry = new subscription row, never resurrection.
21. **Trial abuse** (if trials are added) → one trial per Telegram `user_id`, recorded forever.
22. **Webhook ingress hardening (Mollie phase)** → verify-by-refetch (Mollie classic webhooks are ID-only, unsigned), unguessable URL, persist→enqueue→200 fast, retries are idempotent; endpoint on admin-api Fastify since the bot is long-polling.
23. **Card mandate fragility (Mollie)** → mandates die on 1 chargeback / card expiry with no account-updater; monitor mandate status, prompt re-checkout; SEPA DD preferred for EU (€0.35 flat, mandates don't expire).
24. **VAT on digital services (fiat channel only)** → decision gate before Phase 3: Mollie + OSS self-filing vs Paddle MoR. Stars phase has no such burden.

## 6. Phased roadmap

- **Phase 0 — Billing core hardening** (provider-agnostic, mock still wired): new tables + migrations, state machine + idempotent billing service in `packages/core`, clock injection, `PaymentPort` v2, spec-first tests incl. replay/out-of-order fixtures.
- **Phase 1 — Stars go-live**: Stars adapter, invoice + pre-checkout + successful-payment handlers, renewal sweep v2 (grace, inferred expiry), cancel/upgrade flows, `/paysupport` + refund path, real-money smoke test.
- **Phase 2 — Resilience & ops**: reconciliation job + drift alerts, dunning/reminder DMs, Grafana dashboard (renewal rate, drift, heartbeat), admin surfaces (subscription/payment ledger, refund button, manual comp, price versions).
- **Phase 3 (optional, deferred) — Web fiat channel**: Mollie-vs-Paddle decision (VAT), landing-page checkout, webhook ingress on admin-api, mandate lifecycle + SEPA dunning. Must not be reachable from inside the bot.

Open decisions: Stars price points per plan (drive from $0.013/Star net), grace length (proposal 48 h), upgrade credit formula, Phase 3 provider.

## 7. Non-goals

Yearly plans in Stars (unsupported), multi-currency in-bot, storing card data (never — hosted checkout only), Mollie's Subscriptions engine (we keep the billing schedule), building tax logic before Phase 3.

## 8. Key sources

Telegram: [Stars payments](https://core.telegram.org/bots/payments-stars) · [subscriptions](https://core.telegram.org/api/subscriptions) · [Bot ToS](https://telegram.org/tos/bot-developers) · [refund bug #690](https://github.com/tdlib/telegram-bot-api/issues/690).
Mollie: [recurring](https://docs.mollie.com/payments/recurring) · [webhooks](https://docs.mollie.com/reference/webhooks) · [pricing](https://www.mollie.com/pricing) · [testing](https://docs.mollie.com/reference/testing).
Patterns: [Airbnb — avoiding double payments](https://medium.com/airbnb-engineering/avoiding-double-payments-in-a-distributed-payments-system-2981f6b070bb) · [webhook idempotency](https://hookdeck.com/webhooks/guides/implement-webhook-idempotency) · [Stripe billing cycle & smart retries](https://docs.stripe.com/billing) · [dunning](https://baremetrics.com/blog/dunning-management) · [grandfathering](https://www.paddle.com/blog/legacy-pricing) · [SEPA chargebacks](https://gocardless.com/guides/sepa/protection/) · [MoR/VAT](https://www.paddle.com/blog/what-is-merchant-of-record).
