# Task X — Bug/Suggestion Reporter

**Status:** ✅ Done  
**Type:** Feature (DB + bot)  
**Priority:** Low  
**Source:** User request

---

## Goal

Allow users to report bugs, submit suggestions, or request features via a new bot command. Reports are stored in a new `reported_issues` table for later review.

---

## Sub-tasks

### X.1 — DB schema: `reported_issues` table

**Goal:** Create a new table to store user-submitted issues and suggestions.

**Acceptance Criteria:**
- [x] New migration: `packages/adapters/db/drizzle/0016_reported_issues.sql`
  - Columns: `id` (serial PK), `user_id` (FK → users.id, CASCADE), `type` (text: 'bug' | 'suggestion' | 'other'), `description` (text, NOT NULL), `status` (text: 'open' | 'in_progress' | 'resolved' | 'rejected', default 'open'), `created_at` (timestamp default now), `updated_at` (timestamp default now)
- [x] `packages/adapters/db/src/schema.ts` — add `reportedIssues` table
- [x] `packages/adapters/db/src/index.ts` — re-export `reportedIssueRepository`
- [x] Unit tests for schema definition

**Dependencies:** None  
**Effort:** 30 min  
**Files:** `packages/adapters/db/drizzle/0016_reported_issues.sql`, `packages/adapters/db/src/schema.ts`, `packages/adapters/db/src/index.ts`

---

### X.2 — DB repository: `reported-issue.repository.ts`

**Goal:** CRUD operations for reported issues.

**Acceptance Criteria:**
- [x] New file `packages/adapters/db/src/repositories/reported-issue.repository.ts`
- [x] `create(userId: number, type: IssueType, description: string): Promise<ReportedIssue>` — insert a new issue
- [x] `findByUser(userId: number): Promise<ReportedIssue[]>` — all issues by user, ordered by createdAt DESC
- [x] `findByStatus(status: IssueStatus): Promise<ReportedIssue[]>` — admin query, all users
- [x] `updateStatus(issueId: number, status: IssueStatus): Promise<ReportedIssue | null>` — change status
- [x] Types: `IssueType = 'bug' | 'suggestion' | 'other'`, `IssueStatus = 'open' | 'in_progress' | 'resolved' | 'rejected'`
- [x] Unit tests for all methods

**Dependencies:** X.1  
**Effort:** 45 min  
**Files:** `packages/adapters/db/src/repositories/reported-issue.repository.ts`, `packages/adapters/db/src/__tests__/reported-issue.repository.test.ts`

---

### X.3 — Bot command: `/report` in command menu

**Goal:** Add a new command accessible from the bot's `/` menu.

**Acceptance Criteria:**
- [x] Add `cmdDescReport` i18n key to all locale files (en, ru, cs)
- [x] `getLocalizedCommands()` in `commands.ts` — add `/report` command with `cmdDescReport` description
- [x] `setBotCommands()` — includes new command
- [x] Unit tests for localized commands including report

**Dependencies:** X.2  
**Effort:** 30 min  
**Files:** `packages/core/src/modules/i18n/locales/{en,ru,cs}.json`, `apps/bot/src/commands/commands.ts`

---

### X.4 — Bot scene: Report issue flow

**Goal:** Multi-step conversation for submitting a bug/suggestion.

**Acceptance Criteria:**
- [x] New file `apps/bot/src/scenes/report-issue.scene.ts`
- [x] `/report` command → enter conversation
- [x] Step 1: Show inline keyboard to pick type: [🐛 Bug] [💡 Suggestion] [📝 Other]
- [x] Step 2: Ask for description (free text via `waitFor: "message:text"`)
- [x] Step 3: Show preview + [✅ Send] [✏️ Edit] [❌ Cancel] buttons
- [x] On Send: call `reportedIssueRepository.create()`, show confirmation with `reportSent` i18n key
- [x] On Edit: loop back to step 2
- [x] On Cancel: show `reportCancelled`, exit
- [x] Auth middleware passes — only onboarded users can report (command handler checks `ctx.user`)
- [x] Max description length: 1000 chars (validate, show error if exceeded)

**Dependencies:** X.2, X.3  
**Effort:** 1.5 hours  
**Files:** `apps/bot/src/scenes/report-issue.scene.ts`

---

### X.5 — Bot integration: register scene and callback

**Goal:** Wire the report scene into the bot.

**Acceptance Criteria:**
- [x] `apps/bot/src/index.ts` — register `reportIssue` in conversation plugin + route `/report` command
- [x] Unit tests for command routing

**Dependencies:** X.4  
**Effort:** 30 min  
**Files:** `apps/bot/src/index.ts`

**Note:** `apps/bot/src/scenes/index.ts` does not exist — scene exports are handled via direct imports in `index.ts`.

---

## Execution Order

```
X.1 → X.2 → X.3 → X.4 → X.5
```

---

## Out of Scope

- Admin panel to browse/resolve issues — future task
- Email/notification to admin when new issue submitted — future task
- Issue status visible to user — future task

---

## Total Effort Estimate

~3.5 hours across 5 sub-tasks

---

## Implementation Notes

- **Migration:** `0016_reported_issues.sql` — sequential after `0015_custom_notification_time.sql`
- **i18n keys added:** `cmdDescReport`, `reportTitle`, `reportChooseType`, `reportBug`, `reportSuggestion`, `reportOther`, `reportEnterDescription`, `reportPreview`, `reportSend`, `reportEdit`, `reportCancel`, `reportSent`, `reportCancelled`, `reportTooLong`
- **Types extended:** `I18nKey` in `packages/core/src/modules/i18n/types.ts`
- **Type augmentation:** `CustomContextProps.user` extended to include `settings?: UserLanguageSettings | null` for interface language access in conversations
- **Command handler pattern:** Uses `ctx.conversation.enter("reportIssue")` matching existing `/start` command pattern (not `ctx.conversation.with()`)
