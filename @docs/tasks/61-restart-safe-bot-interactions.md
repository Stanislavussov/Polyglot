# Task 61 — Restart-Safe Bot Interactions & Deploy Continuity

**Status:** 🟨 In Progress  
**Category:** Architecture — Critical  
**Blocks:** Production deploy reliability, SRS UX, flashcards UX, dictionary UX  
**Related:** Task 43, Task 48, Task 55, Task 59

---

## Goal

Make Telegram interactions survive bot restarts and rolling deploys. A deploy must not make old inline buttons silently stop working, must not restart onboarded users into `/start`, and must provide enough health signals to detect whether the bot can process updates after a restart.

Task 43 covers the storage adapter for grammY sessions. This task covers the wider contract: which state is allowed to live in session, which callbacks must be restorable from the database, how stale callbacks degrade, and how deploy health is verified.

---

## Current Bottlenecks

### 1. Process-local session is still the primary interaction state

`apps/bot/src/index.ts` uses grammY `session()` without `storage`, so all non-DB session state disappears on process restart.

Lost state includes:
- `translationMap`, `pendingTranslation`, `pendingCardMsgId`
- `pendingDetectedLang`, `pendingWord`, `pendingDirection`
- `templateWizard`
- `dictionary`
- `flashcard`
- `srs`
- `awaitingNotifContext`

`activeMode` and `lastSourceLang` are partially protected by DB hydration, but most interactive flows are not.

### 2. Translation callbacks are keyed by Telegram `message_id`

Translation save/skip/regen callbacks encode the Telegram card message ID and then read `ctx.session.translationMap[msgId]`.

Consequence:
- After restart, the callback data is still delivered by Telegram, but the bot cannot recover the translation payload.
- Old Save/Regen buttons become expired even when the original translation could have been stored and recovered by ID.
- Only one process-local session owns the context, so horizontal scaling would have the same failure mode.

### 3. Flashcard and SRS sessions store full decks in session

Flashcards store `WordDisplayData[]`; SRS stores `SrsDueVocabularyCard[]`. Callback data is generic (`fc:next`, `srs:rate:good`) and assumes exactly one active in-memory session.

Consequence:
- Restart loses deck position and current card.
- Old messages cannot be resumed because callback data has no durable session/card ID.
- Concurrent decks from multiple messages can conflict because callbacks do not identify which deck/card they belong to.
- Session payloads grow with deck size and increase memory pressure.

### 4. Dictionary callbacks contain IDs but still require session

Dictionary callbacks include durable data like `dict:view:{entryId}` and `dict:page:{page}`, but handlers still reject clicks when `ctx.session.dictionary` is missing.

Consequence:
- Dictionary pages could be reconstructed from DB after restart, but current handlers answer "session expired".
- The callback contract is deeper than the implementation uses; the session check removes available leverage.

### 5. Stale callback handling is inconsistent

Some handlers answer with localized `*SessionExpired` messages; translation save/skip has hardcoded English text; regen silently answers without user feedback when session state is missing.

Consequence:
- Users see inconsistent behavior after deploys.
- Operations cannot distinguish expected stale callbacks from real bugs in logs/metrics.

### 6. Bot startup is a side-effectful module, not a factory

`apps/bot/src/index.ts` constructs the bot, registers middleware, starts metrics, wires the scheduler, registers signal handlers, and starts long polling in one module.

Consequence:
- Restart/deploy behavior is hard to test through a clean seam.
- Task 59 E2E tests need a bot factory to inject `apiRoot`, session storage, and fake services.
- Startup ordering bugs are easy to introduce and hard to isolate.

### 7. Long-polling deploy behavior is not explicitly controlled

The bot runs in long-polling mode inside a container with `restart: unless-stopped`. During deploys, old and new containers can overlap unless orchestration guarantees stop-before-start.

Consequence:
- Telegram can reject one poller with conflict errors if two instances call `getUpdates`.
- A slow shutdown can drop in-flight update handling.
- Restart safety depends on process timing rather than durable state.

### 8. Scheduler is coupled to the bot process

The notification scheduler is started from the bot process. This is already tracked by Task 48, but it matters here because deploys restart both update handling and scheduled notification work at once.

Consequence:
- Deploying bot handlers also interrupts scheduled jobs.
- Notification load or scheduler failures can affect bot responsiveness.

### 9. Health endpoint is too shallow for deploy safety

`/healthz` returns `{ status: "ok", uptime }`, but does not verify DB connectivity, language cache readiness, Telegram polling status, session storage, or scheduler status.

