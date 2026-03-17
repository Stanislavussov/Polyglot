# Task 11: Input Message Limits & Validation Config

**Status:** 🔲 To Do

## Description

Currently the bot accepts any text message as a translation input with no validation or limits. There is no maximum length check, no minimum content requirement, no daily request cap, and no rejection of nonsensical input (pure whitespace, only digits, overly long pastes). This creates three problems:

1. **Cost exposure** — a single user can fire unlimited AI requests, with no per-user daily cap.
2. **Bad AI output** — garbage input (emoji-only strings, 2000-character pastes) yields garbage translations and wastes tokens.
3. **Fragile error UX** — the AI adapter receives invalid input silently; errors surface only after an expensive network round-trip.

Implement a **configurable input validation layer** that enforces limits and content rules on every incoming translation request **before** any AI call is made. All thresholds are driven by environment variables so they can be tuned without a code change.

**References:**

- `tech-reqs/13-env.md` (env variable conventions)
- BRD §10 — "Rate Limiting & Cost Control: Maximum N translation requests per user per day (N = TBD)"
- BRD open question #6 — "Rate limit N — max translation requests per user per day"
- Task 03 (bot setup — middleware pipeline)
- Task 05 (logging — all rejections should be logged)

---

## Root Cause

The translate scene in `apps/bot/src/scenes/translate.scene.ts` calls `translate(...)` immediately after receiving the user's text with no pre-flight validation:

```ts
const word = wordCtx.message.text;
// ← nothing here — goes straight to AI
output = await conversation.external(async () => translate(...));
```

The infra config in `packages/infra/src/config.ts` has no input-related fields; the env schema only covers `BOT_TOKEN`, `DATABASE_URL`, `AI_MODEL`, etc.

---

## Subtasks

### Step 1: Add input-limit config fields to infra

- [ ] In `packages/infra/src/config.ts`, extend `envSchema` with:
  ```ts
  INPUT_MIN_LENGTH:  z.coerce.number().int().min(1).default(1),
  INPUT_MAX_LENGTH:  z.coerce.number().int().min(10).default(200),
  DAILY_TRANSLATE_LIMIT: z.coerce.number().int().min(1).default(20),
  ```
- [ ] Export updated `Env` type — all downstream consumers are automatically aware

### Step 2: Add a daily-request counter to the DB schema

- [ ] In `packages/adapter-db`, add a `translation_requests` table (or a counter column on the `users` table):
  ```
  user_id      uuid references users(id)
  date         date  (UTC calendar date)
  count        integer not null default 0
  PRIMARY KEY (user_id, date)
  ```
- [ ] Add `translationRequestRepository` with two methods:
  - `getCount(userId, date): Promise<number>` — returns today's count for a user
  - `increment(userId, date): Promise<void>` — atomically increments (INSERT … ON CONFLICT DO UPDATE)
- [ ] Generate and push a migration

### Step 3: Create an `InputGuard` module in core

- [ ] Create `packages/core/src/modules/input-guard/`:
  - `types.ts` — `InputRule`, `InputGuardConfig`, `InputGuardResult`
  - `input.guard.ts` — pure, stateless validation (no DB access):
    ```ts
    export function validateInput(text: string, config: InputGuardConfig): InputGuardResult
    ```
    Rules applied in order:
    1. **Empty / whitespace-only** — reject if `text.trim().length === 0`
    2. **Too short** — reject if trimmed length < `config.minLength`
    3. **Too long** — reject if trimmed length > `config.maxLength`
    4. **Bot command** — reject if input starts with `/` (user typed a command into the word field)
    5. **Digits-only** — reject if input matches `/^\d+$/` (pure number, no translation value)
  - `index.ts` — re-export public surface
- [ ] `InputGuardResult` is a discriminated union:
  ```ts
  type InputGuardResult =
    | { ok: true }
    | { ok: false; reason: 'empty' | 'too_short' | 'too_long' | 'is_command' | 'digits_only' }
  ```

### Step 4: Add i18n keys for rejection messages

- [ ] In `packages/core/src/modules/i18n/locales/{en,ru,cs}.json`, add:
  ```json
  "inputTooShort":      "...",
  "inputTooLong":       "Input is too long (max {{max}} characters).",
  "inputIsCommand":     "Please enter a word or phrase, not a command.",
  "inputDigitsOnly":    "Please enter a word or phrase, not a number.",
  "dailyLimitReached":  "You've reached your daily translation limit ({{limit}}). Try again tomorrow!"
  ```
- [ ] Update `TranslationKey` union type in `packages/core/src/modules/i18n/types.ts`

### Step 5: Enforce rules inside the translate scene

- [ ] In `apps/bot/src/scenes/translate.scene.ts`, after `const word = wordCtx.message.text`:
  1. **Input validation** — call `validateInput(word, { minLength, maxLength })` from `@polyglot/core`; on failure reply with the matching i18n key and `return` (re-ask or exit scene — see architecture note below)
  2. **Daily rate limit** — inside `conversation.external(...)`, call `translationRequestRepository.getCount(userId, today)`; if `count >= DAILY_TRANSLATE_LIMIT` reply with `dailyLimitReached` and `return`
  3. On successful translation, call `translationRequestRepository.increment(userId, today)`
- [ ] Log every rejection with `logger.info({ userId, reason }, 'Input rejected')`

### Step 6: Write tests

