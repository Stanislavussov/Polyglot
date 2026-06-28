---
name: research
description: Thin harness adapter for stress-testing ideas, technology choices, and product hypotheses.
---

# Research

This is a thin harness adapter. Canonical, shared agent guidance lives in `@docs/agents/`.
Do not put changing domain knowledge, long API inventories, or task status in this file.

## Read First
- `@docs/agents/workflows.md`
- `@docs/agents/architecture.md`
- `active user request or task`

## Scope
- Present evidence, risks, alternatives, and a verdict.
- Distinguish facts from assumptions.
- Use current sources when information may have changed.

## Before Editing
- Inspect the current source and tests directly.
- Prefer existing repo patterns over new abstractions.
- Keep edits scoped to the active task.

## After Editing
- Update `CHANGELOG.md` when required.
- Update durable docs under `@docs/` when behavior or operations changed.
- Run the applicable gate from `@docs/agents/quality-gate.md`.
