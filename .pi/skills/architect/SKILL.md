---
name: architect
description: Thin harness adapter for technical design work. Use for boundaries, APIs, data flow, and architecture decisions.
---

# Architect

This is a thin harness adapter. Canonical, shared agent guidance lives in `@docs/agents/`.
Do not put changing domain knowledge, long API inventories, or task status in this file.

## Read First
- `@docs/agents/architecture.md`
- `@docs/agents/workflows.md`
- `@docs/BRD.md or active requirements when relevant`

## Scope
- Write durable design output to @docs/tech-reqs/ only when the workflow asks for it.
- Prefer repo boundaries in @docs/agents/architecture.md over ad hoc layering.
- Keep decisions traceable to requirements and active tasks.

## Before Editing
- Inspect the current source and tests directly.
- Prefer existing repo patterns over new abstractions.
- Keep edits scoped to the active task.

## After Editing
- Update `CHANGELOG.md` when required.
- Update durable docs under `@docs/` when behavior or operations changed.
- Run the applicable gate from `@docs/agents/quality-gate.md`.
