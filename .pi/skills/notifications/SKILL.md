---
name: notifications
description: Notification scheduling and delivery with cron, timezone-aware sending, and word suggestions. Receives sendFn via injection (no bot import). Use when implementing or modifying notification scheduling, delivery logic, or word-of-the-day features.
---

# notifications Agent Skill

## Module Location

`packages/adapters/notifications/src/`

## Architecture Context

- **Layer:** Adapter (platform-dependent — uses node-cron)
- **Dependencies:** `db` agent (for user queries), `topics` agent (for word suggestions, including partial regeneration)
- **Dependents:** `bot` agent injects `sendFn` at startup

## Current State

- `logNotificationSent()` — structured logging using `logger` from `@polyglot/infra`. Accepts both `'suggested'` and `'srs'` notification types. ✅
- `createNotificationService(deps)` — factory that returns `{ pickSuggestedWord, pickDictionaryWord }`. ✅
  - `pickSuggestedWord(userId)` — picks a random word from a random built-in topic with partial regeneration support. ✅
  - `pickDictionaryWord(userId)` — picks the least-reviewed word from user's vocabulary (tie-break: oldest createdAt). Falls back to null if dictionary empty. ✅
- `startScheduler(sendFn, reEngagementSendFn, deps)` — starts a single cron job (0 * * * *) that checks all users each hour. ✅
- `stopScheduler()` — graceful shutdown of the cron job. ✅
- `checkAndSend(sendFn, deps)` — processes one hourly tick: queries eligible users, picks words, sends notifications. ✅
- `buildNotificationPayload(user, word, t)` — builds NotificationPayload with HTML message. ✅
- `processInactiveUsers(reEngagementSendFn, deps)` — sends re-engagement message and disables notifications for inactive users. ✅
- Word picking respects user's `notificationType` preference: `'srs'`, `'suggested'`, or `'both'` (random alternation). ✅
- Inactivity re-engagement checked once daily at midnight UTC during the hourly cron tick. ✅

## Boundary

- **Mode:** role — when this skill is active, you ARE the notifications agent. Only modify the notifications adapter.
- **Produces:** notification source code and tests in `packages/adapters/notifications/src/`
- **Never:** modify code outside `packages/adapters/notifications/src/`
- **Never:** import bot — receives `sendFn` via injection
- **Never:** import DB or topic adapters directly — all dependencies injected
- **Allowed tools:** `read`, `bash`, `edit`, `write`
- **Allowed write paths:** `packages/adapters/notifications/src/**`

## Rules

1. Does not import the `bot` agent — receives `sendFn` as a parameter at startup
2. One cron job for the entire schedule — do not create a job per user
3. On send error — log and continue, do not stop the entire scheduler
4. Respect user timezone when sending
5. Dependencies injected via `NotificationServiceDeps` / `SchedulerDeps` — no direct imports of db/topic adapters
6. Timezone and language defaults from DB constants, not hardcoded

## Cron Schedule

```typescript
// Single cron checks all users — filters by their timezone
cron.schedule("0 * * * *", () => checkAndSend());  // Run every hour
// At midnight UTC, also processes inactive users for re-engagement
```

## Skills (Public API)

```typescript
// Log a successfully dispatched notification
function logNotificationSent(params: { userId: number; type: NotificationType; wordId: number }): void;

// Create notification service with injected deps
function createNotificationService(deps: NotificationServiceDeps): {
  pickSuggestedWord: (userId: number) => Promise<SuggestedWord | null>;
  pickDictionaryWord: (userId: number) => Promise<SuggestedWord | null>;
};

// Start the scheduler with injected send function
function startScheduler(sendFn: SendFn, reEngagementSendFn: ReEngagementSendFn, deps: SchedulerDeps): void;

// Graceful shutdown — stop cron jobs
function stopScheduler(): void;

// Process one hourly tick (exported for testing)
async function checkAndSend(sendFn: SendFn, deps: SchedulerDeps): Promise<{ sent: number; errors: number }>;

// Build notification payload for a specific user (exported for testing/bot)
function buildNotificationPayload(user: NotificationUser, word: SuggestedWord, t: TFn): NotificationPayload;

// Process inactive users — re-engagement flow
async function processInactiveUsers(reEngagementSendFn: ReEngagementSendFn, deps: SchedulerDeps): Promise<{ processed: number; errors: number }>;
```

## Types

