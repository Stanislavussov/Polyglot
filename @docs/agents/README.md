# Agent Instructions

This directory is the harness-neutral source of truth for AI agents working on Polyglot.

Use these files before reading harness-specific adapters such as `.pi/skills/*/SKILL.md`,
`AGENTS.md`, or `CLAUDE.md`.

## Canonical Sources

- `@docs/agents/quality-gate.md` - required checks after changes.
- `@docs/agents/architecture.md` - repository boundaries and stable engineering rules.
- `@docs/agents/workflows.md` - planning, implementation, review, and documentation flows.
- `@docs/agents/skills.md` - compact role index for domain-specific work.

## What Belongs Here

- Stable agent operating rules.
- Stable module ownership and dependency boundaries.
- Stable workflow conventions shared by all harnesses.

## What Does Not Belong Here

- Current task details. Use `@docs/tasks/`.
- Product requirements and roadmap details. Use `@docs/BRD.md`, `@docs/requirements/`,
  `@docs/roadmap.md`, and `@docs/mvp-scope.md`.
- Long implementation inventories, public API lists, or file maps that drift with code.
  Inspect source directly.
- Provider-specific harness syntax. Keep that in the harness adapter.

## Loading Order

1. Read `AGENTS.md` or the harness entrypoint.
2. Read this directory's relevant files.
3. Read the active task or requirements under `@docs/`.
4. Inspect source code directly before editing.
