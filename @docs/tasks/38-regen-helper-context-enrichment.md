# Task 38 — Use `createContextLookup` in Regen Helper

**Status:** 🔲 To Do  
**Type:** Bug fix / consistency  
**Priority:** High — regen translations miss dictionary context, producing lower quality than initial translations  
**Effort:** ~1–2 hours

---

## Goal

`apps/bot/src/scenes/helpers/regen.helper.ts` calls `translateOne()` directly, bypassing the context-enrichment layer. This means regenerated translations **do not** receive dictionary context (Wiktionary POS, glosses, form tags) that the initial translation gets via `translateWithContext` / `translateOneWithContext`.

Switch `regen.helper.ts` to use `translateOneWithContext` + `createContextLookup()` from `@polyglot/adapter-db`, matching the pattern already used in `translate-mode.helper.ts`.

---

## Acceptance Criteria

- [ ] `regen.helper.ts` imports `createContextLookup` from `@polyglot/adapter-db`
- [ ] `regen.helper.ts` imports `translateOneWithContext` from `@polyglot/core` instead of `translateOne`
- [ ] A singleton `lookupContext` is created at module level (same pattern as `translate-mode.helper.ts`)
- [ ] For sentence input type, `lookupContext` is replaced with `async () => undefined` (no dictionary lookup for sentences)
- [ ] `translateOneWithContext` is called with `{ lookupContext, generateObjectFn: generateObject }` as deps
- [ ] Existing regen tests in `regen.helper.test.ts` are updated to mock `@polyglot/adapter-db` (adding `createContextLookup`) and `translateOneWithContext` instead of `translateOne`
- [ ] All existing regen test cases still pass
- [ ] `tsc --noEmit` passes
- [ ] `vitest run` passes

---

## Dependencies

None — standalone change.

---

## Files Likely Affected

| File | Change |
|---|---|
| `apps/bot/src/scenes/helpers/regen.helper.ts` | Replace `translateOne` with `translateOneWithContext` + `createContextLookup` |
| `apps/bot/src/scenes/helpers/regen.helper.test.ts` | Update mocks: add `@polyglot/adapter-db` mock, switch `translateOne` → `translateOneWithContext` |

---

## Implementation Notes

### Current (broken) pattern in `regen.helper.ts`:
```ts
import { translateOne } from "@polyglot/core";
// ...
return translateOne({ ...input }, generateObject);
```

### Target pattern (matches `translate-mode.helper.ts`):
```ts
import { createContextLookup } from "@polyglot/adapter-db";
import { translateOneWithContext } from "@polyglot/core";

const lookupContext = createContextLookup();

// Inside regen:
const lookupContextFn = isSentence ? async () => undefined : lookupContext;
const newTranslation = await translateOneWithContext(
  { ...input },
  { lookupContext: lookupContextFn, generateObjectFn: generateObject },
);
```

### Test mock pattern (from `translate-mode.helper.test.ts`):
```ts
vi.mock("@polyglot/adapter-db", () => ({
  createContextLookup: () => mockLookupContext,
  // ... other mocks
}));
```
