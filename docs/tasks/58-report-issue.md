# Task X — Bug/Suggestion Reporter

**Status:** ⬜ To Do  
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
- [ ] New migration: `packages/adapters/db/drizzle/00XX_reported_issues.sql`
  - Columns: `id` (serial PK), `user_id` (FK → users.id, CASCADE), `type` (text: 'bug' | 'suggestion' | 'other'), `description` (text, NOT NULL), `status` (text: 'open' | 'in_progress' | 'resolved' | 'rejected', default 'open'), `created_at` (timestamp default now), `updated_at` (timestamp default now)
- [ ] `packages/adapters/db/src/schema.ts` — add `reportedIssues` table
- [ ] `packages/adapters/db/src/index.ts` — re-export `reportedIssueRepository`
- [ ] Unit tests for schema definition

**Dependencies:** None  
**Effort:** 30 min  
**Files:** `packages/adapters/db/drizzle/00XX_reported_issues.sql`, `packages/adapters/db/src/schema.ts`, `packages/adapters/db/src/index.ts`

---

### X.2 — DB repository: `reported-issue.repository.ts`

**Goal:** CRUD operations for reported issues.

**Acceptance Criteria:**
- [ ] New file `packages/adapters/db/src/repositories/reported-issue.repository.ts`
- [ ] `create(userId: number, type: IssueType, description: string): Promise<ReportedIssue>` — insert a new issue
- [ ] `findByUser(userId: number): Promise<ReportedIssue[]>` — all issues by user, ordered by createdAt DESC
- [ ] `findByStatus(status: IssueStatus): Promise<ReportedIssue[]>` — admin query, all users
- [ ] `updateStatus(issueId: number, status: IssueStatus): Promise<ReportedIssue | null>` — change status
- [ ] Types: `IssueType = 'bug' | 'suggestion' | 'other'`, `IssueStatus = 'open' | 'in_progress' | 'resolved' | 'rejected'`
- [ ] Unit tests for all methods

**Dependencies:** X.1  
**Effort:** 45 min  
**Files:** `packages/adapters/db/src/repositories/reported-issue.repository.ts`, `packages/adapters/db/src/__tests__/reported-issue.repository.test.ts`

---

### X.3 — Bot command: `/report` in command menu

**Goal:** Add a new command accessible from the bot's `/` menu.

**Acceptance Criteria:**
- [ ] Add `cmdDescReport` i18n key to all locale files (en, ru, cs)
- [ ] `getLocalizedCommands()` in `commands.ts` — add `/report` command with `cmdDescReport` description
- [ ] `setBotCommands()` — includes new command
- [ ] Unit tests for localized commands including report

**Dependencies:** X.2  
**Effort:** 30 min  
**Files:** `packages/core/src/modules/i18n/locales/{en,ru,cs}.json`, `apps/bot/src/commands/commands.ts`

---

### X.4 — Bot scene: Report issue flow

**Goal:** Multi-step conversation for submitting a bug/suggestion.

**Acceptance Criteria:**
- [ ] New file `apps/bot/src/scenes/report-issue.scene.ts`
- [ ] `/report` command → enter conversation
- [ ] Step 1: Show inline keyboard to pick type: [🐛 Bug] [💡 Suggestion] [📝 Other]
- [ ] Step 2: Ask for description (free text via `waitFor: "message:text"`)
- [ ] Step 3: Show preview + [✅ Send] [✏️ Edit] [❌ Cancel] buttons
- [ ] On Send: call `reportedIssueRepository.create()`, show confirmation with `reportSent` i18n key
- [ ] On Edit: loop back to step 2
- [ ] On Cancel: show `reportCancelled`, exit
- [ ] Auth middleware passes — only onboarded users can report
- [ ] Max description length: 1000 chars (validate, show error if exceeded)

**Dependencies:** X.2, X.3  
**Effort:** 1.5 hours  
**Files:** `apps/bot/src/scenes/report-issue.scene.ts`

---

### X.5 — Bot integration: register scene and callback

**Goal:** Wire the report scene into the bot.

**Acceptance Criteria:**
- [ ] `apps/bot/src/scenes/index.ts` — export `reportIssue` scene
- [ ] `apps/bot/src/index.ts` — register `reportIssue` in conversation plugin + route `/report` command
- [ ] Unit tests for command routing

**Dependencies:** X.4  
**Effort:** 30 min  
**Files:** `apps/bot/src/scenes/index.ts`, `apps/bot/src/index.ts`

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