# Spec-First Testing Strategy

This is the canonical Polyglot testing workflow for agents. Harness-specific skill
files should point here instead of duplicating the full guidance.

## Default Workflow

For every source-code feature, bug fix, refactor, or behavior change:

1. Restate or write a concise behavior spec before production code.
2. Derive tests from that spec before implementation.
3. Prefer behavior and integration tests that cross meaningful module boundaries.
4. Implement in small red-green-refactor slices.
5. If no new test is needed, state why existing tests or static checks already cover
   the behavior.

## Behavior Spec

A useful spec names:

- Public interface or user workflow.
- Expected behavior and visible outcomes.
- Important constraints and non-goals.
- High-risk scenarios and edge cases.
- Persistence, external boundaries, retries, or idempotency when relevant.

If the user gives a vague request, produce a working spec yourself and continue unless
the uncertainty would make implementation risky.

## What Deserves Tests

Prioritize tests when at least one is true:

- Behavior is user-visible, API-visible, or changes persisted state.
- Multiple modules collaborate and integration can break.
- Business rules branch by role, plan, language, state, time, money, limits, or
  permissions.
- Edge cases include empty input, malformed input, duplicates, ordering, pagination,
  concurrency, retries, time zones, idempotency, or partial failure.
- A bug happened before and needs a regression test.
- Refactoring would be risky without a behavioral safety net.

Use unit tests for pure logic with meaningful branches. Use integration tests for
workflows, repositories, services, UI interactions, and module boundaries. Use e2e
tests sparingly for critical happy paths and deployment wiring confidence.

## What Usually Does Not Deserve Tests

Avoid tests that only verify:

- A variable was assigned.
- A TypeScript type, interface, or constant exists.
- A trivial getter/setter returns what it stores.
- A mock was called without proving a meaningful outcome.
- A private function works in isolation instead of public behavior.
- Framework behavior, library behavior, or generated boilerplate.
- Coverage numbers for their own sake.

Small code can still deserve tests when it encodes important domain behavior, has
tricky edge cases, or previously broke.

## Test Shape

Name tests as behavior specs:

- Good: `saves a phrase to the selected dictionary and renders the translated card`
- Bad: `calls saveEntry with correct params`

Test names and scenario descriptions must be useful as product coverage
documentation. A reader who does not know the implementation should understand what
workflow, rule, or user-visible guarantee is protected. Prefer names that describe
the value of the scenario:

- Good: `keeps the saved vocabulary card usable when a video phrase has no timestamp`
- Good: `rejects an invalid audience group without changing the user's current group`
- Bad: `returns 400`
- Bad: `calls updateAudienceGroup`
- Bad: `handles missing data`

When an existing test name is too weak, improve the test scenario itself: rename the
`it(...)` text and, for business-facing workflows, add an adjacent `@business`
comment that explains the scenario in domain language. Do not rely on generated
catalog wording to compensate for unclear source tests.

Arrange through public setup APIs, act through the same interface production uses, and
assert on outcomes: returned values, rendered UI, database-visible state through
repositories, emitted domain events, HTTP responses, or user-facing errors.

Mock only true boundaries: external APIs, database/network when persistence is not the
subject, time, randomness, filesystem, process environment, and expensive or
nondeterministic services. Do not mock internal modules just to make a unit test easy.

## Red-Green-Refactor

Per cycle:

- RED: add one meaningful test that fails for the expected reason.
- GREEN: implement only enough production code to pass.
- REFACTOR: improve names, remove duplication, simplify boundaries, keep tests green.
- Repeat with the next scenario.

Do not write all tests first. Do not write all implementation first. Keep each cycle
small enough that a failure points to one behavior.

## Scenario Checklist

Cover realistic happy paths plus high-risk edge cases: validation failure,
permissions, empty or missing data, duplicates, boundary values, external failure,
retries, idempotency, and persistence where relevant. Stop when additional tests would
repeat the same branch with different names.

## Review Checklist

Flag tests coupled to private methods, call order, internal mocks, harmless refactors,
or assertions that do not prove user or domain value. Also flag missing integration
coverage for multi-module behavior, missing edge cases for high-risk branches, shared
mutable fixtures, excessive snapshots, and coverage-driven tests.
