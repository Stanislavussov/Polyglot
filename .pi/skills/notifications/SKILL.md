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

- `logNotificationSent()` — structured logging stub using `logger` from `@polyglot/infra`. Accepts both `'suggested'` and `'srs'` notification types (BUG-07 fix). Uses `NotificationType` alias.
- `createNotificationService(deps)` — factory that returns `{ pickSuggestedWord }`. Uses topic service (via injected deps) to pick a random word from a random built-in topic, with **partial regeneration** support: if a cached topic word is missing a translation for one of the user's learning languages, calls `regenerateTopicWord` to fill the gap (one language at a time, not re-translating the entire word).
- After Task 15 (context-enrichment layer), dictionary context lookup was removed from `NotificationServiceDeps` — `lookupDictionaryContext` is gone. Dictionary context enrichment is now handled by the context-enrichment layer at the translation level.
- Full scheduler (cron, sendFn injection) is not yet implemented.

## Rules

1. Does not import the `bot` agent — receives `sendFn` as a parameter at startup
2. One cron job for the entire schedule — do not create a job per user
3. On send error — log and continue, do not stop the entire scheduler
4. Respect user timezone when sending
5. Dependencies injected via `NotificationServiceDeps` — no direct imports of db/topic adapters

## Cron Schedule

```typescript
// Two time slots: morning (8:00) and evening (20:00)
// Single cron checks all users — filters by their timezone
cron.schedule("0 * * * *", () => checkAndSend());  // Run every hour, check which users' local time matches
```

## Skills (Public API)

```typescript
// Log a successfully dispatched notification (implemented)
function logNotificationSent(params: { userId: number; type: NotificationType; wordId: number }): void;

// Create notification service with injected deps (implemented)
function createNotificationService(deps: NotificationServiceDeps): {
  pickSuggestedWord: (userId: number) => Promise<SuggestedWord | null>;
};

// Start the scheduler with injected send function (not yet implemented)
function startScheduler(sendFn: SendFn): void;

// Graceful shutdown — stop cron jobs (not yet implemented)
function stopScheduler(): void;

// Get users whose local time matches the notification window (not yet implemented)
async function getUsersForNotification(time: "morning" | "evening"): Promise<UserForNotification[]>;

// Build notification payload for a specific user (not yet implemented)
async function buildNotificationPayload(user: UserForNotification): Promise<NotificationPayload>;
```

## Types

```typescript
import type { DictionaryContext } from "@polyglot/core";

/** BRD §2.5 notification categories: AI-suggested word or SRS review word. */
type NotificationType = "suggested" | "srs";

type SendFn = (telegramId: number, payload: NotificationPayload) => Promise<void>;

interface UserForNotification {
  id: number;
  telegramId: number;
  timezone: string;
  nativeLang: string;
  learningLangs: string[];
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
  dictionaryContext?: DictionaryContext;  // Wiktionary enrichment (optional, set by context-enrichment layer)
}

interface NotificationServiceDeps {
  getTopicWords: (topicId: string, sourceLang: string, targetLangs: string[]) => Promise<TopicWord[]>;
  regenerateTopicWord?: (topicId: string, original: string, sourceLang: string, targetLang: string) => Promise<LanguageTranslationEntry>;
  getBuiltinTopics: () => TopicMeta[];
  getUserSettings: (userId: number) => Promise<UserForNotification | null>;
  // Note: lookupDictionaryContext was removed in Task 15.
  // Dictionary context enrichment is now handled by the context-enrichment layer.
}
```

## File Structure

```
packages/adapters/notifications/src/
├── index.ts                           # Exports: logNotificationSent, createNotificationService, types
├── index.test.ts                      # Vitest tests for logNotificationSent (6 tests, incl. BUG-07 srs type)
├── types.ts                           # SendFn, NotificationPayload, SuggestedWord, NotificationServiceDeps
├── notification.service.ts            # createNotificationService factory → pickSuggestedWord (with partial regen)
├── notification.service.test.ts       # 18 Vitest tests for pickSuggestedWord
├── dictionary-context.test.ts         # 4 Vitest tests verifying post-context-enrichment refactor (no lookupDictionaryContext)
├── scheduler.ts                       # (planned) node-cron setup, checkAndSend logic
```

## Data Flow: Word Suggestion in Notifications

```
pickSuggestedWord(userId)
  → getUserSettings(userId)         // get user's native + learning langs
  → getBuiltinTopics()              // random topic
  → getTopicWords(topicId, ...)     // cache-first topic words
  → [for each learning lang]
      translations[lang] = existing || regenerateTopicWord(...)
  → return { original, emoji, translations }
  // Note: dictionary context enrichment is handled upstream by context-enrichment layer
```

## Reference

- Notification spec: `docs/tech-reqs/11-notifications.md`
- Architecture: `docs/tech-reqs/02-architecture.md`
- Agent contracts: `docs/tech-reqs/14-agents.md` (notifications section)
- Partial regeneration task: `docs/tasks/07-partial-regeneration.md`
- Wiktionary integration task: `docs/tasks/13-wiktionary-jsonl.md`
