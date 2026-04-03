# Task 06: AI Token Usage Optimization

**Status:** 🔲 To Do

## Description

Reduce AI token consumption per translation request. Current measurement shows **47k tokens for 7 requests (~6,700 tokens/request)**, while the expected baseline is **~1,500–2,000 tokens/request**. The 3x+ overhead is caused by false-positive validation failures triggering unnecessary retries (each retry = a full extra AI call with an even longer prompt).

**References:**
- `tech-reqs/07-ai-validation.md` (validation pipeline)
- `tech-reqs/08-ai-prompt.md` (prompt structure)
- `tech-reqs/14-agents.md` (agent contracts)

---

## Root Cause Analysis

### Token budget per request (expected vs actual)

| Component | Expected | With retries (actual) |
|---|---|---|
| Prompt text | ~600–800 | ×3 (original + 2 strict retries with error feedback) |
| Zod schema → JSON Schema (sent by Vercel AI SDK) | ~300–500 | ×3 |
| AI response | ~400–600 | ×3 |
| **Total per request** | **~1,500–2,000** | **~5,000–7,000** |

### Why validation fails too often

1. **`franc-min` language detection** — unreliable even above the 15-char threshold. Frequently misdetects languages in similar families (Czech/Slovak, Spanish/Portuguese, Russian/Ukrainian), triggering false-positive validation failures → unnecessary retries.

2. **Example word-matching too strict** — current stem logic (`word.slice(0, -1)`) is naive. Fails for inflected languages where stems change significantly (Czech: "slovo" → "slovem", Russian: "дом" → "домой"). Each miss = a retry.

3. **Schema validation is redundant** — `generateObject` from Vercel AI SDK already enforces the Zod schema structurally. Running `validateSchema()` again always passes → wasted compute (not tokens, but contributes to complexity).

4. **Prompt includes full JSON template** — the prompt contains a complete JSON structure with placeholders for every target language (~400–500 tokens). Since `generateObject` already sends the Zod schema as JSON Schema to the model, this template is largely redundant.

---

## Subtasks

### Step 1: Soften language detection — stop triggering retries on `franc` misdetection

The language validator already skips text <15 chars but still produces too many false positives on longer text. Change it from a hard failure to a soft warning.

- [ ] In `packages/core/src/modules/validation/validators/language.validator.ts`:
  - Add a `soft?: boolean` field to `ValidationError` type (or use a dedicated `warnings` array in `ValidationResult`)
  - When `franc` detects a mismatch, return a **warning** instead of an error
  - Warnings don't trigger retries but can set `needsReview: true`
- [ ] In `packages/core/src/modules/validation/types.ts`:
  - Add `warnings?: ValidationError[]` to `ValidationResult`
- [ ] In `packages/core/src/modules/validation/index.ts` (`validate()`):
  - Collect language detection results into `warnings`, not `errors`
  - Return `{ valid, errors, warnings }` — only `errors` trigger retries
- [ ] In `packages/core/src/modules/translation/translation.service.ts`:
  - Check `validation.warnings` — if present, set `needsReview: true` but don't retry
- [ ] Update tests in `packages/core/src/modules/validation/__tests__/language.validator.test.ts`

### Step 2: Improve example word-matching with better stem tolerance

The current `word.slice(0, -1)` approach fails for inflected languages. Use a more tolerant matching strategy.

- [ ] In `packages/core/src/modules/validation/validators/example.validator.ts`:
  - Replace `word.slice(0, -1)` with a **minimum prefix match**: use the first `Math.max(3, Math.floor(word.length * 0.6))` characters as the stem
  - For non-Latin scripts (Cyrillic, CJK, Arabic), use a shorter minimum prefix: `Math.max(2, Math.floor(word.length * 0.5))` characters
  - Also check if any word in the target sentence **starts with** the stem (to avoid false matches within unrelated words)
- [ ] Make example validation a **soft check** (same as Step 1): mismatches produce warnings, not errors
  - Rationale: the AI almost always puts the word in examples; when it uses a distant inflected form, retrying rarely helps
- [ ] Update tests in `packages/core/src/modules/validation/__tests__/example.validator.test.ts`

### Step 3: Skip redundant schema validation

`generateObject` already enforces the Zod schema — the response is guaranteed to parse. Remove the double-check.

- [ ] In `packages/core/src/modules/validation/index.ts` (`validate()`):
  - Remove the `validateSchema()` call
  - Keep the type cast (`raw as Record<string, unknown>`) — it's safe since `generateObject` guarantees the shape
  - Add a comment: `// Schema validation skipped — generateObject guarantees Zod conformance`
- [ ] Keep `validateSchema()` function and its tests — it's still useful for unit testing and edge cases
- [ ] Update `validate()` tests in `packages/core/src/modules/validation/__tests__/` to reflect the change

### Step 4: Slim down the translation prompt

The prompt currently contains a full JSON template with placeholders for every language (~400–500 tokens). Since `generateObject` sends the Zod schema as JSON Schema, the template is redundant.

