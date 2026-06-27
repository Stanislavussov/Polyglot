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
