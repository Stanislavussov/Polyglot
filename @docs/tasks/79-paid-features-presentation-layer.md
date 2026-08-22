# Task 79 — Paid-Features Presentation Layer (mock payments, real gating)

Status: **implemented** (2026-08-22, branch `worktree/calm-valley-08f9`) · Date: 2026-08-22
Depends on: paid-tiers foundation (merged 2026-07-05, migration 0045) · Roadmap for real money: `@docs/tech-reqs/16-payments-architecture.md`

## 1. Context and assessment

The Telegram Stars payment architecture (`@docs/tech-reqs/16-payments-architecture.md`) was reviewed and is **valid**: Stars-first is mandated by Telegram's Bot ToS for in-bot digital goods, the idempotency/reconciliation design is sound, and the pitfalls register is well-researched. It remains the roadmap for real payments (its Phases 0–2). **Nothing in this task touches that plan.**

This task builds the layer *in front of* it: users start seeing which features are paid, can press a locked button, walk through a **fake checkout** (mock `PaymentPort`, always succeeds), and land in a real premium state persisted in the existing `subscriptions` table. When Stars arrive, only the adapter behind `PaymentPort` changes — every screen, button, and DB row built here survives as-is.

Already in place (do not rebuild): `PaymentPort` + `mockPaymentAdapter` (`apps/bot/src/payment.ts`), `subscriptions` ledger, `rate_limit_plans` (admin-editable limits), `plan_feature_access` junction, `resolveEntitlements` (`packages/core/src/modules/entitlements`), `createFeatureAccess` (`apps/bot/src/feature-access.ts`), `createSubscriptionService` (activate + renewal sweep on cron), upgrade CTA + plan picker + mock buy (`subscription.helper.ts`), and click-time gates for grammar/etymology/grammarDetail in `card-actions.ts`.

## 2. Product spec

### 2.1 Tiers (3 plans user-facing; `unlimited` stays internal)

| | **Free** | **Plus — $5/mo** | **Pro — $10/mo** |
|---|---|---|---|
| Translations | **10 / month** | 200 / month | unlimited |
| Save word | ✅ | ✅ | ✅ |
| Clarify translation / other meaning | 🔒 | ✅ | ✅ |
| YouTube video vocabulary | 🔒 (0) | ✅ 10 / month | ✅ unlimited |
| Word pronunciation (TTS audio) | 🔒 | 🔒 | ✅ |
| Grammar breakdown / etymology / grammar detail | 🔒 | ✅ | ✅ (unchanged from current seed) |

Numeric limits are data (`rate_limit_plans`), not code — defaults above are proposals, adjustable in the admin panel. Admin/tester audience groups keep their unconditional bypass in `resolveEntitlements`.

### 2.2 Lock UX concept

- **Paid buttons stay visible and clickable**, marked with a trailing **⭐** badge (e.g. `🔊 Произношение ⭐`) — a call-to-action, not a "🔒 available in Premium" label. No wording on the card explains the tier; the badge invites the tap and the screen behind it does the explaining. The same badge covers grammar / etymology / grammar detail, replacing their old `grammarLocked` / `etymologyLocked` alerts.
- Pressing a badged button → silent callback answer (no toast) + an **upsell screen**: plan comparison with prices ($5 / $10), per-plan feature list, one buy button per plan.
- `plan:buy:<plan>` → **fake payment confirmation screen**: "Тестовая оплата — активировать Plus за $5/мес?" with [Активировать] / [Отмена]. Confirming runs the existing mock `subscriptionService.activate()`, which writes the `subscriptions` row and flips `users.subscriptionPlan` — the user is now genuinely premium in the DB.
- Success message shows the plan and period end. The card the user came from re-renders with unlocked buttons where feasible (fallback: the next card is unlocked).
- Server-side gate is authoritative: every gated handler re-checks `checkFeatureAccess` on click (old messages keep stale keyboards; 48h edit limit means re-render may fail — the gate must never rely on the keyboard state).

## 3. Layer boundary (the point of this task)

```
presentation layer (this task)            payment layer (untouched, later = Stars)
──────────────────────────────            ────────────────────────────────────────
lock rendering, upsell screen,      →     PaymentPort.createCheckout / verifyRenewal
fake-confirm dialog, i18n copy,           (mockPaymentAdapter today, Stars adapter
feature keys, plan prices display         per tech-req 16 Phases 0–2 tomorrow)
        │
        └── entitlements resolver + subscriptions ledger (shared, already built)
```

Rules: no handler ever asks "did the user pay?" — only `checkFeatureAccess(subject, featureKey)` / `resolveEntitlements`. No provider concepts (invoices, charges) leak into renderers. The fake-confirm screen is the *placeholder for* the future Stars invoice step — same callback shape, so swapping in `createInvoiceLink` later replaces one helper, not the flow.

## 4. Work breakdown

### Stage A — Core entitlements extension (`packages/core`)

1. Add feature keys to `FEATURE_KEYS`: `clarification` (covers both `tr:clarifypost` and `tr:altmeaning`) and `pronunciation` (covers `tr:say:*`). Video stays limit-gated (`videoLimit`/`videoWindow`), not a feature key.
2. Tighten `FREE_FALLBACK`: `translationLimit: 10`, `videoLimit: 0`, `videoWindow: "none"` (fail-closed fallback must match the new free plan).
3. `Entitlements` unchanged structurally; spec-first unit tests for the new keys and fallback.

