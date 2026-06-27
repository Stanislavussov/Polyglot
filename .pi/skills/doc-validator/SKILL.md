---
name: doc-validator
description: Thin harness adapter for checking documentation against current source behavior.
---

# Doc Validator

This is a thin harness adapter. Canonical, shared agent guidance lives in `@docs/agents/`.
Do not put changing domain knowledge, long API inventories, or task status in this file.

## Read First
- `@docs/agents/workflows.md`
- `@docs/agents/skills.md`
- `active @docs/tasks/ spec`

## Scope
- Validate @docs/tasks/ and @docs/tech-reqs/ against source.
- Fix documentation drift only; do not implement features while acting as doc-validator.
- Keep skill files short and delegate stable rules to @docs/agents/.

## Before Editing
- Inspect the current source and tests directly.
- Prefer existing repo patterns over new abstractions.
- Keep edits scoped to the active task.

## After Editing
- Update `CHANGELOG.md` when required.
- Update durable docs under `@docs/` when behavior or operations changed.
- Run the applicable gate from `@docs/agents/quality-gate.md`.
