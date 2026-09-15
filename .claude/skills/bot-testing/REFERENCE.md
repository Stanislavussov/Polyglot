# Bot testing — recipes

Companion to [SKILL.md](SKILL.md). Paths are relative to the repo root.

## Where things live

| Thing | Path |
|---|---|
| Harness + update factories | `apps/bot/src/test-helpers/integration/bot-harness.ts` |
| Unique id factory | `apps/bot/src/test-helpers/integration/id-factory.ts` |
| Shared arrange | `apps/bot/src/test-helpers/integration/arrange.ts` |
| Deterministic AI fixture | `apps/bot/src/test-helpers/integration/translate-ai-mock.ts` |
| Throttler stub (aliased in config) | `apps/bot/src/test-helpers/integration/throttler-stub.ts` |
| Universal lane setup | `test/integration/setup.ts` |
| Lane config | `vitest.integration.config.ts` |
| Unit-lane service stub | `apps/bot/src/test-helpers/services-stub.ts` |
| Repository-lane id factory | `packages/adapters/db/src/test-helpers/integration/id-factory.ts` |

## Running the lane

```bash
pnpm test                          # unit lane, mock-only, fast
pnpm test:integration              # provisions Postgres, then runs the lane
pnpm test:integration:run          # lane only; needs TEST_DATABASE_URL already set
pnpm test:integration:run -- --sequence.shuffle    # isolation check (rules 1–3)
pnpm test:integration:run -- apps/bot/src/__tests__/integration/onboarding.integration.test.ts
```

`TEST_DATABASE_URL` must point at a **migrated + seeded** throwaway database. The setup file refuses to fall back to `DATABASE_URL` on purpose — that fallback could aim tests at dev or prod.

## The assertion triad

Every Act is followed by all three. Never fewer.

```ts
// 1. Bot reply — what went out to Telegram.
const reply = harness.sent.filter((c) => c.method === "sendMessage").at(-1);
expect(String(reply?.payload.text)).toContain("Saved");

// 2. DB state — through the real repository.
const saved = await vocabularyRepository.findByOriginalAndSource(userId, "hello", en.id);
expect(saved?.original).toBe("hello");

// 3. Session / FSM state — the session key is the chat id, as a string.
const session = await botSessionRepository.get(String(id));
const data = session?.data as SessionData;
expect(data.activeMode).toBe("translate");
expect(data.translationMap?.[String(cardMsgId)]?.savedWordId).toBe(saved?.id);
```

Session-key gotchas:

- The key is `ctx.chat.id` (grammY default, see `bot-factory.ts`). A message and the callback on its button must share one `chatId` or they land in different sessions.
- A callback's `message.message_id` must equal the id the harness assigned to that card's `sendMessage` — take it from `lastRenderedCard(harness.sent)`, don't invent one.

## Reading captured calls

`harness.sent` is an ordered list of `{ method, payload, messageId? }`.

```ts
const methods = harness.sent.map((c) => c.method);            // routing/order
const alert = harness.sent.find((c) => c.method === "answerCallbackQuery");
expect(String(alert?.payload.text)).toContain("expired");
const { messageId, buttons } = lastRenderedCard(harness.sent); // card id + callback_data
```

A translation card arrives as `sendMessage` **plus a separate** `editMessageReplyMarkup` carrying the keyboard — that is why `lastRenderedCard` reads the edit call. Asserting buttons off the `sendMessage` payload finds nothing.

## Mocking the AI boundary

Inject through DI, never `vi.mock`:

```ts
const generateObject = vi.fn(deterministicTranslateAi().generateObject);
const harness = createBotHarness({ ai: { ...deterministicTranslateAi(), generateObject } });
// ... act ...
expect(generateObject).toHaveBeenCalled();                    // rule 8: verify, don't ignore
expect(String(generateObject.mock.calls[0]?.[0])).toContain("hello");
```

Anything not overridden throws `services.ai.<method> was called but no deterministic mock was provided`. That is the desired failure — it tells you the flow reached AI where you didn't expect it.

AI failure paths:

```ts
const harness = createBotHarness({
  ai: { generateObject: async () => { throw new Error("upstream 429"); } },
});
```

## Edge-case recipes

**Expired session / evicted card** — dispatch a callback whose `translationMap` entry never existed (fresh harness, invented card id); assert the `answerCallbackQuery` alert, and that no DB write happened.

**48h edit limit** — `harness.failNextEdit()` makes the next `editMessageText` return Telegram's `message to edit not found`; assert the flow falls back to a `sendMessage` reply instead of crashing.

**Out-of-set language / quota** — arrange the user's settings or counters in the Arrange block through the repositories, then assert the guard's reply text and that the pipeline was never entered (`expect(generateObject).not.toHaveBeenCalled()`).

**New Update shapes** — add a factory to `bot-harness.ts` next to `messageUpdate` / `callbackQueryUpdate`. Copy the entity/field details from what Telegram actually sends; the `bot_command` entity in `messageUpdate` exists because grammY's `bot.command()` matches the entity, not the text.

## Determinism

```ts
vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));  // ok in both lanes
afterEach(() => vi.useRealTimers());
```

Do **not** call `vi.useFakeTimers()` without `shouldAdvanceTime` in the integration lane — faking every timer stalls the Postgres driver's internal waits and the test hangs to the 30s timeout.

Do **not** stub global `Math.random` at module scope: `id-factory.ts` draws its per-process bucket at import time, and a seeded global would make ids collide across workers. Stub randomness inside the test that needs it, then restore.

## Unit lane

```ts
const services = createServicesStub({ /* only what this test exercises */ });
services.settings.getPlanLimit = vi.fn().mockResolvedValue(DEFAULT_PLAN_LIMIT);
```

`createServicesStub` returns an auto-mocked container: any accessed method is a memoized `vi.fn()` resolving to `undefined`. Do not hand-write `vi.mock("@polyglot/adapter-db")` factories — they couple the test to the adapter's whole export surface and its `dist` build, so one new export breaks every mock.

Bot unit tests import from `packages/core`'s build: after changing core or adapter-db, `pnpm build` before running them.

## Debugging a failing lane

| Symptom | Cause |
|---|---|
| `TEST_DATABASE_URL is not set` | run via `pnpm test:integration`, or export it yourself |
| Passes alone, fails under `--sequence.shuffle` | shared state or a hardcoded id (rules 1–3) |
| Test hangs to 30s | full fake timers, or a real (non-stubbed) throttler pacing messages |
| `no fixture matched the requested schema` | a pipeline schema changed — update the fixture in `translate-ai-mock.ts` |
| `no translation card was rendered` | no `editMessageReplyMarkup` captured; the flow bailed earlier — inspect `harness.sent.map(c => c.method)` |
| `services.ai.X was called but no deterministic mock` | the flow reached AI unexpectedly, or the override is missing that method |
| Command handler never fires | update built by hand without the `bot_command` entity (rule 13) |
