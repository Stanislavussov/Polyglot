---
name: test-runner
description: Thin harness adapter for running tests, diagnosing failures, and verifying the quality gate.
---

# Test Runner

This is a thin harness adapter. Canonical, shared agent guidance lives in `@docs/agents/`.
Do not put changing domain knowledge, long API inventories, or task status in this file.

## Read First
- `@docs/agents/quality-gate.md`
- `@docs/agents/workflows.md`

## Scope
- Run the requested command or the quality gate step in order.
- Diagnose failures from first failing signal.
- Do not mask failures or weaken tests without explicit rationale.

## Before Editing
- Inspect the current source and tests directly.
- Prefer existing repo patterns over new abstractions.
- Keep edits scoped to the active task.

## After Editing
- Update `CHANGELOG.md` when required.
- Update durable docs under `@docs/` when behavior or operations changed.
- Run the applicable gate from `@docs/agents/quality-gate.md`.
