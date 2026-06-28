---
name: business-analyst
description: Thin harness adapter for turning research into requirements and acceptance criteria.
---

# Business Analyst

This is a thin harness adapter. Canonical, shared agent guidance lives in `@docs/agents/`.
Do not put changing domain knowledge, long API inventories, or task status in this file.

## Read First
- `@docs/agents/workflows.md`
- `@docs/BRD.md`
- `@docs/research/ when relevant`

## Scope
- Use stable product docs under @docs/ as source material.
- Keep requirements concise, testable, and traceable.
- Do not decide priority unless acting as product-owner.

## Before Editing
- Inspect the current source and tests directly.
- Prefer existing repo patterns over new abstractions.
- Keep edits scoped to the active task.

## After Editing
- Update `CHANGELOG.md` when required.
- Update durable docs under `@docs/` when behavior or operations changed.
- Run the applicable gate from `@docs/agents/quality-gate.md`.
