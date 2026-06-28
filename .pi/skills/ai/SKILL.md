---
name: ai
description: Thin harness adapter for AI provider work. Use for model request plumbing, response parsing, provider config, and AI adapter tests.
---

# AI Adapter

This is a thin harness adapter. Canonical, shared agent guidance lives in `@docs/agents/`.
Do not put changing domain knowledge, long API inventories, or task status in this file.

## Read First
- `@docs/agents/architecture.md`
- `@docs/agents/quality-gate.md`
- `active @docs/tasks/ spec`

## Scope
- Work mainly in packages/adapters/ai/src/.
- Keep provider concerns out of core modules.
- Model selection and retry behavior must be explicit inputs or config, not hidden domain logic.

## Before Editing
- Inspect the current source and tests directly.
- Prefer existing repo patterns over new abstractions.
- Keep edits scoped to the active task.

## After Editing
- Update `CHANGELOG.md` when required.
- Update durable docs under `@docs/` when behavior or operations changed.
- Run the applicable gate from `@docs/agents/quality-gate.md`.
