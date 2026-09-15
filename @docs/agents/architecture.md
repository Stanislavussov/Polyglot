# Architecture Rules

## Layers

- `packages/core` — platform-independent domain logic. Never imports adapters or apps;
  dependencies are injected.
- `packages/adapters/*` — integrations with external systems. No product-workflow logic.
- `packages/infra` — config (`loadConfig()` + Zod), the shared pino logger, scripts. Leaf
  dependency, no business logic.
- `apps/*` — wiring, UI, commands, HTTP routes. Composes core services; no business logic.

`pnpm lint:deps` enforces direction and forbids cycles. Never weaken a dependency-cruiser
rule to pass — extract shared types, inject, or break the cycle.

**Domain values live in the database.** Languages, modes and persisted enums come from the
DB cache or a constant exported by `packages/adapters/db` (`MAX_LEARNING_LANGS`,
`DEFAULT_DICTIONARY_NAME`, `AUDIENCE_GROUPS`, …) — never a hardcoded list or TS union.

## Module Contracts

Behavioral invariants, not API surface — read source for signatures.

### AI adapter — `packages/adapters/ai`

- The only module that talks to the AI provider. No domain logic.
- Model and `maxRetries` are inputs, never hardcoded.
- Log every request: model, tokens, `cost_usd`, `duration_ms`.

### DB adapter — `packages/adapters/db`

- The only module that knows Drizzle/Postgres; everyone else goes through repositories.
- CRUD only, Drizzle only (no raw SQL), single `getDb()`, one repository per file.
- A new append-only log table joins `runTelemetryRetention` in the same change.
  `product_events` has its own horizon; `user_momentum` is never pruned.

### Notifications — `packages/adapters/notifications`

- Gets `sendFn` injected; never imports the bot. Log-and-continue on send errors; respect
  the user's timezone.
- **A scheduled notification is a subscription, not a nudge.** It always fires while
  enabled; never suppress it because the user is already active. `INACTIVITY_DAYS = 14` is
  a reachability ceiling, not targeting. Re-engaging users who never subscribed is a
  separate, unbuilt job. (Known tension: `processInactiveUsers` auto-pauses an opt-in
  after 14 days, sending `notifPaused` first.)
- **The `/settings` toggle is the only enable path.** Anything setting
  `notification_enabled = true` must also seed the admin default into an empty
  `notification_times` — an enabled user with an empty schedule never receives anything.
  `userRepository.updateNotificationPrefs` has no production callers and must not become a
  second enable path (knip won't warn: `exports` is off).
- **Word selection is layered and never repeats:** dictionary → curated preset (when the
  dictionary is empty or exhausted) → empty-dictionary prompt. A picker with nothing new
  returns `null`. Presets come from the reviewed demo-card cache, else translated
  just-in-time.

### Core — `packages/core`

- No AI-provider concerns in core; model selection and retry are explicit inputs.
- **Translation template** (`src/shared`): `DEFAULT_TEMPLATE` is the single source of field
  visibility; presets are immutable; derive `TranslationOutputConfig` only via
  `resolveOutputConfig`.
- **i18n**: text only through `t(key, lang)`; a missing key falls back to `en`, never throws.
- **Validation**: pure functions, one `validate*` per rule returning a failure reason.
- **Translation**: single entry `translate()`; does not persist, knows nothing about the
  user, always validates before returning; language names via `getLangName()`.
- **Topics**: cache-first, batch translation calls.

### Bot — `apps/bot`

- No business logic, no direct DB access. All user-facing text through i18n. One scene per
  file.
- The active mode owns every user turn: typed text and transcribed voice both go through
  `dispatchByActiveMode`. A new input channel reuses it (a reply to a mentor answer is the
  one override).
- **A card front hands over nothing.** Fronts render only through `renderCardFront` — the
  word plus the user's `CardFrontFields`. Meaning, explanation and translation belong to the
  back. `DEFAULT_CARD_FRONT_FIELDS` applies when there is no `user_card_templates` row.
- Never read `ctx.user.settings` — use `getSettings(userId)`.

### Onboarding — `apps/bot/src/onboarding`

- **Stateless.** No grammY conversation, session field or in-memory step state; every screen
  is re-derived from `users.onboarding_step` + language tables. Held state reintroduces the
  wait-timeout, swallowed-message and replayed-session failures.
- Persist each choice the moment it is made. A learning language is written only together
  with its CEFR level.
- Callback data uses the `onb:` prefix as one handler group; anything an onboarded user can
  tap uses a different prefix.
- Generating demo cards never publishes — only the explicit `setActive` review does;
  unreviewed rows are invisible to reads. The demo tap never calls an AI adapter; a cache
  miss falls back to the production translate flow.
