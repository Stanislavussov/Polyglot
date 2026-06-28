---
name: dev-standards
description: Thin harness adapter for quality gate, changelog, and documentation conventions.
---

# Development Standards

This is a thin harness adapter. Canonical, shared agent guidance lives in `@docs/agents/`.
Do not put changing domain knowledge, long API inventories, or task status in this file.

## Read First
- `@docs/agents/quality-gate.md`
- `@docs/agents/architecture.md`
- `@docs/agents/workflows.md`

## Scope
- Use @docs/agents/quality-gate.md as the canonical quality gate.
- Use @docs/agents/architecture.md for stable engineering rules.
- Keep this file short; do not duplicate the full gate here.

## Before Editing
- Inspect the current source and tests directly.
- Prefer existing repo patterns over new abstractions.
- Keep edits scoped to the active task.

## After Editing
- Update `CHANGELOG.md` when required.
- Update durable docs under `@docs/` when behavior or operations changed.
- Run the applicable gate from `@docs/agents/quality-gate.md`.
