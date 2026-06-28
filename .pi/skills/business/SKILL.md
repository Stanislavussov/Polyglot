---
name: business
description: Thin harness adapter for orchestrating research, requirements, prioritization, design, and task creation.
---

# Business Pipeline

This is a thin harness adapter. Canonical, shared agent guidance lives in `@docs/agents/`.
Do not put changing domain knowledge, long API inventories, or task status in this file.

## Read First
- `@docs/agents/README.md`
- `@docs/agents/workflows.md`
- `@docs/agents/skills.md`

## Scope
- Use @docs/agents/workflows.md as the canonical pipeline description.
- Keep intermediate artifacts temporary unless the workflow publishes them.
- Publish final durable docs under @docs/ only.

## Before Editing
- Inspect the current source and tests directly.
- Prefer existing repo patterns over new abstractions.
- Keep edits scoped to the active task.

## After Editing
- Update `CHANGELOG.md` when required.
- Update durable docs under `@docs/` when behavior or operations changed.
- Run the applicable gate from `@docs/agents/quality-gate.md`.
