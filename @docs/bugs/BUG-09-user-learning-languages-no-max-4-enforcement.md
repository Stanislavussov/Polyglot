# BUG-09: Task 14 Creates `userLearningLanguages` Junction Table With No Max-4 Language Enforcement

**Severity:** 🟡 Minor  
**Source Task:** Task 14 (`docs/tasks/14-language-table-refactor.md`)  
**BRD Reference:** §5 Onboarding ("Language limit: maximum 4 target languages"), §12 Non-Functional Requirements ("Max languages per user: 4")  
**Status:** ✅ Resolved

---

## Problem

Task 14 introduces a `userLearningLanguages` junction table to replace the `learningLangs text[]` column:

```typescript
export const userLearningLanguages = pgTable(
  "user_learning_languages",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    languageId: integer("language_id").references(() => languages.id).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [
    uniqueIndex("user_learning_lang_unique_idx").on(t.userId, t.languageId),
    index("user_learning_lang_user_idx").on(t.userId),
  ],
);
```

This schema has **no enforcement** of the BRD's 4-language limit. A user could INSERT an unlimited number of rows for their `userId`, resulting in more than 4 learning languages.

The BRD is explicit on this point:

> **§5 Onboarding:** "Language limit: maximum 4 target languages. This is a product decision to keep the card UI readable in Telegram. A user attempting to add a 5th language receives a message explaining the limit."

> **§12 Non-Functional Requirements:** "Max languages per user: 4 (product decision, not technical limit)"

The BRD notes it's "not a technical limit" — meaning the DB doesn't require a constraint — but it does require **application-level enforcement**. Task 14 defines neither.

---

## Root Cause

Task 14 focuses on the structural refactoring (text array → junction table with FK integrity) and does not carry over the max-4 enforcement that was implicit in the onboarding flow logic. The constraint was never added to the junction table definition or to the repository methods.

---

## Files Affected

- `packages/adapters/db/src/schema.ts` — `userLearningLanguages` junction table (no max constraint)
- `packages/adapters/db/src/repositories/user.repository.ts` — `addLearningLanguage()` or equivalent method (no count check)
- `apps/bot/src/scenes/onboarding.scene.ts` — onboarding multi-select (has UI cap, but no repository-level guard)
- `apps/bot/src/scenes/settings.scene.ts` — settings language management (if implemented — must also enforce)

---

## Acceptance Criteria

- [x] `userRepository.updateSettings()` checks `learningLangs` array length before saving — throws Error when > 4 (db agent)
- [x] The onboarding multi-select keyboard enforces a maximum of 4 selections in the UI (MAX_LEARNING_LANGS constant in bot)
- [ ] The settings scene (when implemented) shows an appropriate error message when a user tries to add a 5th language — referencing BRD §5: "A user attempting to add a 5th language receives a message explaining the limit"
- [x] A corresponding i18n key `maxLangsReached` is added with translations in EN, RU, CS
- [x] `MAX_LEARNING_LANGS` constant exported from db adapter (value: 4)
- [x] Unit tests for max-4 enforcement in db adapter (4 new tests, 18 total)
- [x] All existing tests pass: `pnpm test`

---

## Notes

- The BRD's phrasing ("not a technical limit") suggests the constraint should live in the application layer (repository), not as a DB CHECK constraint. A DB constraint is still acceptable as defense-in-depth.
- The 4-language limit applies only to **learning** languages. The native language is separate and has no limit (always 1).
- The onboarding multi-select UI in Task 03 already visually limits selections to 4 — this bug is about the **repository layer** having no enforcement, meaning the limit could be bypassed via direct API calls or future settings scenes.