Consequence:
- Docker can mark the container healthy while core interaction state is unavailable.
- Deploy tooling cannot know whether the new process is ready to receive Telegram updates.

---

## Required Behavior

1. Persistent grammY session storage is configured per Task 43, with session versioning and corrupt-session reset.
2. Interactive callbacks are classified as either:
   - **stateless/restorable**: all required data can be recovered from callback data + DB
   - **session-backed**: requires persisted session state with an explicit session ID/version
   - **intentionally ephemeral**: expires gracefully with localized UX and structured metrics
3. Translation callbacks stop relying on Telegram `message_id` as the only lookup key.
4. Flashcard and SRS callbacks include enough durable identity to recover the correct deck/card after restart.
5. Dictionary callbacks reconstruct page/view/delete state from DB when session state is missing.
6. All stale callback paths use localized messages and emit structured logs/metrics.
7. Bot construction is split from process startup so tests can create a bot with injected storage, services, and Telegram API root.
8. Deploy health verifies DB, language cache, session storage, and bot readiness before the process is considered healthy.
9. Long-polling lifecycle handles shutdown without leaving overlapping pollers or in-flight updates unaccounted for.

---

## Acceptance Criteria

### Session Storage

- [x] Persistent grammY session storage is configured per Task 43, with session versioning and corrupt-session reset.

### Callback Contract Audit

- [x] Add `apps/bot/src/callbacks/contracts.ts` or equivalent documentation/code module listing every callback prefix and its restart-safety class.
- [x] Audit prefixes: `tr:*`, `fc:*`, `srs:*`, `dict:*`, `tpl:*`, `set:*`, `notif:*`.
- [x] For each prefix, document the durable lookup key, expected DB source, and expiry behavior.
- [x] Add tests asserting callback data stays within Telegram's 64-byte `callback_data` limit.

### Translation Flow

- [ ] Store translation result snapshots or reduced translation metadata in DB/cache keyed by a durable `translationSessionId` or `translationRequestId`.
- [ ] Change `tr:save`, `tr:skip`, and `tr:regen` callbacks to use the durable ID, not only Telegram `message_id`.
- [ ] Save and regen work after simulated bot restart.
- [ ] If the durable translation record has expired, user receives localized stale callback text and logs include `{ callbackFamily: "translation", reason: "expired" }`.
- [ ] Remove or reduce large `TranslateOutput` payloads from `SessionData`.

### Flashcard Flow

- [ ] Replace session-stored `WordDisplayData[]` decks with durable deck/session references.
- [ ] Callback data identifies deck/session and current card, or handlers can derive current state from DB.
- [ ] User can reveal/next/quit a flashcard deck after simulated restart.
- [ ] Starting a second deck does not make callbacks from the first deck control the second deck.

### SRS Flow

- [ ] Replace session-stored `SrsDueVocabularyCard[]` decks with durable review session references or deterministic due-card lookup.
- [ ] `srs:rate:*` callback identifies the reviewed translation/card, not just the rating.
- [ ] Rating a card after restart updates the intended translation row exactly once.
- [ ] Duplicate callback handling is idempotent or explicitly guarded.

### Dictionary Flow

- [x] `dict:page`, `dict:view`, `dict:delete`, and `dict:confirm-delete` no longer require `ctx.session.dictionary` when callback data contains enough state.
- [x] Dictionary page/view/delete callbacks work after simulated restart.
- [x] Delete confirmation validates ownership before deleting.

### Ephemeral Flows

- [ ] Template wizard and notification context input are either persisted or explicitly documented as ephemeral.
- [ ] Ephemeral flows have localized stale-session responses.
- [ ] Hardcoded English stale callback messages are replaced with i18n keys.

### Bot Factory & Deploy Lifecycle

- [ ] Extract bot construction into a factory that accepts token, services, session storage, API root, and feature flags.
- [ ] Keep process startup in a thin entry point: config load, DB connect/cache load, metrics, scheduler wiring, `bot.start()`, signal handling.
- [x] Graceful shutdown waits for `bot.stop()` and DB close without calling `process.exit(0)` before awaited cleanup completes.
- [x] Startup logs include session storage type, language cache readiness, and polling mode.
- [ ] Deployment docs specify whether production uses stop-before-start long polling or webhook mode.

### Health & Observability

