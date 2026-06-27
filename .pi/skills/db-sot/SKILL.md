---
name: db-sot
description: Thin harness adapter for database-owned domain values and cache consumption policy.
---

# DB Source Of Truth

This is a thin harness adapter. Canonical, shared agent guidance lives in `@docs/agents/`.
Do not put changing domain knowledge, long API inventories, or task status in this file.

## Read First
- `@docs/agents/architecture.md`
- `@docs/agents/quality-gate.md`
- `packages/adapters/db/src/schema.ts`

## Scope
- Database schema and seed/cache layers own domain values.
- Do not hardcode languages, modes, or persisted domain enums in application code.
- Use Drizzle Kit for schema changes.

## Before Editing
- Inspect the current source and tests directly.
- Prefer existing repo patterns over new abstractions.
- Keep edits scoped to the active task.

## After Editing
- Update `CHANGELOG.md` when required.
- Update durable docs under `@docs/` when behavior or operations changed.
- Run the applicable gate from `@docs/agents/quality-gate.md`.
