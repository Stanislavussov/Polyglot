---
name: bot-testing
description: Rules and recipes for writing Telegram bot tests in this repo — grammY e2e integration tests against a real Postgres, and mock-only unit tests. Covers DB isolation, unique telegram ids, the fake-fetch Telegram mock, dispatching updates through the real bot, the reply/DB/session assertion triad, determinism, and lane choice. Use when writing, reviewing, or debugging any test under apps/bot, any *.integration.test.ts, anything touching bot-harness.ts, or when a bot test is flaky, order-dependent, or hangs.
---

# Bot testing (Polyglot)

Two lanes. Pick before writing a line.

| | Unit lane | Integration lane |
|---|---|---|
| File | `*.test.ts` | `*.integration.test.ts` |
| Run | `pnpm test` | `pnpm test:integration` |
| DB | none (mocked) | real Postgres (`TEST_DATABASE_URL`) |
| Subject | one helper / pure function | a full user dialog through the real bot |
| Telegram | n/a | fake `fetch` in the harness |

A scenario ("user sends a word, taps SAVE, taps it again") belongs in the integration lane. A parser, a limit calculator, a mapper belongs in the unit lane with `createServicesStub()`.

`pnpm test:integration` needs no setup and no configuration — it uses `TEST_DATABASE_URL` if one is set (how CI passes its service container), otherwise provisions and destroys its own database: an ephemeral Neon branch when `NEON_API_KEY`/`NEON_PROJECT_ID` are available, else a private local Postgres cluster on a free port. Migrations and the bootstrap seed are applied every run. Several git worktrees can run it simultaneously.

## Quick start — integration test

```ts
import { describe, expect, it } from "vitest";
import { arrangeOnboardedTranslator } from "../../test-helpers/integration/arrange.js";
import { callbackQueryUpdate, createBotHarness, lastRenderedCard, messageUpdate }
  from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../test-helpers/integration/translate-ai-mock.js";

it("translates a word and persists vocab on save", async () => {
  // Arrange — harness + user are built INSIDE the test, never in beforeAll.
  const harness = createBotHarness({ ai: deterministicTranslateAi() });
  const id = uniqueTelegramId();                      // never a hardcoded id
  const userId = await arrangeOnboardedTranslator(id);

  // Act — through the real dispatcher, never by calling a handler directly.
  await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "hello" }));

  // Assert — reply, DB, session (see the triad below).
  const { messageId, buttons } = lastRenderedCard(harness.sent);
  expect(buttons).toContain(`tr:save:${messageId}`);

  // Cleanup between acts.
  harness.reset();
  await harness.dispatch(callbackQueryUpdate({ chatId: id, fromId: id, messageId, data: `tr:save:${messageId}` }));
});
```

## The rules

1. **Fresh DB, no shared rows.** The lane runs against a throwaway migrated Postgres. Within a run there is no truncation between tests — isolation comes from rule 3. Never read or mutate a row another test created; never assert on global counts.
2. **No shared mutable state across tests.** Build the harness and every mutable fixture inside the `it`. `beforeAll` is for nothing that a test can write to. Module-level `let harness` is a bug.
3. **Unique telegram id per test** via `uniqueTelegramId()`. It is also the `chatId` — and the session key. Hardcoding an id collides across parallel workers.
4. **No real HTTP.** Outbound Telegram calls are intercepted by the harness's fake `fetch`. Never install a real token, never bypass the harness with a bare `new Bot()`.
5. **Dispatch, don't call.** `harness.dispatch(update)` runs the real middleware stack (session, auth, conversations). Calling a handler export directly proves nothing about routing.
6. **Arrange → Act → Assert → Cleanup**, in that order, with those comments. `harness.reset()` between acts so the next assertion reads only the new calls.
7. **Assert the triad after every Act**: bot reply (`harness.sent`), DB state (repositories), session/FSM state (`botSessionRepository.get(String(chatId))`). Skipping one is how "green but broken" happens.
8. **Verify external calls, don't ignore them.** AI is injected through `services.ai` (DI, not `vi.mock`). Wrap fixtures in `vi.fn()` and assert they were called with what you expect. The default harness AI *throws* — an unexpected AI call fails loudly by design.
9. **A test is a dialog**, not a handler. Multi-step: message → card → button → follow-up.
10. **Per scenario: happy path + the edge cases that actually break** — expired session, evicted card, 48h edit limit, out-of-set language, quota exhausted, AI failure.
11. **Determinism.** Freeze the clock with `vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))`; do **not** use full `vi.useFakeTimers()` in the integration lane (it stalls the pg driver). Seed or stub randomness inside the test only.
12. **Order-independent and parallel.** Verify with `pnpm test:integration -- --sequence.shuffle` (extra arguments are forwarded to vitest). A failure under shuffle means rule 1, 2, or 3 was broken — fix the isolation, never add sleeps or `.sequential`.
13. **Updates only via the factories** — `messageUpdate()` / `callbackQueryUpdate()` in `bot-harness.ts`. Hand-written `Update` literals drift from what Telegram sends (a missing `bot_command` entity silently stops matching commands). Need a new shape? Add a factory there.
14. **`test/integration/setup.ts` holds only universal setup** (env mapping, language cache, pool close); shared arrange lives in `arrange.ts`. Everything scenario-specific stays in the test file.
15. **A real bot against real Telegram never runs in `pnpm test` or the integration lane.** No such suite exists today; if one is added it goes in a separate `test/e2e/**` config, CI-only, gated on a real-token env var.

## After changing tests

Run the full quality gate from `CLAUDE.md`, plus `pnpm test:integration` for integration tests.

Recipes for the assertion triad, mocking AI, edge cases, and debugging hangs: see [REFERENCE.md](REFERENCE.md).