- [ ] In `packages/core/src/modules/translation/prompt.builder.ts`, rewrite `buildTranslationPrompt()`:
  ```typescript
  export function buildTranslationPrompt(request: TranslationRequest): string {
    const { text, sourceLang, targetLangs, topic } = request;
    const topicHint = topic ? ` in the context of "${topic}"` : "";
    const langs = targetLangs.join(", ");

    return `Translate "${text}" from ${sourceLang} to ${langs}${topicHint}.

For each target language provide:
- The translation text
- IPA transcription (required for non-Latin scripts, optional otherwise)
- Register (slang, colloquial, neutral, literary, or professional)
- 2–3 synonyms with their register
- 3 example sentences (formal, colloquial, professional contexts), each containing the translated word or its inflected form, with the equivalent sentence in ${sourceLang}

Also provide one relevant emoji and the overall register for the word.`;
  }
  ```
  - ~150 tokens instead of ~600 tokens — the Zod JSON Schema handles the structure
  - Keeps all semantic requirements (examples, synonyms) as natural language
- [ ] Rewrite `buildStrictPrompt()` similarly — shorter base + error feedback:
  ```typescript
  export function buildStrictPrompt(request: TranslationRequest, errors: string[]): string {
    const base = buildTranslationPrompt(request);
    const errorList = errors.map(e => `- ${e}`).join("\n");

    return `${base}

IMPORTANT: Fix these errors from your previous response:
${errorList}`;
  }
  ```
- [ ] Update tests in `packages/core/src/modules/translation/__tests__/prompt.builder.test.ts`

### Step 5: Reduce MAX_RETRIES from 2 to 1

With softer validation (Steps 1–2), most false positives won't trigger retries at all. The remaining failures are genuine issues where one retry is usually sufficient.

- [ ] In `packages/core/src/modules/translation/translation.service.ts`:
  - Change `const MAX_RETRIES = 2` → `const MAX_RETRIES = 1`
  - This means at most 2 AI calls per word (1 original + 1 retry) instead of 3
- [ ] Update related tests

---

## Architecture Constraints

| Package | Change scope | Notes |
|---|---|---|
| `packages/core/src/modules/validation/` | Soft warnings, skip schema validation | Core stays infra-free |
| `packages/core/src/modules/translation/` | Slimmer prompts, MAX_RETRIES reduction | No new dependencies |
| `packages/adapters/ai/` | No changes | Token reduction is upstream |

---

## Files Modified

- `packages/core/src/modules/validation/types.ts` — add `warnings` to `ValidationResult`
- `packages/core/src/modules/validation/index.ts` — language → warnings, skip schema check
- `packages/core/src/modules/validation/validators/language.validator.ts` — return warnings
- `packages/core/src/modules/validation/validators/example.validator.ts` — better stem matching, soft warnings
- `packages/core/src/modules/translation/prompt.builder.ts` — slim prompt, shorter strict prompt
- `packages/core/src/modules/translation/translation.service.ts` — handle warnings, MAX_RETRIES = 1
- Test files for all above modules

---

## Expected Impact

| Optimization | Token reduction |
|---|---|
| Soft language detection (no retry on franc mismatch) | **-30% to -50%** (eliminates most false-positive retries) |
| Soft example validation (no retry on stem mismatch) | **-10% to -20%** (eliminates remaining false-positive retries) |
| Slim prompt (remove JSON template) | **-25% to -30% per call** (~450 tokens saved) |
| MAX_RETRIES 2 → 1 | **-15% to -25%** (caps worst case at 2× instead of 3×) |
| Skip schema double-check | negligible (compute only) |
| **Combined** | **47k → ~12–15k for 7 requests** (~70% reduction) |

---

## Key Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Softer validation lets through bad translations | `needsReview: true` flag is set on warnings — bot can show ⚠️ to user |
| Slimmer prompt produces worse AI output | `generateObject` still sends the full JSON Schema — structure is enforced; only verbose instructions removed |
| Fewer retries leave broken responses | Only false-positive retries are eliminated; genuine failures still get 1 retry |
| Example stem matching too loose (false negatives) | Use `startsWith` on word boundaries, not `includes` on arbitrary substrings |

---

## Acceptance Criteria

- [ ] Language detection mismatches produce warnings, not errors — no retries triggered
- [ ] Example word-matching uses improved stem logic and produces warnings, not errors
- [ ] Schema validation is skipped in `validate()` (generateObject guarantees conformance)
- [ ] Translation prompt is ≤200 tokens for a 2-language request (down from ~600)
- [ ] `MAX_RETRIES` is 1 (at most 2 AI calls per word)
- [ ] `ValidationResult` type includes optional `warnings` field
- [ ] `TranslateOutput.needsReview` is set to `true` when warnings are present
- [ ] Token usage for 7 clean translation requests is ≤20k (down from 47k)
- [ ] All existing tests updated and passing: `pnpm test`
- [ ] All packages build: `pnpm -r run build`
