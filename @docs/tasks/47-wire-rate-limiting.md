# Task 47 — Wire Rate Limiting into Translation Flow

**Status:** 🔲 To Do  
**Category:** Architecture — Critical  
**Blocks:** Cost control, monetization (Milestone 4+), abuse protection

---

## Goal

Wire the existing (but completely unused) rate-limiting infrastructure into the translation flow. The DB layer already has full support that is **entirely dead code**:

- `translationRequests` table — exists, never populated
- `translationRequestRepository.logTranslationRequest()` — exists, never called from app
- `translationRequestRepository.getUserRequestsInWindow()` — exists, never called from app

No handler in the bot ever calls `logTranslationRequest()` or checks request counts. A single user can trigger unlimited AI calls with zero throttling.

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

1. Before every translation, check user's request count in the current day
2. If over limit, show localized "rate limit reached" message instead of translating
3. After every successful translation, log the request to `translationRequests`
4. Make the daily limit configurable via env var (`DAILY_TRANSLATION_LIMIT`, default: 50)
5. Regeneration counts as a translation request (uses AI tokens)

## Acceptance Criteria

- [ ] `DAILY_TRANSLATION_LIMIT` added to `packages/infra/src/config.ts` env schema (default: 50)
- [ ] `handleTranslateText()` checks `getUserRequestsInWindow()` before calling AI
- [ ] If rate limit exceeded, reply with localized `t("rateLimitReached", lang, { limit })` message and return early
- [ ] After successful translation, call `logTranslationRequest()` with userId, original, sourceLang, targetLangs
- [ ] `handleRegenCallback()` also counts against the rate limit (check before + log after)
- [ ] i18n key `rateLimitReached` added to all locale files (en, ru, cs)
- [ ] Rate limit window is 24 hours rolling (midnight-to-midnight or rolling 24h — decide and document)
- [ ] Existing tests pass
- [ ] New test: user at limit gets rate limit message instead of translation
- [ ] New test: user under limit gets normal translation + request logged
- [ ] New test: regeneration counts against limit

## Dependencies

None (infrastructure already exists in DB layer)

## Effort Estimate

3–4 hours (wire logging: 1h, add limit check: 1h, i18n + config: 0.5h, tests: 1.5h)

## Files Likely Affected

- `packages/infra/src/config.ts` — add `DAILY_TRANSLATION_LIMIT` to env schema
- `apps/bot/src/scenes/helpers/translate-mode.helper.ts` — add rate check + request logging
- `apps/bot/src/scenes/helpers/regen.helper.ts` — add rate check + request logging
- `packages/core/src/modules/i18n/locales/en.json` — add `rateLimitReached` key
- `packages/core/src/modules/i18n/locales/ru.json` — add `rateLimitReached` key
- `packages/core/src/modules/i18n/locales/cs.json` — add `rateLimitReached` key
- Test files for translate-mode and regen helpers
