# Task: Deepen composition root typing

Type: Technical debt.
Status: proposed.

## Problem

The bot composition root currently casts the constructed container through `unknown` to `ServiceContainer`. That weakens the port seam because TypeScript cannot prove the adapters satisfy the interface.

If adapter shape drifts from a port, the cast can hide the issue until runtime.

## Goal

Make the composition root type-check adapter wiring without a broad cast.

## Candidate Files

- `apps/bot/src/container.ts`
- `packages/core/src/ports/container.ts`
- `packages/core/src/ports/*.ts`
- `packages/adapters/db/src/index.ts`
- `packages/adapters/ai/src/index.ts`
- `packages/adapters/notifications/src/index.ts`

## Implementation Plan

1. [ ] Compare each adapter implementation with its port interface.
2. [ ] Fix any port/adapter mismatches at the source.
3. [ ] Replace the broad `as unknown as ServiceContainer` cast with checked construction.
4. [ ] Add narrow adapter typing helpers only if they increase locality.
5. [ ] Add tests or type-level checks for the composition root if needed.

## Acceptance Criteria

- [ ] `createContainer()` returns `ServiceContainer` without `as unknown as ServiceContainer`.
- [ ] Adapter/port mismatch is caught by TypeScript.
- [ ] No `any`, `// @ts-ignore`, or `// @ts-expect-error` is introduced.
- [ ] Existing bot container behavior remains unchanged.
- [ ] Full quality gate passes:

```bash
pnpm build && pnpm lint && pnpm lint:deps && pnpm lint:knip && pnpm test && pnpm db:push
```
