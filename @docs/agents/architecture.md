# Architecture Rules

## Repository Layout

- `packages/core/` owns platform-independent domain logic.
- `packages/adapters/*/` owns integrations with external systems.
- `packages/infra/` owns shared configuration, logging, and cross-cutting utilities.
- `apps/*/` owns application wiring, UI, commands, scenes, HTTP routes, and composition.
- `@docs/` is the canonical documentation directory.

## Stable Boundaries

- Core modules must not import adapters or apps.
- Adapters must not contain product workflow logic.
- Apps compose ports, repositories, services, and UI flows.
- Index files contain re-exports only.
- Avoid expanding barrel files; import directly from source modules.
- Keep changes scoped to the active task.

## Database Source of Truth

Database schema and seed data own domain values such as languages, modes, and persisted
settings. Do not hardcode domain lists or TypeScript unions when they should come from
the database/cache layer.

Schema changes go through Drizzle Kit:

```bash
pnpm db:generate
pnpm db:push
pnpm db:check
```

Do not run `pnpm db:migrate` locally unless the user explicitly requests that exact
command.

## TypeScript Rules

- Do not use `any`.
- Do not use `// @ts-ignore` or `// @ts-expect-error`.
- Fix the underlying type or boundary issue.
- Prefer existing local patterns over new abstractions.

## Module Contracts

These are stable design invariants — how a module must *behave*, not its current API
surface. Inspect source for exact signatures; the module list below is representative,
not exhaustive, and new modules follow the same layering rules above. Each module owns
its layer: no cross-boundary changes.

### Shared infrastructure — `packages/infra`

- Cross-cutting only: config loading, logging, utility scripts. No business logic.
- Config through `loadConfig()` with Zod validation; logging through the shared pino instance.
- Leaf dependency: never import domain packages at runtime.

### AI adapter — `packages/adapters/ai`

- The only module that talks to the AI provider (OpenRouter / Vercel AI SDK).
- No domain logic — it sends requests and returns responses.
- Model is always an input/config value, never hardcoded; retry count (`maxRetries`) is configurable.
- Log every request: model, tokens, `cost_usd`, `duration_ms`.

### Database adapter — `packages/adapters/db`

- The only module that knows Drizzle / PostgreSQL; everything else reads through repositories.
- CRUD only, no product-workflow logic; all queries via Drizzle, never raw SQL.
- Single `getDb()`; one repository per file.
- Sole source of truth for persisted domain constants (e.g. `MAX_LEARNING_LANGS`,
  `DEFAULT_DICTIONARY_NAME`, `DEFAULT_NOTIFICATION_TYPE`, `AUDIENCE_GROUPS`). Never hardcode
  languages, modes, or persisted enums elsewhere — import the constant or read the cache.

### Notifications adapter — `packages/adapters/notifications`

- Receives a `sendFn` by injection; never imports the bot.
- Delivery scheduling is injectable; log-and-continue on send errors; respect the user's timezone.
- Timezone/language defaults come from DB constants, not hardcoded values.
- **A scheduled notification is content the user subscribed to, not a nudge.**
  The user opened the 48-slot grid and picked a time; suppressing that because
  they are already engaged is like skipping someone's alarm because they woke up
  yesterday. Scheduled notifications are an explicit opt-in subscription and
  always fire while enabled. `INACTIVITY_DAYS = 14` is a **reachability ceiling**
  (stop mailing the abandoned), not targeting. Re-engagement of people who never
  subscribed is a *different job with a different audience* and is currently
  unbuilt — no query can reach that audience, because every notification query
  leads with `notification_enabled = true`.
  - Standing tension, deliberately deferred: `processInactiveUsers` (the 14-day
    auto-pause) remains the one path that revokes an explicit opt-in without the
    user asking. It is not silent — it sends `notifPaused` first — but it sits
    against the rule that the user's explicit choice is data, not a hint.
