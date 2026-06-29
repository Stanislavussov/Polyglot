# Task 68 — Multiple Daily Notifications

**Status:** 🔲 To Do
**Category:** Feature
**Created:** 2026-06-29

---

## Goal

Let a user receive **several** word notifications per day instead of exactly one. The single `notificationTime` is replaced by a configurable **list of times** (up to 12). The user picks times on the existing 30-min grid, now a multi-select. Notification type/context stay global (one per user); the on/off toggle and 14-day inactivity auto-pause are unchanged.

---

## Product Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Frequency model | Explicit **list of times** (not "N per day", not intervals) |
| 2 | Slot contents | **Time only** — `notificationType` / `notificationContext` stay global |
| 3 | Storage | Array column `notificationTimes text[]` on `userLanguageSettings` |
| 4 | Old field | **Replace** `notificationTime` fully (single source of truth); backfill `"08:00"` → `["08:00"]` |
| 5 | Limit | Soft cap **12/day**, configurable; enforced on the array length |
| 6 | Limit scope | Per `userLanguageSettings` row (one row per user today, so effectively per-user) |
| 7 | De-dup (srs) | Don't repeat a word sent in the **last 24h** (rolling window); soft repeat if dictionary smaller than the daily count |
| 8 | De-dup window basis | Rolling 24h on `notificationHistory.sentAt` (timezone-independent, no UTC/local-day edge cases) |
| 9 | AI types (suggested/contextual) | No special logic — same cap 12, per-slot AI generation as today |
| 10 | UI | Same 48-slot 30-min grid, now **multi-select toggle** (✅ on selected); 13th slot → "max 12" alert |
| 11 | Enable toggle | Stays **separate** from the list — pause without losing times |
| 12 | Empty list | "Not configured" — nothing sent even if `notificationEnabled = true` |

---

## Scheduler Behavior

- Cron unchanged (`*/30 * * * *`). On each tick, a user is eligible if `notificationEnabled` **and** `isActive` **and** not inactive **and** **any** time in `notificationTimes` falls in the current 30-min local window.
- 30-min grid granularity guarantees two slots can't collide in one window.
- De-dup: for `srs`, exclude words from `notificationHistory` with `sentAt >= now - 24h`.

---

## Implementation Outline

| Area | File | Change |
|------|------|--------|
| Schema | `packages/adapters/db/src/schema.ts` | Drop `notificationTime`, add `notificationTimes text[]` default `['08:00']` |
| Migration | drizzle-kit | Add column → Drizzle backfill (`[notificationTime]`) → drop column |
| Repository | `packages/adapters/db/src/repositories/notification.repository.ts` | `notificationUserSelect`, `getUsersForWindow` (any-slot match), `updatePrefs`, new `getSentWordsSince` |
| Port | `packages/core/src/ports/notification.repository.ts` | `notificationTimes: string[]`, `updatePrefs`, `getSentWordsSince` |
| Scheduler | `packages/adapters/notifications/src/scheduler.ts` | 24h de-dup, payload `hour` from send time, logging field |
| Bot UI | `apps/bot/src/scenes/helpers/settings.helper.ts` | Multi-select grid toggle with cap |
| Display | `apps/bot/src/scenes/settings.scene.ts` | Render list of times |
| Limit | `apps/bot/src/constants.ts`, `settings.port.ts`, `settings-adapter.ts`, admin route | `MAX_NOTIFICATION_TIMES = 12` + `notificationTimesLimit` config |
| i18n | `packages/core/src/modules/i18n/locales/{en,ru,cs}.json` + `types.ts` | Choose-times title, list display, add/remove toasts, max alert |

---

## Deployment note (data preservation)

Two migrations are generated: `0038_*` (add `notification_times`) and `0039_*` (drop `notification_time`). A column drop loses existing custom times unless the values are copied first. The backfill (`notification_times = [notification_time]`) is **data, not schema**, so it cannot live in a raw-SQL migration (CLAUDE.md rule 3) — it must run as a one-time Drizzle-query-builder step **between** 0038 and 0039.

- **Local/dev:** already applied — pushed 0038, ran the backfill (custom times preserved, verified), then pushed 0039.
- **Prod/staging:** apply 0038, run the same backfill step, then apply 0039. If 0038 and 0039 are applied back-to-back by CI with no backfill in between, existing users' custom times reset to the default `08:00`. If that ordering can't be guaranteed, ship 0038 + backfill now and defer 0039 to a later deploy.

## Non-goals

- Per-slot type/context.
- Full SRS "unified queue" / shuffle (separate task — see `memory/project_notification_algorithm.md`).
- Anti-repeat inside AI-type prompts.
- A global per-user cap across multiple language pairs (schema is one row per user today).
