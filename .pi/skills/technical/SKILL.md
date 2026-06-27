---
name: technical
description: Thin harness adapter for implementation across repo layers with quality gates.
---

# Technical Pipeline

This is a thin harness adapter. Canonical, shared agent guidance lives in `@docs/agents/`.
Do not put changing domain knowledge, long API inventories, or task status in this file.

## Read First
- `@docs/agents/README.md`
- `@docs/agents/architecture.md`
- `@docs/agents/quality-gate.md`
- `@docs/agents/skills.md`

## Scope
- Read active @docs/tasks/ specs before editing.
- Follow @docs/agents/architecture.md for boundaries.
- Run the applicable gate from @docs/agents/quality-gate.md.

## Before Editing
- Inspect the current source and tests directly.
- Prefer existing repo patterns over new abstractions.
- Keep edits scoped to the active task.

## After Editing
- Update `CHANGELOG.md` when required.
- Update durable docs under `@docs/` when behavior or operations changed.
- Run the applicable gate from `@docs/agents/quality-gate.md`.