- [ ] `/healthz` verifies DB ping, language cache loaded, session storage read/write, and bot readiness.
- [ ] `/readyz` or equivalent readiness endpoint returns unhealthy until startup wiring is complete.
- [ ] Metrics include stale callback counts by family/reason.
- [ ] Bot error logs include callback data family, session version, user ID, and active mode when available.

### Tests

- [ ] Add restart simulation tests that create bot instance A, process a command/message, create bot instance B with same storage, then process the old callback.
- [ ] Cover translation save/regen, dictionary view/page/delete, flashcard next/reveal, and SRS rate.
- [ ] Add a regression test for plain text after restart: onboarded user in translate mode sends a word and does not receive `welcomeBack`.
- [ ] No tests call real Telegram or real AI services.

---

## Dependencies

- **Requires:** Task 43 for persistent session storage foundation.
- **Benefits from:** Task 59 for Telegram API emulator and bot factory test harness.
- **Overlaps with:** Task 48 for scheduler/process separation and Task 55 for health checks.

Implementation can be staged:
1. Bot factory + restart simulation harness.
2. Translation durable callback IDs.
3. Dictionary stateless callback recovery.
4. Flashcard/SRS durable session IDs.
5. Health/readiness and deploy lifecycle hardening.

---

## Effort Estimate

12-18 hours total:
- Callback contract audit: 1-2h
- Bot factory and restart harness: 3-4h
- Translation durable callbacks: 3-4h
- Dictionary recovery: 1-2h
- Flashcard/SRS durable sessions: 4-6h
- Health/readiness/deploy docs: 1-2h

---

## Files Likely Affected

- `apps/bot/src/index.ts` — split factory from process startup
- `apps/bot/src/bot-factory.ts` — NEW factory module
- `apps/bot/src/session-storage.ts` — persistent storage adapter from Task 43
- `apps/bot/src/callbacks/contracts.ts` — NEW callback contract registry
- `apps/bot/src/scenes/helpers/translate-mode.helper.ts`
- `apps/bot/src/scenes/helpers/flashcard.helper.ts`
- `apps/bot/src/scenes/helpers/srs.helper.ts`
- `apps/bot/src/scenes/helpers/dictionary.helper.ts`
- `apps/bot/src/scenes/helpers/template.helper.ts`
- `apps/bot/src/renderers/translation.renderer.ts`
- `apps/bot/src/renderers/flashcard.renderer.ts`
- `apps/bot/src/renderers/srs.renderer.ts`
- `apps/bot/src/renderers/dictionary.renderer.ts`
- `apps/bot/src/metrics.ts`
- `packages/adapters/db/src/schema.ts` — only via Drizzle Kit if new durable session/snapshot tables are needed
- `packages/adapters/db/src/repositories/*`
- `packages/core/src/modules/i18n/locales/*.json`
- `deploy/docker-compose.yml`
- `deploy/ansible/*`
- `@docs/tasks/43-persistent-session-storage.md`
- `@docs/tasks/55-health-check-and-observability.md`
- `@docs/tasks/59-e2e-bot-tests.md`

---

## Verification

Run the full quality gate after implementation:

```bash
pnpm build && pnpm lint && pnpm lint:deps && pnpm test
```

## Implementation Notes

Completed in this staged pass:
- Added `apps/bot/src/bot-factory.ts` and kept `apps/bot/src/index.ts` as a thin startup entry point.
- Added Postgres-backed grammY session storage using `bot_sessions`, with versioned writes and corrupt-session reset.
- Added `apps/bot/src/callbacks/contracts.ts` plus contract tests for callback restart-safety metadata and Telegram's 64-byte callback data limit.
- Made dictionary page/view/delete/confirm-delete callbacks recover from DB when `ctx.session.dictionary` is absent.
- Added dictionary ownership validation before view/delete/confirm-delete actions.
- Updated dictionary callback data to carry page context where needed: `dict:view:{entryId}:{page}` and `dict:delete:{entryId}:{page}`.
- Generated `packages/adapters/db/drizzle/0022_complex_lionheart.sql` via `pnpm db:generate`.
- Verified with `pnpm build && pnpm lint && pnpm lint:deps && pnpm test`.

Manual production-style verification:
1. Start bot with persistent storage.
2. Send a word, receive translation card.
3. Restart the bot process.
4. Click Save and Regen on the old card.
5. Start flashcards and SRS, restart, continue from old buttons.
6. Open dictionary, restart, use old page/view/delete buttons.
7. Send plain text after restart and confirm it translates instead of showing `welcomeBack`.
