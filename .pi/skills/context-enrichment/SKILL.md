---
name: context-enrichment
description: Thin harness adapter for pre-AI dictionary context lookup and enrichment work.
---

# Context Enrichment

This is a thin harness adapter. Canonical, shared agent guidance lives in `@docs/agents/`.
Do not put changing domain knowledge, long API inventories, or task status in this file.

## Read First
- `@docs/agents/architecture.md`
- `@docs/agents/quality-gate.md`
- `active @docs/tasks/ spec`

## Scope
- Work mainly in packages/core/src/modules/context-enrichment/.
- Keep the module platform-independent.
- Read current source for public APIs instead of using the skill as an inventory.

## Before Editing
- Inspect the current source and tests directly.
- Prefer existing repo patterns over new abstractions.
- Keep edits scoped to the active task.

## After Editing
- Update `CHANGELOG.md` when required.
- Update durable docs under `@docs/` when behavior or operations changed.
- Run the applicable gate from `@docs/agents/quality-gate.md`.
