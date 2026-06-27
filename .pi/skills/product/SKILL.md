---
name: product
description: Thin harness adapter for competitor and market analysis.
---

# Product Research

This is a thin harness adapter. Canonical, shared agent guidance lives in `@docs/agents/`.
Do not put changing domain knowledge, long API inventories, or task status in this file.

## Read First
- `@docs/agents/workflows.md`
- `@docs/research/ when relevant`
- `active user request`

## Scope
- Do not store competitor lists in this skill file.
- Use current research and user-provided market scope.
- Publish durable research only when asked by the workflow.

## Before Editing
- Inspect the current source and tests directly.
- Prefer existing repo patterns over new abstractions.
- Keep edits scoped to the active task.

## After Editing
- Update `CHANGELOG.md` when required.
- Update durable docs under `@docs/` when behavior or operations changed.
- Run the applicable gate from `@docs/agents/quality-gate.md`.
