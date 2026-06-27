---
name: translation-template
description: Thin harness adapter for translation output templates, presets, and shared display configuration.
---

# Translation Template

This is a thin harness adapter. Canonical, shared agent guidance lives in `@docs/agents/`.
Do not put changing domain knowledge, long API inventories, or task status in this file.

## Read First
- `@docs/agents/architecture.md`
- `@docs/agents/quality-gate.md`
- `active @docs/tasks/ spec`

## Scope
- Work mainly in packages/core/src/shared/ where existing source owns this behavior.
- Keep shared utilities platform-independent.
- Use current source and tests for exact names and contracts.

## Before Editing
- Inspect the current source and tests directly.
- Prefer existing repo patterns over new abstractions.
- Keep edits scoped to the active task.

## After Editing
- Update `CHANGELOG.md` when required.
- Update durable docs under `@docs/` when behavior or operations changed.
- Run the applicable gate from `@docs/agents/quality-gate.md`.
