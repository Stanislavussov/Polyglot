---
name: task-creator
description: Thin harness adapter for turning plans into implementation task specs.
---

# Task Creator

This is a thin harness adapter. Canonical, shared agent guidance lives in `@docs/agents/`.
Do not put changing domain knowledge, long API inventories, or task status in this file.

## Read First
- `@docs/agents/workflows.md`
- `@docs/agents/architecture.md`
- `relevant requirements/design docs`

## Scope
- Create self-contained task specs under @docs/tasks/ when publishing.
- Keep tasks testable and independently implementable.
- Do not split into many files unless the workflow asks for it.

## Before Editing
- Inspect the current source and tests directly.
- Prefer existing repo patterns over new abstractions.
- Keep edits scoped to the active task.

## After Editing
- Update `CHANGELOG.md` when required.
- Update durable docs under `@docs/` when behavior or operations changed.
- Run the applicable gate from `@docs/agents/quality-gate.md`.
