# Task: Deepen settings registry

Type: Technical debt.
Status: proposed.

## Problem

Settings keys, defaults, and validation are repeated across core settings, the database adapter, and admin API routes. The same operational defaults appear in multiple places, so changing one setting risks runtime/admin drift.

The current modules expose a shallow interface: callers must know the storage key, fallback default, validation schema, and typed shape.

## Goal

Create a deeper settings registry module that owns settings keys, defaults, validation, and typed get/set behavior.

## Candidate Files

- `packages/core/src/modules/settings/settings.service.ts`
- `packages/core/src/ports/settings.port.ts`
- `packages/adapters/db/src/settings-adapter.ts`
- `packages/adapters/db/src/repositories/system-settings.repository.ts`
- `apps/admin-api/src/routes/ai-defaults.ts`
- `apps/admin-api/src/routes/dictionary.ts`
- `apps/admin-api/src/routes/srs.ts`
- `apps/admin-api/src/routes/translation.ts`

## Implementation Plan

1. [ ] Inventory all settings keys, defaults, and route validation schemas.
2. [ ] Define one registry for key, type, default value, and validation rules.
3. [ ] Update runtime settings reads to use the registry.
4. [ ] Update admin settings routes to use registry validation and defaults.
5. [ ] Add tests proving runtime and admin routes use the same defaults and validation constraints.

## Acceptance Criteria

- [ ] Settings defaults are defined in one place.
- [ ] Admin routes and runtime reads cannot drift on setting keys or defaults.
- [ ] Existing admin settings responses remain compatible.
- [ ] No database schema change is required unless explicitly discovered during implementation.
- [ ] Full quality gate passes:

```bash
pnpm build && pnpm lint && pnpm lint:deps && pnpm lint:knip && pnpm test && pnpm db:push
```
