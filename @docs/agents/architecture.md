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

## Dependency Direction

`pnpm lint:deps` (dependency-cruiser) enforces import direction and forbids cycles.
Never weaken or disable a dependency-cruiser rule to make it pass — fix the code
(extract shared types, inject dependencies, break the cycle).
