---
name: integrator
description: Thin harness adapter for cross-artifact consistency reviews.
---

# Integrator

This is a thin harness adapter. Canonical, shared agent guidance lives in `@docs/agents/`.
Do not put changing domain knowledge, long API inventories, or task status in this file.

## Read First
- `@docs/agents/workflows.md`
- `@docs/agents/architecture.md`
- `active planning artifacts`

## Scope
- Check naming, data flow, contracts, and missing integration points.
- Ground findings in @docs/ files and current source.
- Do not make unrelated implementation changes.

## Before Editing
- Inspect the current source and tests directly.
- Prefer existing repo patterns over new abstractions.
- Keep edits scoped to the active task.

## After Editing
- Update `CHANGELOG.md` when required.
- Update durable docs under `@docs/` when behavior or operations changed.
- Run the applicable gate from `@docs/agents/quality-gate.md`.
