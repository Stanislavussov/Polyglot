---
name: dev-standards
description: Testing and documentation conventions for all technical agents. Covers mandatory quality gates (tsc, lint, deps, tests), SKILL.md updates, and task tracking. Read after implementing any feature.
---

# Development Standards

## ⚠️ Mandatory Quality Gate — Run After EVERY Iteration

**Every subagent MUST run the full quality gate after each round of code changes, no matter how small.**
No exceptions. Do not skip steps. Do not defer to "later". Fix issues before moving on.

Run these commands **in order** after every code change, including small features:

### 1. TypeScript type-check (build)

```bash
pnpm build
```

- Runs `tsc` across all packages/apps in dependency order
- **Fix all type errors before proceeding** — never use `any`, `// @ts-ignore`, or `// @ts-expect-error`
- If a type error is in another package, fix it there first

### 2. Linting & Formatting (Biome)

```bash
pnpm lint
```

- If there are errors, fix with `pnpm lint:fix`, then re-run `pnpm lint`
- If `lint:fix` can't auto-fix something, fix manually or add `// biome-ignore` with a reason

### 3. Dependency rules (dependency-cruiser)

```bash
pnpm lint:deps
```

- Enforces package boundary rules (no circular deps, correct layer imports)
- **Fix all violations** — do not add exceptions without explicit user approval

### 4. Tests

```bash
pnpm test
```

- All existing tests must still pass
- If you changed behavior, update affected tests
- If you added new code, add tests for it

### Summary checklist (copy-paste into your workflow)

```bash
pnpm build && pnpm lint && pnpm lint:deps && pnpm test
```

**If any command fails → fix → re-run the full chain.**
Do NOT proceed to documentation updates or mark tasks done until all four pass.

---

## Testing (conventions)

- Write Vitest tests next to source as `<module>.test.ts`
- Imports: `import { describe, it, expect, vi } from 'vitest'`
- Cover: happy path, edge cases, error handling
- Mock external dependencies — tests run without real DB/API
- Use `.js` extensions in all imports

## Database Handling (Drizzle Kit)

All database schema changes and migration generation **must be done through `drizzle-kit`**. Never modify migration files manually or interact with the database directly.

Agents must not run production-style migrations from a local run. Migration application via `pnpm db:migrate` belongs to the deployment pipeline unless the user makes an explicit, separate request for that exact command.

### Allowed commands

```bash
# Generate migrations from schema changes
pnpm db:generate

# Push schema changes to the local/dev database
pnpm db:push

# Check for schema drift
pnpm db:check
```

### Rules

- Schema changes flow for agents: edit `packages/adapters/db/src/schema.ts` → run `pnpm db:generate` → review generated migrations → use `pnpm db:push` when the local/dev database needs the new schema
- Never hand-edit files in `packages/adapters/db/drizzle/`
- Never use raw SQL or external tools to modify the database structure
- Always commit generated migration files alongside the schema changes
- `pnpm db:push` is allowed and often necessary for local/dev databases
- Do **not** run `pnpm db:migrate` locally as an agent
- Production/staging migration application must happen through the deployment pipeline

## Documentation Updates

After implementing, update two things:

### 1. SKILL.md (`.pi/skills/<agent>/SKILL.md`)

- **Current State** — what's implemented vs still needed
- **File Structure** — add/remove files to match disk
- **Skills (Public API)** — update signatures if changed
- **Types** — update if modified
- **Schema** (db only) — match actual Drizzle schema

### 2. Task files (`docs/tasks/`)

- Check completed subtask boxes
- Add files to "Files created/modified"
- Update `docs/tasks/README.md` status when task is done
