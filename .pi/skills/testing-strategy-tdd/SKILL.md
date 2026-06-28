---
name: testing-strategy-tdd
description: Thin harness adapter for Polyglot spec-first TDD and practical test strategy. Use for any feature, bug fix, refactor, or testing task that needs tests, specs, edge cases, test planning, test review, unit/integration/e2e choices, mocks, Vitest/Jest/Testing Library, or brittle-test cleanup.
---

# Testing Strategy TDD

This is a thin harness adapter. The canonical source of truth lives in
`@docs/agents/testing-strategy-tdd.md`.

## Read First

- `@docs/agents/testing-strategy-tdd.md`
- `@docs/agents/workflows.md`
- `@docs/agents/quality-gate.md`

## Scope

- Start source-code work from a concise behavior spec.
- Derive meaningful tests from the spec before implementation.
- Prefer integration and behavior tests across meaningful module boundaries.
- Name test scenarios as product/domain guarantees; weak names like `returns 400`,
  `calls repository`, or `handles missing data` must be rewritten into useful
  scenario descriptions, with `@business` comments for business-facing workflows.
- Avoid low-value tests that only verify variables, trivial getters, internal calls,
  private methods, framework behavior, or TypeScript-enforced types.
- Use red-green-refactor in small vertical slices.

## Before Editing

- Inspect the active task, source, and existing tests directly.
- Identify the public interface or user workflow.
- List the happy path and high-risk edge cases worth testing.

## After Editing

- Update `CHANGELOG.md` when required.
- Run the applicable gate from `@docs/agents/quality-gate.md`.
