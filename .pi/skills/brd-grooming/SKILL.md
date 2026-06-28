---
name: brd-grooming
description: Thin harness adapter for checking tasks and requirements against the BRD.
---

# BRD Grooming

This is a thin harness adapter. Canonical, shared agent guidance lives in `@docs/agents/`.
Do not put changing domain knowledge, long API inventories, or task status in this file.

## Read First
- `@docs/agents/workflows.md`
- `@docs/BRD.md`
- `active @docs/tasks/ or @docs/requirements/ files`

## Scope
- Compare claims across @docs/BRD.md, @docs/requirements/, and active task specs.
- Report contradictions with concrete file references.
- Do not rewrite source code.

## Before Editing
- Inspect the current source and tests directly.
- Prefer existing repo patterns over new abstractions.
- Keep edits scoped to the active task.

## After Editing
- Update `CHANGELOG.md` when required.
- Update durable docs under `@docs/` when behavior or operations changed.
- Run the applicable gate from `@docs/agents/quality-gate.md`.
