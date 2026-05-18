# Task 59 — End-to-End Bot Tests with Telegram API Emulator

**Status:** 🔲 To Do  
**Category:** Testing — High  
**Blocks:** Confident refactoring, regression prevention, CI/CD readiness

---

## Goal

Add end-to-end tests for the Telegram bot that exercise real bot handlers without calling Telegram servers. Uses a **local HTTP mock server** that emulates the Telegram Bot API — the bot is pointed at this emulator via `apiRoot`, receives mock updates directly, and the test asserts on outgoing HTTP requests captured by the mock.

**Why this approach:**
- Tests the full request-response cycle (update in → handler logic → API call out)
- No real Telegram tokens or network calls needed
- Fast and deterministic — runs entirely in-process
- Covers command handlers, scene flows, and middleware chains

---

## Required Behavior

1. Lightweight HTTP mock server that captures and records all outgoing bot API calls
2. Bot factory accepts `apiRoot` parameter for test injection
3. Direct update injection via `bot.handleUpdate()`
4. Assertions on captured request method, payload, and chat context

## Acceptance Criteria

### Mock Server Infrastructure
- [ ] Create `tests/e2e/telegram-emulator.ts` — HTTP server that:
  - Listens on a configurable port
  - Records every incoming request (method name, payload)
  - Returns `ok: true` responses for all Telegram methods
  - Provides helper to query captured requests by method name
  - Handles JSON body parsing safely

- [ ] Create `tests/e2e/bot-factory.ts` — helper that:
  - Creates a grammY `Bot` instance with `apiRoot` pointing at the emulator
  - Registers the same handlers/plugins as production (`apps/bot/src/index.ts`)
  - Returns `{ bot, emulator }` tuple for tests
  - Properly cleans up resources after tests

### Core E2E Test Scenarios
- [ ] **`/start` command** — verify bot replies with welcome message in user's language
  - Mock update with `bot_command` entity
  - Assert `sendMessage` called with correct `chat_id` and `text`
  
- [ ] **Translation flow** — full user journey from text input to translation card
  - Send text message (not a command)
  - Assert translation is triggered (AI adapter is called, or mocked)
  - Assert bot sends formatted translation card
  
- [ ] **Settings flow** — user navigates settings menu and changes language
  - Send `/settings` command
  - Assert settings menu is displayed
  - Click language option (callback query)
  - Assert language is updated and confirmation sent
  
- [ ] **Dictionary save** — user saves a translation to dictionary
  - After translation, click "Save" button (callback query)
  - Assert `saveWord` is triggered and confirmation message sent
  
- [ ] **Error handling** — bot handles errors gracefully
  - Trigger an error in a handler (e.g., invalid state)
  - Assert error is caught, user receives friendly error message
  - Assert no unhandled exceptions crash the bot

### Test Data & Helpers
- [ ] Create `tests/e2e/fixtures.ts` with mock update builders:
  - `createMessageUpdate({ text, chatId, userId, entities? })`
  - `createCallbackQueryUpdate({ data, chatId, userId })`
  - `createCommandUpdate({ command, chatId, userId })`
  - Realistic mock user/chat objects matching Telegram API structure

- [ ] Test database strategy:
  - Either: mock `db` adapter entirely (no real DB)
  - Or: use SQLite in-memory / test PostgreSQL container
  - Decision recorded in task file

### Test Configuration
- [ ] Vitest config in `apps/bot/vitest.config.ts` (or root `vitest.workspace.ts`)
- [ ] E2E tests run separately from unit tests (`pnpm test:e2e` or tag-based filtering)
- [ ] Tests parallelizable — each test gets isolated emulator + bot instance
- [ ] No real API keys loaded during E2E tests

## Dependencies

- **None** — purely additive testing infrastructure
- **Benefits from:** Task 42 (Composition Root & DI) for easier bot factory construction
- **Blocks:** Confident refactoring of bot handlers, scene flows, and command logic

## Effort Estimate

6–8 hours
- Emulator infrastructure: 2h
- Bot factory + fixtures: 1.5h
- Core test scenarios: 3h
- CI/integration: 1h

## Files Likely Affected

**New files:**
- `apps/bot/tests/e2e/telegram-emulator.ts`
- `apps/bot/tests/e2e/bot-factory.ts`
- `apps/bot/tests/e2e/fixtures.ts`
- `apps/bot/tests/e2e/start-command.e2e.test.ts`
- `apps/bot/tests/e2e/translation-flow.e2e.test.ts`
- `apps/bot/tests/e2e/settings-flow.e2e.test.ts`
- `apps/bot/tests/e2e/dictionary-save.e2e.test.ts`
- `apps/bot/tests/e2e/error-handling.e2e.test.ts`

**Modified files:**
- `apps/bot/src/index.ts` — may need to export bot creation function or accept `apiRoot` parameter
- `apps/bot/package.json` — add `test:e2e` script
- `vitest.workspace.ts` (or root config) — add E2E test configuration

## Implementation Notes

### Emulator Pattern (from reference)

```typescript
// Mock server captures outgoing calls
const mockServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    receivedRequests.push({
      method: url.pathname.split('/').pop(),
      payload: body ? JSON.parse(body) : {}
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, result: true }));
  });
});

// Bot points at emulator
const bot = createBot(MOCK_TOKEN, `http://localhost:${PORT}`);

// Inject update directly
await bot.handleUpdate(mockUpdate);

// Assert outgoing API call
const sendMsgCall = receivedRequests.find(r => r.method === 'sendMessage');
expect(sendMsgCall.payload.chat_id).toBe(999);
expect(sendMsgCall.payload.text).toBe('Привет! Чем могу помочь?');
```

### Key Considerations

1. **grammY v1.x+** supports `client.apiRoot` in `Bot` constructor options — use this for redirection
2. **Session middleware** — if using sessions, ensure test setup provides session storage or mocks it
3. **AI adapter mocking** — E2E tests should NOT call real OpenRouter; mock `ai.generateObject()` / `ai.generateText()` at adapter level
4. **Database** — prefer mocking `db` adapter over using real DB for speed and isolation
5. **Callback queries** — mock `callback_query` updates with `data` field for inline keyboard interactions
6. **File uploads** — skip or mock file-related flows (photos, documents) in initial E2E suite

## Verification

Run `pnpm test:e2e` (or equivalent) and confirm:
- All E2E tests pass
- No real network calls to Telegram or OpenRouter
- Tests complete in < 30 seconds
- Coverage report includes bot handler files

## References

- grammY docs: `https://grammy.dev/guide/testing`
- Example pattern: `@docs/tasks/59-e2e-bot-tests.md` (this file)