- **The `/settings` toggle is the only path that enables notifications.** Anything
  that sets `notification_enabled = true` must also carry the "seed the admin
  default into an empty `notification_times`" rule;
  `userRepository.updateNotificationPrefs` currently has no production callers and
  must not silently become a second enable path. (knip cannot warn about this —
  `knip.json` sets `"exports": "off"`.) An enabled user with an empty schedule is
  permanently ineligible, which reproduces "the UI says on and nothing arrives"
  by a different route.
- **Word selection is layered and never repeats:** the user's dictionary → a
  curated preset when the dictionary is empty *or exhausted* → the
  empty-dictionary prompt. A picker that has nothing new returns `null` so the
  next layer runs; it must never re-send a word the user has already received.
- Preset words come from the curated hook list, served from the reviewed
  demo-card cache first and translated just-in-time otherwise, so the layer is
  never silently dead for an uncached language pair.

### Core modules — `packages/core/*` (general)

- Platform-independent: no adapter or app imports; dependencies are injected.
- Keep AI-provider concerns out of core; model selection/retry are explicit inputs, not hidden logic.
- Language/mode/domain values follow the DB source-of-truth policy above.

### Translation template — `packages/core/src/shared`

- Shared utilities only — no adapter imports, no side effects.
- `DEFAULT_TEMPLATE` is the single source of truth for default field visibility.
- Output presets are immutable constants — never mutate them.
- `resolveOutputConfig` is the only way to derive a `TranslationOutputConfig` from a user template.

### i18n — `packages/core/src/modules/i18n`

- Access text only through `t(key, lang)` — no direct locale-file imports from other modules.
- Missing key → fall back to `en`, never throw. Keys are a strict TypeScript enum.
- Language lists come from the DB cache, not hardcoded arrays or unions.

### Validation — `packages/core/src/modules/validation`

- Pure functions only — no side effects, no I/O, no AI calls.
- Each rule is a separate `validate*` function that returns a failure reason.
- Language validation goes through the DB language cache, not hardcoded ISO maps.

### Translation — `packages/core/src/modules/translation`

- Single entry point `translate()`; it does not persist results.
- Knows nothing about the user — text and languages only.
- Always validates before returning; language names in prompts come from the DB cache (`getLangName()`).

### Topics — `packages/core/src/modules/topics`

- Cache-first: check the cache before calling translation; batch translation calls.
- Language codes come from callers (DB settings), never hardcoded.

### Dictionary pipeline — `packages/core/src/modules/dictionary-pipeline`

- Pure core module — no adapter imports; all dependencies injected via `DictionaryPipelineDeps`.
- Preset configs are the single source of truth for word-selection strategies.
- `TemplateFields` controls field visibility, loaded from the user's saved template.

### Bot — `apps/bot`

- No business logic — it composes and calls core services; no direct DB access (go through repositories).
- All user-facing text through i18n; modes/languages from DB constants and the cache.
- One scene per file; keep scenes small and focused.

### Onboarding — `apps/bot/src/onboarding`

- **Stateless by contract (Task 72).** Never introduce a grammY conversation, a session field,
  or any other in-memory step state here. Every screen is re-derived from the database
  (`users.onboarding_step` + `user_language_settings` + `user_learning_languages`) on each
  update. This is what makes the flow immune to the wait-timeout, swallowed-message and
  replayed-`ctx.session` failure classes — reintroducing held state reintroduces all three.
- A choice is persisted the moment it is made, so any update can resume from it. A learning
  language is written to `learningLangs` **only** together with its CEFR level.
- All callback data lives under the `onb:` prefix, registered as a single handler group.
  Anything an already-onboarded user can tap (the D+1 nudge) must use a different prefix.
- Curated hook words are core data (`packages/core/src/modules/onboarding/hook-words.ts`);
  rendered cards are cache (`onboarding_demo_cards`). Generation never publishes — only the
  explicit `setActive` review step does, and unreviewed rows are invisible to every read path.
- The demo tap path must not call an AI adapter. A cache miss falls back to the production
  translate flow; it never grows a second pipeline.

## Dependency Direction

`pnpm lint:deps` (dependency-cruiser) enforces import direction and forbids cycles.
Never weaken or disable a dependency-cruiser rule to make it pass — fix the code
(extract shared types, inject dependencies, break the cycle).