### Stage B — Data: plans, prices, seed

1. Schema: add `priceUsdCents: integer` (nullable; null = free/not for sale) to `rate_limit_plans`. **Display-only** — real billing will use immutable `plan_prices` per tech-req 16 §4.1; this column feeds the upsell screen until then. `pnpm db:generate` → review → `pnpm db:push` (dev), migration applied by CI on master.
4. Update `apps/admin-api/src/seed.ts` (idempotent upsert):
   - `free`: translationLimit 10, videoLimit 0, videoWindow `none`, price null, features `[]`
   - `plus`: translationLimit 200, videoLimit 10, videoWindow `monthly`, price 500, features = existing PREMIUM + `clarification`
   - `pro`: translationLimit null, videoLimit null, price 1000, features = plus + `pronunciation`
   - `unlimited`: unchanged + both new keys.
3. Note: `db:push` syncs schema only; the seed must be run against dev, and prod picks it up via the deploy path already used for plan seeds.

### Stage C — Bot presentation (`apps/bot`)

1. **Renderer**: `buildTranslationKeyboard` (`translation.renderer.ts`) takes an options object including `locked: ReadonlySet<featureKey>` and appends the ⭐ badge to locked buttons. Callback data stays identical — the badge is cosmetic; the server gate decides.
2. **Click gates**: `ensurePaidFeature` (`paid-feature.helper.ts`) at the top of the clarify (`clarification.ts`), other-meaning (`card-actions.ts`), pronounce (`pronunciation.ts`), grammar, etymology and grammar-detail handlers — a denied tap answers the callback silently and sends the upsell screen.
3. **Upsell screen v2** (`subscription.helper.ts`): extend `upgradePrompt` into a priced comparison (reads `rate_limit_plans` incl. `priceUsdCents` + `plan_feature_access`); keep `plan:upgrade` entry point so existing limit gates (translate quota, video quota) get the new screen for free.
4. **Fake checkout confirm**: new callbacks `plan:confirm:<plan>` / `plan:cancel`. `plan:buy:<plan>` now shows the confirmation; `plan:confirm` runs `service.activate()` and reports success. Clearly labeled as test payment in copy.
5. **Video for free users**: with `videoWindow: "none"` the existing video quota path already blocks; verify the message it sends uses the upsell screen (it already attaches `buildUpgradeKeyboard`).
6. **i18n**: new keys (locked-button hint, upsell copy with prices, confirm/cancel, success) across supported interface locales.

### Stage D — Admin visibility (small)

- `rate-limits.astro`: show/edit `priceUsdCents` alongside limits; render each plan's feature keys (read-only list is enough for now — `plan_feature_access` editing UI is a stretch goal, seed remains the source).

### Stage E — Tests (per `bot-testing` skill, mandatory E2E lane)

Integration tests in `apps/bot/src/__tests__/integration/` through the real dispatcher + Postgres:

Shipped as `paid-features-gating.integration.test.ts`:

1. Free user presses the ⭐ Pronounce button → no TTS call, upsell screen with both plans and prices; badges sit on the paid buttons only, never on Save.
2. Free user: buy Plus → confirm → `subscriptions` row active, `users.subscriptionPlan = "plus"`; Clarify now works; Pronounce still gated (Pro-only); a freshly rendered card drops the badge it no longer needs.
3. Upgrade Plus → Pro via the same flow → Pronounce works; old plus subscription superseded (existing `activate` cancel-then-create logic).
4. Cancel on the confirm screen → no subscription row created, user still on `free`.
5. Hand-crafted `plan:confirm:unlimited` (a plan with no price) → refused, nothing granted.

Not covered in the integration lane, deliberately: the translation-quota and video gates. Neither changed in this task — only their seeded numbers did — and both already route through `buildUpgradeKeyboard`; driving 11 real translations through the pipeline would buy nothing the entitlements unit tests do not already pin down.

Unit lane: entitlements resolver keys/fallback, one-lookup `listFeatures`, renderer badge logic (identical callback data, badge in both pronunciation layouts).

## 5. Non-goals

Real Stars/fiat payments, renewals UX, refunds, `plan_prices` versioning, dunning, admin editing of `plan_feature_access`, trials. All deferred to tech-req 16 phases.

## 6. Open items

- Exact Plus limits (200 translations / 10 videos are placeholders — admin-tunable data).
- Whether grammar/etymology stay bundled in both paid tiers (kept as today; revisit with pricing).
- Copy/tone for "test payment" labeling until Stars go live.
- **Seed must run for the new plan values to take effect.** `db:push` only adds the column; the tier matrix and prices land when `pnpm admin:seed` runs (CI does this on deploy, `deploy.yml`). Until then an environment keeps its old plan rows and the upgrade screen has no priced plans to offer.
- The onboarding video giveaway (`fromOnboarding` → `hasCompletedTrial`) still bypasses the plan's video window, so a Free user's first video from onboarding works despite `videoWindow: "none"`. Left as-is: it is a deliberate acquisition hook, not a hole in the gate.
