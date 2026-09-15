# Testing Rules

## Workflow

1. Write a short behavior spec: interface, visible outcomes, constraints, non-goals, edge
   cases (and persistence/retries/idempotency when relevant). Vague request → draft the spec
   yourself and continue.
2. Red-green-refactor one scenario at a time: one failing test for the right reason →
   minimal code → clean up. Never all tests first or all code first.
3. No new test needed? Name the existing test or static check that covers the behavior.

## Lanes

- Unit (`*.test.ts`, `pnpm test`): pure logic with real branches.
- Integration (`*.integration.test.ts`, `pnpm test:integration`, real Postgres): workflows,
  repositories, module boundaries. Bot flows in `apps/bot/src/__tests__/integration/`,
  persistence-only in `packages/adapters/db/src/__tests__/`.
- **A cross-layer flow** (bot command/callback → service → persisted state, or scheduler →
  delivery) **requires an integration test** through the real dispatcher. A mock-only unit
  test does not count. `pnpm test` does not run this lane — run it before claiming done.

## What to Test

Test when behavior is user-visible or changes persisted state, modules collaborate, rules
branch (plan, language, role, time, limits), edge cases bite (empty, malformed, duplicates,
ordering, retries, timezones, partial failure), or a bug needs a regression test. Stop when
new tests only repeat a covered branch.

Don't test: assignments, types/constants existing, trivial getters, framework/library
behavior, private functions in isolation, "mock was called" without an outcome, coverage
for its own sake.

## Shape

- Names describe the protected guarantee:
  `keeps the saved card usable when a video phrase has no timestamp`, not `returns 400` or
  `calls saveEntry`. Business workflows get an adjacent `@business` comment.
- Arrange via public setup, act through the production interface, assert outcomes: return
  values, rendered replies, DB state via repositories, events, HTTP responses.
- Mock only true boundaries: external APIs, time, randomness, filesystem, env, and the DB
  when persistence is not the subject. Never mock internal modules for convenience.
- Reject tests coupled to private methods, call order or internal mocks; shared mutable
  fixtures; excessive snapshots.
