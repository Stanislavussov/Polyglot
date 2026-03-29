# Task 28 — Validation must respect TranslationOutputConfig

**Type:** Bug fix
**Priority:** High — causes 100% validation failure + token waste on every translation when examples are disabled

## Problem

When `TranslationOutputConfig` has `includeExamples: false`, the translation pipeline:

1. Correctly builds a config-aware Zod schema (examples default to `[]`) ✅
2. Correctly omits examples from the AI prompt ✅
3. AI returns no examples, schema defaults to `[]` ✅
4. **Validation orchestrator still calls `validateExamples()` on the empty `[]` → fails with "No examples provided"** ❌
5. Retries 2 times (wasting ~$0.001 per retry × 2 = unnecessary cost) ❌
6. Always ends with `needsReview: true` — every translation is marked as unreliable ❌

### Reproduction

```
[translation] validation failed {
  original: 'in place',
  retryCount: 0,
  failReason: '[examples] translations.en.examples: No examples provided | [examples] translations.cs.examples: No examples provided'
}
```

This happens on every single translation when using `FULL_OUTPUT` or `MINIMAL_OUTPUT` presets (both have `includeExamples: false`).

### Root Cause

The `validate()` orchestrator in `packages/core/src/modules/validation/index.ts` has no awareness of `TranslationOutputConfig`. It always runs `validateExamples()` at Step 4, even when examples were intentionally disabled.

The guard condition `if (examples && Array.isArray(examples) && translationText)` passes for empty arrays (`[]` is truthy), so `validateExamples([])` is called and fails.

### Secondary Issue — `FULL_OUTPUT` preset misconfiguration

In `packages/core/src/modules/translation/translation-output.presets.ts`:

```typescript
/** All sections enabled — default for interactive translation & regeneration */
export const FULL_OUTPUT: TranslationOutputConfig = {
  includeExamples: false,  // ← Comment says "All sections enabled" but examples are OFF
  ...
};
```

The comment says "All sections enabled" but `includeExamples` is `false`. This means **interactive translations** — the main user-facing feature — are also affected. Either the comment is wrong (and examples should be disabled for token savings) or the value is wrong.

## Goal

Validation skips checks for fields that are disabled in `TranslationOutputConfig`. No wasted retries, no false `needsReview` flags.

## Acceptance Criteria

- [x] `validate()` orchestrator accepts an optional `ValidateOptions` parameter (mirrors `TranslationOutputConfig`)
- [x] When `includeExamples: false`, Step 4 (example validation) is skipped entirely
- [x] When `includeSynonyms: false`, synonym-related validation (if any) is skipped — N/A, no synonym validation exists
- [x] When `includeAlternatives: false`, Step 5 (alternatives semantic validation) is skipped
- [x] `translation.service.ts` passes `input.outputConfig` to `validate()`
- [x] Existing tests still pass — no regression in full-output validation (973 tests pass)
- [x] New tests: `validate()` with `includeExamples: false` does NOT fail on empty examples
- [x] New tests: `validate()` with `includeAlternatives: false` does NOT fail on missing alternatives
- [x] Decide on `FULL_OUTPUT` preset: fixed value to `includeExamples: true` (examples enabled for interactive use)
- [x] SKILL.md for validation updated with new `validate()` signature and `ValidateOptions` type

## Dependencies

None — self-contained bug fix.

## Effort Estimate

~2–3 hours

## Files Likely Affected

| File | Change |
|---|---|
| `packages/core/src/modules/validation/index.ts` | Add optional `outputConfig` param to `validate()`, skip disabled checks |
| `packages/core/src/modules/validation/types.ts` | Import or re-define `TranslationOutputConfig` type (or accept a simpler shape) |
| `packages/core/src/modules/translation/translation.service.ts` | Pass `input.outputConfig` to `validate()` call (line 107) |
| `packages/core/src/modules/translation/translation-output.presets.ts` | Fix `FULL_OUTPUT` comment or value |
| `packages/core/src/modules/validation/__tests__/validate.test.ts` | Add tests for config-aware validation |
| `.pi/skills/validation/SKILL.md` | Update `validate()` signature docs |

## Implementation Notes

### Option A — Pass output config to validate (recommended)

```typescript
// validation/index.ts
export function validate(
  raw: unknown,
  schema: ZodSchema,
  original: string,
  expectedLangs: string[],
  outputConfig?: TranslationOutputConfig  // NEW optional param
): ValidationResult {
  ...
  // Step 4: Example validation — skip if examples disabled
  const includeExamples = outputConfig?.includeExamples !== false;
  if (includeExamples && examples && Array.isArray(examples) && translationText) {
    ...
  }

  // Step 5: Alternatives semantic validation — skip if alternatives disabled
  const includeAlternatives = outputConfig?.includeAlternatives !== false;
  if (includeAlternatives && alternatives && Array.isArray(alternatives)) {
    ...
  }
}
```

```typescript
// translation.service.ts — line 107
const validation = validate(result, schema, input.word, input.targetLangs, input.outputConfig);
```

### Option B — Infer from schema (fragile, not recommended)

Try to detect from the schema whether examples are required. This is fragile and couples validation to Zod internals.

### Avoiding circular imports

`TranslationOutputConfig` lives in `packages/core/src/modules/translation/types.ts`. To avoid validation → translation dependency, either:
- Define a minimal `ValidationConfig` interface in `validation/types.ts` with just the fields validation cares about (`includeExamples`, `includeAlternatives`)
- Or accept a generic `{ includeExamples?: boolean; includeAlternatives?: boolean }` param

This keeps the validation module independent per clean architecture.