- [ ] **Unit tests** for `validateInput` in `packages/core/src/modules/input-guard/__tests__/input.guard.test.ts`:
  - Empty string → `{ ok: false, reason: 'empty' }`
  - `"  "` (whitespace) → `{ ok: false, reason: 'empty' }`
  - `"x"` with minLength=2 → `{ ok: false, reason: 'too_short' }`
  - `"a".repeat(201)` with maxLength=200 → `{ ok: false, reason: 'too_long' }`
  - `"/start"` → `{ ok: false, reason: 'is_command' }`
  - `"12345"` → `{ ok: false, reason: 'digits_only' }`
  - `"hello"` with defaults → `{ ok: true }`
- [ ] **i18n tests** — all new keys resolve in en/ru/cs; `{{max}}` and `{{limit}}` params are substituted
- [ ] **Config tests** — `loadConfig()` returns correct defaults; coercion from string env values works
- [ ] All existing tests continue to pass

### Step 7: Update tech-reqs

- [ ] In `docs/tech-reqs/13-env.md`, document the three new env variables with defaults, description, and example values
- [ ] In `docs/tech-reqs/10-bot-commands.md` (or create `10-input-guard.md`), document the validation rules and rejection reasons

---

## Architecture Notes

### Validation flow

```
User sends text
      │
      ▼
validateInput()          ← pure, synchronous, no DB
      │ ok: false → reply error, re-ask for word (stay in scene)
      │ ok: true
      ▼
getCount(userId, today)  ← DB read inside conversation.external
      │ limit reached → reply error, exit scene
      │ under limit
      ▼
translate(...)           ← AI call
      │
      ▼
increment(userId, today) ← DB write (fire-and-forget is acceptable)
```

### Re-ask vs exit on bad input

When validation fails on a **content rule** (too short, digits-only, etc.), the scene **re-asks** for input with a corrective message — the user should not have to re-enter `/translate`. When the **daily limit** is reached, the scene exits (no point re-asking).

### Rate limit counter design

Using a `(user_id, date)` primary key with `INSERT … ON CONFLICT DO UPDATE SET count = count + 1` is atomic and requires no application-level locking. Using UTC calendar date keeps the reset predictable regardless of user timezone.

---

## Architecture Constraints

| Package                     | Change scope                                     | Notes                                                                 |
| --------------------------- | ------------------------------------------------ | --------------------------------------------------------------------- |
| `packages/infra/`           | `config.ts` — add 3 env fields                   | All packages importing `Env` type get the new fields automatically    |
| `packages/adapter-db/`      | New table + repository                           | Migration required; existing tables untouched                        |
| `packages/core/`            | New `input-guard` module + i18n keys             | Pure logic — no bot or DB imports                                     |
| `apps/bot/`                 | `translate.scene.ts` — add guard + limit checks  | No new files; scene grows ~20 lines                                   |
| `docs/tech-reqs/`           | Env doc update                                   | Document new variables                                                |

---

## Files to Create / Modify

- `packages/infra/src/config.ts` — add `INPUT_MIN_LENGTH`, `INPUT_MAX_LENGTH`, `DAILY_TRANSLATE_LIMIT`
- `packages/adapter-db/src/schema.ts` — add `translationRequests` table
- `packages/adapter-db/src/repositories/translationRequest.repository.ts` — `getCount`, `increment`
- `packages/adapter-db/src/index.ts` — export new repository
- `packages/adapter-db/drizzle/` — new migration file
- `packages/core/src/modules/input-guard/types.ts`
- `packages/core/src/modules/input-guard/input.guard.ts`
- `packages/core/src/modules/input-guard/index.ts`
- `packages/core/src/modules/input-guard/__tests__/input.guard.test.ts`
- `packages/core/src/modules/i18n/locales/en.json` — 5 new keys
- `packages/core/src/modules/i18n/locales/ru.json` — 5 new keys
- `packages/core/src/modules/i18n/locales/cs.json` — 5 new keys
- `packages/core/src/modules/i18n/types.ts` — extend `TranslationKey`
- `packages/core/src/index.ts` — re-export `input-guard`
- `apps/bot/src/scenes/translate.scene.ts` — add guard + daily-limit check
- `docs/tech-reqs/13-env.md` — document new env vars

---

## Key Risks & Mitigations

| Risk                                                        | Mitigation                                                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `DAILY_TRANSLATE_LIMIT=0` or missing → all requests blocked | Zod schema enforces `.min(1)` and `.default(20)` — misconfiguration caught at startup                        |
| Counter row race condition (two requests hit simultaneously) | `INSERT … ON CONFLICT DO UPDATE` is atomic at DB level                                                       |
| Counter not cleaned up → table grows indefinitely           | Old rows (date < today − 30 days) are cheap to prune; add a TODO for a nightly cleanup job (out of scope)   |
| Re-ask loop on bad input could confuse user                 | Each rejection message is specific and actionable; `is_command` and `digits_only` messages explain the issue |
| Adding DB read per translation slows response               | `getCount` is a PK lookup (indexed); negligible overhead vs AI call latency                                  |

---

## Acceptance Criteria

- [ ] Translating an empty or whitespace-only message shows an error and re-asks for input
- [ ] Input exceeding `INPUT_MAX_LENGTH` characters shows `inputTooLong` with the limit substituted
- [ ] Input below `INPUT_MIN_LENGTH` characters shows `inputTooShort`
- [ ] Typing `/start` into the word prompt shows `inputIsCommand`
- [ ] Typing `"12345"` into the word prompt shows `inputDigitsOnly`
- [ ] After `DAILY_TRANSLATE_LIMIT` successful translations in one UTC day, the next request shows `dailyLimitReached` with the limit substituted
- [ ] All three env variables have working defaults; missing values do not crash startup
- [ ] All unit tests for `validateInput` pass
- [ ] All existing tests (367+) pass without modification
- [ ] All packages build: `pnpm -r run build`
