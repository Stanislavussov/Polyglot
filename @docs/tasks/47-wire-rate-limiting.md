# Task 47 — Wire Rate Limiting into Translation Flow

**Status:** ✅ Done  
**Category:** Architecture — Critical  
**Blocks:** Cost control, monetization (Milestone 4+), abuse protection

---

## Goal

Wire the existing rate-limiting infrastructure into the translation flow. Implemented as subscription-plan credits over a rolling 24-hour window:

- `users.subscription_plan` stores the user's plan (`free`, `plus`, `pro`, `unlimited`)
- `translation_requests.credit_cost` stores consumed translation credits
- `translationRequestRepository.getUserCreditsInWindow()` sums credits for rate limiting
- `translationRequestRepository.logTranslationRequest()` records successful translations

One incoming user translation request costs 1 credit, regardless of target language count, context enrichment, or regeneration. Regeneration is not user-metered. Current plan limits live in `packages/core/src/modules/rate-limit/index.ts`: Free 50/day, Plus 300/day, Pro 1500/day, Unlimited no cap.

## Problem Analysis

```bash
# Zero usages of the rate limiting repo from the app layer:
$ grep -rn "logTranslationRequest\|translationRequestRepository" apps/ --include="*.ts"
# (empty — no results)

# The translate handler calls AI with no limit check:
# apps/bot/src/scenes/helpers/translate-mode.helper.ts
const output = await translateWithContext({ ... }, { generateObjectFn: generateObject });
# ← No rate check before this call
# ← No request logged after this call
```

## Required Behavior

1. Before every translation, check user's credit usage in the rolling 24-hour window
2. If over limit, show localized "rate limit reached" message instead of translating
3. After every successful translation, log the request to `translationRequests`
4. Show plan and remaining daily credits in `/settings`
5. Regeneration does not count against user-facing translation credits

## Acceptance Criteria

- [x] Subscription plans added to `users.subscription_plan`
- [x] Credit cost added to `translation_requests.credit_cost`
- [x] `handleTranslateText()` checks `getUserCreditsInWindow()` before calling AI
- [x] If rate limit exceeded, reply with localized `t("rateLimitExceeded", lang)` message and return early
- [x] After successful translation, call `logTranslationRequest()` with userId, original, sourceLang, targetLangs, creditCost
- [x] `handleRegenCallback()` is not user-metered and does not consume translation credits
- [x] i18n key `rateLimitExceeded` added to locale files (en, ru, cs)
- [x] Rate limit window is rolling 24h
- [x] `/settings` shows plan and remaining daily credits
- [x] Existing tests pass
- [x] New test: user at limit gets rate limit message instead of translation
- [x] New test: user under limit gets normal translation + request logged
- [x] New test: regeneration bypasses the user-facing limit

## Dependencies

None (infrastructure already exists in DB layer)

## Effort Estimate

3–4 hours (wire logging: 1h, add limit check: 1h, i18n + config: 0.5h, tests: 1.5h)

## Files Likely Affected

- `packages/core/src/modules/rate-limit/index.ts` — plan policy and rolling-window helpers
- `packages/adapters/db/src/schema.ts` — `users.subscription_plan`, `translation_requests.credit_cost`
- `packages/adapters/db/drizzle/0021_common_pet_avengers.sql` — generated migration
- `apps/bot/src/scenes/helpers/translate-mode.helper.ts` — rate check + request logging
- `apps/bot/src/scenes/settings.scene.ts` — plan/credit display
- `packages/core/src/modules/i18n/locales/*.json` — rate-limit/settings plan copy
- Tests for policy, repository, translate flow, settings, and regeneration