```typescript
import type { DictionaryContext, LanguageTranslationEntry, TopicMeta, TopicWord } from "@polyglot/core";

/** BRD §2.5 notification categories: AI-suggested word or SRS review word. */
type NotificationType = "suggested" | "srs";

type SendFn = (telegramId: number, payload: NotificationPayload) => Promise<void>;
type ReEngagementSendFn = (telegramId: number, message: string) => Promise<void>;

interface UserForNotification {
  id: number;
  telegramId: number;
  timezone: string;
  nativeLang: string;
  learningLangs: string[];
}

interface NotificationUser {
  userId: number;
  telegramId: number;
  interfaceLang: string;
  nativeLang: string;
  learningLangs: string[];
  timezone: string;
  notificationTime: string;
  notificationType: string;
}

interface NotificationPayload {
  type: "morning" | "evening";
  word: SuggestedWord;
  message: string;
}

interface SuggestedWord {
  original: string;
  emoji: string;
  translations: Record<string, string>;  // lang -> translation text
  source?: NotificationType;  // 'srs' or 'suggested'
  dictionaryContext?: DictionaryContext;
}

interface VocabEntry {
  id: number;
  original: string;
  emoji: string | null;
  createdAt: Date;
  translations: Array<{ targetLangId: number; text: string }>;
}

interface NotificationServiceDeps {
  getTopicWords: (...) => Promise<TopicWord[]>;
  regenerateTopicWord?: (...) => Promise<LanguageTranslationEntry>;
  getBuiltinTopics: () => TopicMeta[];
  getUserSettings: (userId: number) => Promise<UserForNotification | null>;
  getUserVocabulary?: (userId: number) => Promise<VocabEntry[]>;
  getReviewCounts?: (userId: number) => Promise<Map<number, number>>;
  getLangCode?: (langId: number) => string | undefined;
}

interface SchedulerDeps {
  getUsersForWindow: (hour: number) => Promise<NotificationUser[]>;
  getInactiveUsers: () => Promise<NotificationUser[]>;
  disableNotifications: (userId: number) => Promise<void>;
  pickSuggestedWord: (userId: number) => Promise<SuggestedWord | null>;
  pickDictionaryWord: (userId: number) => Promise<SuggestedWord | null>;
  t: (key: string, lang: string, params?: Record<string, string>) => string;
}
```

## File Structure

```
packages/adapters/notifications/src/
├── index.ts                           # Re-exports: logNotificationSent, createNotificationService, scheduler, types
├── index.test.ts                      # 6 Vitest tests for logNotificationSent
├── log.ts                             # logNotificationSent implementation (separated to avoid circular deps)
├── types.ts                           # All public types: SendFn, NotificationPayload, SuggestedWord, deps, etc.
├── notification.service.ts            # createNotificationService → pickSuggestedWord, pickDictionaryWord
├── notification.service.test.ts       # 30 Vitest tests (18 pickSuggestedWord + 11 pickDictionaryWord + 1 source field)
├── scheduler.ts                       # startScheduler, stopScheduler, checkAndSend, buildNotificationPayload, processInactiveUsers
├── scheduler.test.ts                  # 25 Vitest tests for scheduler logic
├── dictionary-context.test.ts         # 4 Vitest tests (post-context-enrichment refactor)
```

## Data Flow: Notification Delivery

```
Cron tick (every hour)
  → checkAndSend(sendFn, deps)
    → deps.getUsersForWindow(utcHour)  // DB filters by timezone + preferences
    → for each user:
      → pickWordForUser(user, deps)
        → based on notificationType: 'srs' | 'suggested' | 'both'
          → pickDictionaryWord(userId)  // least reviewed vocabulary word
          → pickSuggestedWord(userId)   // random topic word with partial regen
      → buildNotificationPayload(user, word, t)  // format message
      → sendFn(telegramId, payload)     // bot sends via Telegram
      → logNotificationSent(...)        // structured logging
    → on error: log and continue

Midnight UTC (once daily):
  → processInactiveUsers(reEngagementSendFn, deps)
    → deps.getInactiveUsers()
    → for each: send re-engagement message, disable notifications
```

## Reference

- Notification spec: `docs/tech-reqs/11-notifications.md`
- Architecture: `docs/tech-reqs/02-architecture.md`
- Agent contracts: `docs/tech-reqs/14-agents.md` (notifications section)
- Task: `docs/tasks/41-daily-word-notifications.md`
