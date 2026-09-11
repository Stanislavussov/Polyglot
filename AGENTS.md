# Polyglot — AI Assistant Instructions

Harness entrypoint. The hard rules below bind every change; the stable detail lives in
`@docs/agents/` — read the file a rule points at before working in its area.
`CLAUDE.md` and `AGENTS.md` are kept byte-identical: edit both.

## Hard Rules (never violate)

### 1. Quality Gate After Every Change

After any source change, update `CHANGELOG.md` (under `## [Unreleased]`) and run:

```bash
pnpm build && pnpm lint && pnpm lint:deps && pnpm lint:knip && pnpm test && pnpm db:push
```

Fix every failure before moving on — a deferred fix is an unfinished change. `pnpm db:push`
stays last. Markdown-only changes skip the gate; verify the rendering instead.

Changelog scope and the database notes: `@docs/agents/quality-gate.md`.

### 2. No `any` Types

Never `any`, `// @ts-ignore`, or `// @ts-expect-error`. Fix the underlying type.

### 3. Database via Drizzle Kit

Edit `packages/adapters/db/src/schema.ts`, then `pnpm db:generate` to capture the migration
and `pnpm db:push` to apply the schema to the local/dev database. `pnpm db:check` validates
the migration journal — it detects no drift.

- **Never run `pnpm db:migrate` on `develop`, even with user approval**, and never run it
  locally as an agent on any branch. Migrations are applied by CI/deploy only: merging to
  `master` migrates production, pushing `develop` migrates the dev DB.
- Generated migrations are read-only: no hand edits, no raw SQL.
- `db:push` syncs schema only. Seed rows reach a dev DB through the CI-applied migration or
  an idempotent Drizzle upsert.
- Hand-writing a data-seed migration: take the column list from the **current** schema file,
  never by copying an `INSERT` from an older one — that re-introduces a dropped column and
  fails with `42703`, which then re-fails on every later deploy (`@docs/agents/deployment.md`).

### 4. No Logic in Index Files

Index files hold re-exports only. Import from the source module instead of growing a barrel.
Framework-required entry points are the exception.

### 5. Spec-First Testing

Write the behavior spec first — interface, expected outcomes, constraints, edge cases,
non-goals — derive tests from it, then implement in red-green-refactor slices. Use the
`testing-strategy-tdd` skill whenever tests are planned, written, reviewed, or changed;
canonical guidance in `@docs/agents/testing-strategy-tdd.md`. When a change needs no new
test, name the existing test or static check that already covers the behavior.

**E2E coverage is mandatory for cross-cutting flows.** A flow that crosses layers (bot
command/callback/conversation → service → persisted state, or scheduler → delivery) is not
done without an `*.integration.test.ts` driving it through the real dispatcher against real
Postgres — read the `bot-testing` skill (`.claude/skills/bot-testing/SKILL.md`) first, then
run `pnpm test:integration`, since the standard gate runs the unit lane only. Skip only by
naming the integration test that already covers the flow.

### 6. Deployment & Host Provisioning

Two separate pipelines, never conflated: app deploy (`.github/workflows/deploy.yml`, on push,
containers only) and host provisioning (`deploy/ansible/site.yml` via `pnpm ansible` — UFW,
Docker, nginx, certbot TLS). Details: `@docs/agents/deployment.md`.

- Run `pnpm ansible` against production only on an explicit, separate user request for that
  exact action — same posture as `db:migrate`. Confirm DNS points at the VPS first; certbot
  burns Let's Encrypt quota on failure.
- Changed `deploy/ansible/**` or nginx routing? The change is dormant until re-applied. Added
  an infra var to `.env.prod` that Ansible or the deploy workflow consumes? Push it with
  `gh secret set` or CI runs stale. Surface either even when you cannot execute it.

### 7. Comments Carry the Why, Not the What

Comment where the code cannot state its own reason: a workaround for an external quirk
(Telegram/API/driver), a non-obvious invariant or ordering constraint, a deliberate trade-off,
a gotcha that already caused an incident. Name the cause so the comment stays checkable.

Names, types, and tests carry the rest. A handler whose signature states its contract needs no
JSDoc; a block that seems to want a *what* comment wants extraction into a named function.
Delete restatements and section banners on sight when editing nearby code. One `//` line beats
a block.

## Guidance Map

`@docs/` is the canonical documentation directory — never a top-level `docs/`.
`@docs/agents/` is the harness-neutral source of truth; read the relevant file before editing:

- `architecture.md` — layout, boundaries, and the Module Contracts (per-module invariants).
- `quality-gate.md` — the full gate, changelog scope, database notes.
- `workflows.md` — planning, implementation, review, documentation flows.
- `testing-strategy-tdd.md` — spec-first TDD and test selection.
- `observability.md` — trace context, event catalogue, adding a log line.
- `deployment.md` — both pipelines in depth.
- `skills.md` — role index for domain-specific work.
