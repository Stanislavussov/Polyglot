---
name: dev-standards
description: Testing and documentation conventions for all technical agents. Covers Vitest test patterns, SKILL.md updates, and task tracking. Read after implementing any feature.
---

# Development Standards

## Linting & Formatting (Biome)

- The project uses [Biome](https://biomejs.dev/) for linting and formatting
- Config: `biome.json` at the repo root
- After finishing all code changes, run: `pnpm lint` (alias for `biome check .`)
- If there are errors, fix them with `pnpm lint:fix` (alias for `biome check --write .`), then verify with `pnpm lint`
- If `lint:fix` can't auto-fix something, fix manually or add a `// biome-ignore` comment with a reason
- **Never skip the lint step** — it's a quality gate just like tests

## Testing

- Write Vitest tests next to source as `<module>.test.ts`
- Imports: `import { describe, it, expect, vi } from 'vitest'`
- Cover: happy path, edge cases, error handling
- Mock external dependencies — tests run without real DB/API
- Use `.js` extensions in all imports

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
