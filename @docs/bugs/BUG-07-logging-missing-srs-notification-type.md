# BUG-07: Task 05 Logging Stub Only Supports `'suggested'` Notification Type — BRD Requires `'srs'` Too

**Severity:** 🟡 Minor  
**Source Task:** Task 05 (`docs/tasks/05-logging.md`)  
**BRD Reference:** §2.5 (Post-MVP) Notifications  
**Status:** ✅ Resolved

---

## Problem

Task 05 created a `logNotificationSent()` stub in `packages/adapters/notifications/src/index.ts` with a narrow type:

```typescript
export function logNotificationSent(params: {
  userId: number;
  type: 'suggested';  // ← only one type
  wordId: number;
}): void {
  logger.info(params, 'Notification sent');
}
```

The BRD §2.5 defines **two** notification types:

| Type | Description |
|---|---|
| Word from dictionary **(SRS)** | A word due for review according to SRS schedule |
| **AI-suggested word** | A new word selected by AI based on user's saved topics |

Both types generate notifications. The log contract must accommodate both. As currently written, the `type` field union is `'suggested'` only — the `'srs'` type is missing.

This means:
1. When the SRS notification feature is implemented, it cannot call `logNotificationSent()` without a type error
2. Existing log filtering/alerting on `type: 'srs'` events will never fire correctly
3. The logging contract established in Task 05 does not match the BRD's notification model

---

## Root Cause

Task 05 was created when notifications were fully in stub/placeholder state. The author included only `'suggested'` because that was the only notification type that had even informal implementation notes at the time. The `'srs'` type was overlooked.

---

## Files Affected

- `packages/adapters/notifications/src/index.ts` — `logNotificationSent()` function signature
- `packages/adapters/notifications/src/types.ts` (if it exists) — notification type definitions

---

## Acceptance Criteria

- [x] The `type` field in `logNotificationSent()` is expanded to a union: `'suggested' | 'srs'`
- [x] Updated function signature:
  ```typescript
  export function logNotificationSent(params: {
    userId: number;
    type: 'suggested' | 'srs';
    wordId: number;
  }): void
  ```
- [x] If a `NotificationType` type alias exists elsewhere, it is updated consistently
- [x] TypeScript compiles cleanly: `pnpm -r run build`
- [x] All existing tests pass: `pnpm test`

---

## Notes

- The BRD also mentions a fallback rule: "if SRS type is selected but no cards are due today → send AI-suggested word instead (with note)." This implies a notification can be of type `'srs'` but fallback to `'suggested'` content — the `type` field should log the **intended** type, not the fallback content type.
- Future notification types (e.g., streak reminders, re-engagement messages) can be added to the union as they are defined in the BRD.
