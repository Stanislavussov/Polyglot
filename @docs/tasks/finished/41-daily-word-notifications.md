# Task 41 — Daily Word Notifications (from Dictionary & AI)

**Status:** ✅ Done
**BRD ref:** §2.5 "Post-MVP 2.5 Notifications (Telegram Push)"
**Depends on:** Task 33 (flashcards & word review), Task 39 (normalized vocabulary), Task 40 (dictionary browse)

---

## Goal

Deliver one daily Telegram notification per user containing a word + translations in all user languages + CEFR-level context.
The word is sourced from two strategies: **dictionary SRS review** (word the user already saved but hasn't reviewed recently) or **AI-suggested new word** (from built-in topics). The user chooses the notification type, time slot, and timezone via settings.

---

## Current State Analysis

### What EXISTS already:
- `packages/adapters/notifications/src/` — **partial implementation**:
  - `createNotificationService()` with `pickSuggestedWord()` (AI-suggested from topics) ✅
  - `logNotificationSent()` logging stub ✅
  - `NotificationServiceDeps`, `SuggestedWord`, `NotificationPayload`, `SendFn` types ✅
  - `scheduler.ts` — **planned, not implemented** ❌
  - `startScheduler()`, `stopScheduler()`, `getUsersForNotification()`, `buildNotificationPayload()` — **planned, not implemented** ❌
- `packages/adapters/db/src/schema.ts`:
  - `userLanguageSettings.timezone` column exists (default `"UTC"`) ✅
  - `wordReviewLog` table exists (tracks flashcard/notification/quiz reviews) ✅
  - No `notification_preferences` columns or table ❌
- `vocabularyRepository` — full CRUD, `findByUser()`, `findByUserPaginated()`, `countByUser()` ✅
- `wordReviewRepository` — `getReviewCounts()`, `getReviewsForWord()` ✅
- `NOTIFICATION_OUTPUT` preset in `packages/core/src/shared/translation-output.presets.ts` ✅
- i18n key `notificationTimeSet` exists; no other notification i18n keys ❌
- Settings scene (`/settings`) — shows native/learning/interface language, no notification options ❌

### What's MISSING:
1. DB: notification preference columns (enabled, time slot, notification type)
2. DB: query to find "least reviewed" or "due for review" dictionary words
3. Notification service: `pickDictionaryWord()` — select word from user's vocabulary based on review history
4. Scheduler: cron job, timezone-aware user filtering, send loop
5. Bot: notification message formatter (Telegram HTML)
6. Bot: `sendFn` injection at startup
7. Settings: notification preferences UI (enable/disable, time, type)
8. i18n: notification-related strings
9. Inactivity pause logic (14-day rule)

---

## Subtasks

### 41.1 — DB: Add notification preference columns
**Goal:** Store user notification preferences.
**Acceptance Criteria:**
- [x] New migration adds columns to `userLanguageSettings`:
  - `notification_enabled` (boolean, default `false`)
  - `notification_time` (text: `'morning'` | `'evening'`, default `'morning'`)
  - `notification_type` (text: `'suggested'` | `'srs'` | `'both'`, default `'both'`)
  - `last_interaction_at` (timestamp, nullable — for 14-day inactivity pause)
- [x] Schema updated in `schema.ts`
- [x] `userRepository` gains `updateNotificationPrefs()` and `updateLastInteraction()`
- [x] New `notificationRepository` with `getUsersForWindow(hour: number)` — returns users where `notification_enabled = true`, local time matches `notification_time` slot (morning=8, evening=20), and `last_interaction_at` within 14 days
- [x] Tests for new repository methods

**Effort:** 3–4h
**Files:** `packages/adapters/db/src/schema.ts`, `packages/adapters/db/drizzle/0014_*.sql`, `packages/adapters/db/src/repositories/user.repository.ts`, `packages/adapters/db/src/repositories/notification.repository.ts` (new), tests

---

### 41.2 — Notification service: `pickDictionaryWord()`
**Goal:** Select a word from the user's dictionary that needs review (least reviewed / longest since last review).
**Acceptance Criteria:**
- [x] New method `pickDictionaryWord(userId)` in notification service
- [x] Strategy: get user's vocabulary → get review counts → pick word with fewest reviews (tie-break: oldest `createdAt`)
- [x] Returns `SuggestedWord` format (original + emoji + translations map) or `null` if dictionary is empty
- [x] Falls back gracefully: if user has no saved words → returns `null` (caller uses AI-suggested instead)
- [x] New dep in `NotificationServiceDeps`: `getUserVocabulary` and `getReviewCounts`
- [x] Unit tests with mocked deps (empty dictionary, all reviewed equally, partial translations)

**Effort:** 3–4h
**Files:** `packages/adapters/notifications/src/notification.service.ts`, `packages/adapters/notifications/src/types.ts`, `packages/adapters/notifications/src/notification.service.test.ts`

---

### 41.3 — Scheduler: cron job + timezone-aware delivery
**Goal:** Implement the scheduler that runs hourly, checks which users are due for a notification, picks words, and sends messages.
**Acceptance Criteria:**
- [x] `scheduler.ts` implements `startScheduler(sendFn)` and `stopScheduler()`
- [x] Single cron job runs every hour (`0 * * * *`)
- [x] Each tick: query `notificationRepository.getUsersForWindow(currentUtcHour)` — the repo handles timezone math (user's local hour = UTC hour + timezone offset)
- [x] For each user: pick word based on their `notification_type` preference:
  - `'srs'` → try `pickDictionaryWord()`, fallback to `pickSuggestedWord()` if empty
  - `'suggested'` → `pickSuggestedWord()`
  - `'both'` → alternate or random pick between the two
- [x] Build notification payload via `buildNotificationPayload()`
- [x] Call `sendFn(telegramId, payload)` — on error, log and continue (never stop)
- [x] Log each sent notification via `logNotificationSent()`
- [x] Tests for scheduler logic (mocked cron, sendFn, deps)

**Effort:** 4–5h
**Files:** `packages/adapters/notifications/src/scheduler.ts`, `packages/adapters/notifications/src/scheduler.test.ts` (new), `packages/adapters/notifications/src/index.ts`

---

### 41.4 — Bot: notification message formatter + `sendFn` injection
**Goal:** Format notification payloads as Telegram messages and wire the scheduler into the bot startup.
**Acceptance Criteria:**
- [x] New `notification.formatter.ts` in bot — converts `NotificationPayload` → Telegram HTML message:
  - Emoji + original word
  - Translations per language with flag emoji
  - CEFR level (if available from vocabulary data)
  - Inline keyboard: "📖 Open dictionary" / "⏭ Skip"
- [x] Bot startup calls `startScheduler(sendFn)` where `sendFn` uses `bot.api.sendMessage()`
- [x] Graceful shutdown calls `stopScheduler()`
- [x] Callback handler for "Open dictionary" button (deep-links to `/dictionary` with the word)
- [x] Tests for formatter output

**Effort:** 3–4h
**Files:** `apps/bot/src/notifications/notification.formatter.ts` (new), `apps/bot/src/notifications/notification.formatter.test.ts` (new), `apps/bot/src/index.ts` (startup wiring)

---

### 41.5 — Settings: notification preferences UI
**Goal:** Let users enable/disable notifications and configure time slot + type from `/settings`.
**Acceptance Criteria:**
- [x] Settings scene shows notification section below language settings:
  - 🔔 Notifications: On/Off
  - ⏰ Time: Morning (8:00) / Evening (20:00)
  - 📋 Type: Dictionary word / AI suggestion / Both
  - 🌍 Timezone: (current value, tap to change)
- [x] Inline keyboard buttons for toggling each preference
- [x] Timezone picker: show common timezones grouped by region (UTC±N list), or accept text input like "Europe/Prague"
- [x] On first enable: prompt for timezone if still default `"UTC"`
- [x] All preference changes persist via `userRepository.updateNotificationPrefs()`
- [x] Tests for settings keyboard building and callback handling

**Effort:** 4–5h
**Files:** `apps/bot/src/scenes/settings.scene.ts`, `apps/bot/src/scenes/helpers/settings.helper.ts`, tests

---

### 41.6 — i18n: notification strings
**Goal:** Add all notification-related i18n keys for `en`, `ru`, `cs`.
**Acceptance Criteria:**
- [x] Keys added to all 3 locale files:
  - `notifTitle`, `notifWordFromDict`, `notifAiSuggested`, `notifTranslations`, `notifOpenDict`, `notifSkip`
  - `settingsNotifSection`, `settingsNotifEnabled`, `settingsNotifDisabled`, `settingsNotifTime`, `settingsNotifType`, `settingsNotifTimezone`
  - `settingsNotifToggle`, `settingsNotifChooseTime`, `settingsNotifChooseType`, `settingsNotifChooseTimezone`
  - `notifPaused` (14-day inactivity message), `notifReEngagement`
- [x] Types updated in `i18n/types.ts`
- [x] Existing tests pass, new interpolation tests added

**Effort:** 2–3h
**Files:** `packages/core/src/modules/i18n/locales/en.json`, `ru.json`, `cs.json`, `packages/core/src/modules/i18n/types.ts`, tests

---

### 41.7 — Inactivity pause + re-engagement
**Goal:** Pause notifications for inactive users and send a re-engagement message.
**Acceptance Criteria:**
- [x] Auth middleware updates `last_interaction_at` on every bot interaction (fire-and-forget)
- [x] `notificationRepository.getUsersForWindow()` excludes users with `last_interaction_at` older than 14 days
- [x] When a user crosses the 14-day threshold: send one re-engagement message ("We paused your notifications. Use /settings to re-enable.") and set `notification_enabled = false`
- [x] Re-engagement cron (daily, separate from hourly notification cron) or checked inline during hourly tick
- [x] Tests for inactivity detection and re-engagement flow

**Effort:** 2–3h
**Files:** `apps/bot/src/middlewares/auth.ts` (add `updateLastInteraction`), `packages/adapters/db/src/repositories/notification.repository.ts`, `packages/adapters/notifications/src/scheduler.ts`, tests

---

## Execution Order

```
41.6 (i18n)  ──────────────────────────────────┐
41.1 (DB schema + repos) ──┐                   │
                            ├─→ 41.2 (pickDictionaryWord) ──┐
                            │                                ├─→ 41.3 (scheduler) ─→ 41.4 (bot wiring)
                            └─→ 41.5 (settings UI) ─────────┘          │
                                                                        └─→ 41.7 (inactivity pause)
```

- **41.1** and **41.6** can start in parallel (no deps)
- **41.2** depends on 41.1 (needs vocabulary + review queries)
- **41.3** depends on 41.1 + 41.2 (needs repos + both word pickers)
- **41.4** depends on 41.3 (needs scheduler API)
- **41.5** depends on 41.1 (needs preference columns)
- **41.7** depends on 41.1 + 41.3 (needs last_interaction_at + scheduler)

---

## Out of Scope (for this task)

- Full SRS algorithm (SM-2 / FSRS) — uses simple "least reviewed" strategy for now
- Push notification batching / rate limiting at Telegram API level
- Analytics dashboard for notification open rates
- Custom notification frequency (only daily for now)

---

# Revision — Productionize Notifications (2026-05-16)

**Status:** 📋 Proposed  
**Trigger:** Task marked Done but has runtime bugs and isn't production-ready

## Current Reality (post-implementation audit)

### What's actually working:
- ✅ All 7 subtasks (41.1–41.7) implemented and wired
- ✅ 66 unit tests across 4 test files
- ✅ Scheduler runs on bot startup via `node-cron` (`0 * * * *`)
- ✅ Settings UI for notification preferences
- ✅ Inactive user re-engagement (14-day rule)

### Known issues:
1. 🔴 **Schema mismatch** — `notification_time` column stores `'morning'`/`'evening'` (TEXT DEFAULT `'morning'`) but code expects integer hour strings (`"8"`, `"20"`) via `parseNotificationHour()`. Runtime bug.
2. 🔴 **No `SCHEDULER_ENABLED` env toggle** — scheduler always runs in bot process, cannot be disabled for dev/testing
3. 🟠 **No retry logic** — send failures are logged and dropped, no retry
4. 🟠 **Single process** — scheduler runs inside bot process (Task 48 blocks extraction)
5. 🟠 **No production deployment config** — docker-compose has no scheduler service, no env vars

## Revision Scope

### Phase 1 — Fix & Stabilize

#### R1. Fix `notification_time` schema mismatch
**Goal:** Align DB storage with code expectations.
**Options:**
- **A (preferred):** Change column to store integer hours (`0`–`23`). Update migration 0014, settings UI shows "8:00" / "20:00" instead of "Morning" / "Evening".
- **B:** Keep named slots, update code to map `'morning'` → `8`, `'evening'` → `20` via a lookup table.
**Acceptance Criteria:**
- [ ] Schema and code agree on value format
- [ ] Existing user data migrated (if any)
- [ ] Settings UI displays and stores correct format
- [ ] Tests updated

#### R2. Add `SCHEDULER_ENABLED` env toggle
**Goal:** Allow disabling scheduler in dev/testing environments.
**Acceptance Criteria:**
- [ ] `SCHEDULER_ENABLED` added to `packages/infra/src/config.ts` (default `true`)
- [ ] `apps/bot/src/index.ts` conditionally calls `wireNotificationScheduler()` based on env var
- [ ] `.env.example` documents the toggle
- [ ] Tests pass with scheduler disabled

#### R3. Add basic send retry logic
**Goal:** Don't drop notifications on transient Telegram API errors.
**Acceptance Criteria:**
- [ ] Scheduler retries failed sends up to 3 times with exponential backoff (1s, 2s, 4s)
- [ ] After max retries, log error and continue (never block the tick)
- [ ] Tests cover retry behavior

**Effort:** 4–6h total

---

### Phase 2 — Extract Scheduler (merge with Task 48) — ⏸️ DEFERRED

**Status:** Not needed at MVP scale. Revisit when:
- 100+ active users and hourly tick takes noticeable time
- Multiple bot instances cause duplicate sends
- Scheduler needs independent resource profile or scaling

**Kept here as reference for when it becomes relevant.**

#### R4. Separate scheduler process *(deferred)*
**Goal:** Scheduler runs independently from bot process.
**Acceptance Criteria:**
- [ ] `apps/scheduler/` — new entry point (or `apps/bot/src/scheduler-entry.ts`)
- [ ] Scheduler loads config, DB, starts cron loop — no bot polling
- [ ] Sends via raw Telegram Bot API (no grammY Bot instance needed)
- [ ] `apps/bot/src/index.ts` no longer calls `wireNotificationScheduler()` when `SCHEDULER_ENABLED=false`
- [ ] `pnpm scheduler` script added to root `package.json`
- [ ] `docker-compose.yml` updated with `scheduler` service
- [ ] Graceful shutdown (stop cron, close DB)
- [ ] Dev mode: `SCHEDULER_ENABLED=true` in bot process still works (backward compatible)
- [ ] Existing tests pass unchanged

**Effort:** 4–6h (when triggered)

---

## Execution Order

```
R1 (schema fix) ──┐
R2 (env toggle) ──┼──→ R3 (retry logic)
                    │
R4 (deferred) — only after R2, when scale demands it
```

## Dependencies

- Phase 1: No external deps. All files exist and are modifiable.
- Phase 2: Depends on Phase 1 R2 (env toggle). Deferred until scale triggers it.

## Out of Scope (for this revision)

- Full SRS integration (SM-2/FSRS) — still Milestone 2.0
- Job queue replacement (BullMQ, etc.) — `node-cron` stays
- Separate scheduler process (Phase 2) — deferred
- Analytics / open rate tracking
- Custom notification frequency (still daily only)
