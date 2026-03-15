---
name: notifications
description: Notification scheduling and delivery with cron, timezone-aware sending, and word suggestions. Receives sendFn via injection (no bot import). Use when implementing or modifying notification scheduling, delivery logic, or word-of-the-day features.
---

# notifications Agent Skill

## Module Location

`packages/adapters/notifications/src/`

## Architecture Context

- **Layer:** Adapter (platform-dependent — uses node-cron)
- **Dependencies:** `db` agent (for user queries), `topics` agent (for word suggestions)
- **Dependents:** `bot` agent injects `sendFn` at startup

## Current State

`packages/adapters/notifications/src/index.ts` exports `logNotificationSent()` — a structured logging stub that uses `logger` from `@polyglot/infra` to log notification-sent events. Full scheduler (cron, sendFn injection) is not yet implemented.

## Rules

1. Does not import the `bot` agent — receives `sendFn` as a parameter at startup
2. One cron job for the entire schedule — do not create a job per user
3. On send error — log and continue, do not stop the entire scheduler
4. Respect user timezone when sending

## Cron Schedule

```typescript
// Two time slots: morning (8:00) and evening (20:00)
// Single cron checks all users — filters by their timezone
cron.schedule("0 * * * *", () => checkAndSend());  // Run every hour, check which users' local time matches
```

## Skills (Public API)

```typescript
// Log a successfully dispatched notification (implemented)
function logNotificationSent(params: { userId: number; type: 'suggested'; wordId: number }): void;

// Start the scheduler with injected send function (not yet implemented)
function startScheduler(sendFn: SendFn): void;

// Graceful shutdown — stop cron jobs (not yet implemented)
function stopScheduler(): void;

// Get users whose local time matches the notification window (not yet implemented)
async function getUsersForNotification(time: "morning" | "evening"): Promise<UserForNotification[]>;

// Build notification payload for a specific user (not yet implemented)
async function buildNotificationPayload(user: UserForNotification): Promise<NotificationPayload>;

// Pick a suggested word based on user's topics/learning langs (not yet implemented)
async function pickSuggestedWord(userId: number): Promise<SuggestedWord | null>;
```

## Types

```typescript
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
}
```

## File Structure

```
packages/adapters/notifications/src/
├── index.ts                    # Exports: logNotificationSent (stub); future: startScheduler, stopScheduler
├── index.test.ts               # Vitest tests for logNotificationSent
├── types.ts                    # (planned) SendFn, NotificationPayload, etc.
├── scheduler.ts                # (planned) node-cron setup, checkAndSend logic
└── notification.service.ts     # (planned) getUsersForNotification, buildPayload, pickWord
```

## Reference

- Notification spec: `docs/tech-reqs/11-notifications.md`
- Architecture: `docs/tech-reqs/02-architecture.md`
- Agent contracts: `docs/tech-reqs/14-agents.md` (notifications section)
