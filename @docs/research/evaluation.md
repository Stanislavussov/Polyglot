# Evaluation: Small-Model Translation Reliability

**Date:** 2026-06-03  
**Question:** How should the translation chain be simplified for cheap small models such as GPT mini/nano or Gemini Flash so output stays accurate and schema-compliant?

## Current System

Interactive word/phrase translation currently asks one model call to produce:

- Main translation for every target language
- IPA transcription
- Native synonyms
- Target-language synonyms
- Exactly 2 alternative translations
- 3 examples per target language
- Idiom/equivalent metadata
- Optional connotation warning
- Emoji
- Sometimes Wiktionary context with up to 5 glosses

The prompt is config-aware, but the AI-facing schema still requires the broad per-language object shape. Disabled fields become empty arrays or nulls, then `stripDisabledFields()` removes them after generation. For small models, this means format pressure remains high even when UI output is smaller.

## Evidence For Simplification

OpenAI Structured Outputs docs state schema adherence is more reliable than JSON mode and reduces need for heavy prompt wording, but also note complex schemas add latency and can still have semantic mistakes inside values. OpenAI's launch article explains reliability comes from constrained decoding; complex schemas require more processing and do not prevent wrong field values.

Gemini structured output docs also show structured JSON works through a supported subset of JSON Schema. This supports using schema for format, but argues against asking small models to satisfy deep, verbose, provider-portability-sensitive schemas when the business need is basic translation reliability.

Project evidence matches this:

- `@docs/tasks/06-token-optimization.md` already identifies full JSON template, retries, and strict validation as token drivers.
- `packages/core/src/modules/translation/prompt.builder.ts` repeats a large JSON template in prompt even though `generateObject` also sends schema.
- `packages/core/src/modules/translation/schemas/translation.schema.ts` keeps disabled sections structurally present in AI-facing schema.
- `apps/bot/src/renderers/translation.renderer.ts` can already render missing/empty sections, so UI does not require all metadata.

## Evidence Against Simplification

Rich cards are useful for language learning:

- Examples help usage, not just literal meaning.
- Alternatives help ambiguous words.
- Synonyms help vocabulary expansion.
- Connotation warnings catch risky words.
- Idiom metadata improves phrase/proverb handling.

Removing everything would make the product closer to a generic translator and reduce differentiation.

## Risks

| Risk | Probability | Impact | Mitigation |
|---|---:|---:|---|
| Removing alternatives loses nuance for ambiguous words | Medium | Medium | Keep one optional "note" field or generate alternatives only on demand |
| Removing examples reduces learning value | Medium | Medium | Make examples a second action: "Examples" / regenerate detail |
| Smaller schema admits poorer semantic quality | Low-Medium | High | Keep dictionary context for words, keep validation, add needsReview when uncertain |
| Splitting into multiple calls raises cost | Low | Medium | Only call detail endpoints on demand; default call is much cheaper |
| Custom user templates conflict with reliability mode | Medium | Medium | Treat custom template as display/detail mode, not default AI contract for cheap models |

## Alternatives

### A. Keep full rich translation in one call

Pros:

- Best UX when model follows instructions.
- One request returns all learning data.
- Current renderer and template system already built for it.

Cons:

- Worst option for small models.
- More schema fields, more output tokens, more retry surface.
- Business value hurt when user sees malformed or wrong cards.

Verdict: reject for cheap default models.

### B. Slim prompt only, keep broad schema

Pros:

- Easy change.
- Saves input tokens.
- Keeps current response type.

Cons:

- Does not remove main failure source: broad structured output.
- Disabled fields still appear in schema pressure.
- Small model can still mix alternatives/examples/synonyms.

Verdict: partial fix only.

### C. Default to one reliable translation, move learning extras on demand

Default response:

```json
{
  "emoji": "string",
  "translations": {
    "cs": { "text": "string", "transcription": "string | null" }
  }
}
```

Optional second actions:

- Examples
- Alternatives
- Synonyms
- Idiom note

Pros:

- Smallest reliable contract.
- Best business path: user gets correct translation fast.
- On-demand extras preserve product depth.
- Less retry/cost pressure.

Cons:

- First card less rich.
- Requires UI/template expectation change.

Verdict: recommend.

### D. Keep 3 translations but remove examples/synonyms

Pros:

- Preserves "choose nuance" UX.
- Less verbose than current full output.

Cons:

- User asked reliability; multiple variants remain ambiguity-heavy.
- Small model can invent weak alternatives.
- Business value of 3 translations lower than one correct translation.

Verdict: pivot away from always-on alternatives.

### E. Two-tier model strategy

Cheap model default:

- Main translation only
- IPA only when short/non-Latin
- Dictionary context capped to 1-2 glosses
- No alternatives/examples/synonyms/connotation by default

Stronger model or explicit detail mode:

- Full learning card

Pros:

- Keeps premium/rich path.
- Matches model capability to task.
- Gives predictable cheap path.

Cons:

- More config and product states.

Verdict: recommend with C.

## Recommended Chain

### Default cheap-model chain

1. Detect source language before AI call.
2. Lookup dictionary context only for word/phrase, not sentence.
3. Build compact prompt:

```text
Translate input from SOURCE to TARGETS.
Use dictionary sense if provided.
Return exact JSON by schema.
Prefer one natural translation per target language.
No explanations.
```

4. Use compact schema:

```ts
{
  emoji: string;
  translations: Record<lang, {
    text: string;
    transcription: string | null;
  }>;
}
```

5. Validate structure and language keys.
6. Do not retry on weak example/synonym checks, because they no longer exist.
7. Show compact card.
8. Offer detail buttons: examples, alternatives, synonyms.

### Word/phrase detail chain

Run only when user asks or template demands full mode:

- One target language at a time if possible.
- Separate detail schema from main translation schema.
- Use original translation as anchor: do not retranslate from scratch.

### Dictionary context

Keep, but shrink:

- Include POS.
- Include max 2 glosses.
- Prefer gloss matching detected source language.
- Do not include "alternatives should capture different senses" in default mode, because alternatives disabled.

## Business Recommendation

Default should be one correct translation, not three rich variants.

Reason:

- User's core job: understand word/phrase now.
- Wrong format or noisy output breaks trust faster than lack of extras.
- Cheap model strength: short constrained task.
- Product can still sell learning depth through on-demand detail.

Suggested UX:

- First message: compact translation card.
- Buttons: regenerate per language, save, examples, alternatives.
- User template: controls displayed/requested detail mode, but default onboarding should be "Reliable" template.

## Implementation Plan

1. Add `RELIABLE_OUTPUT` preset:
   - examples false
   - synonyms false
   - alternatives false
   - equivalentNote false
   - connotationWarning false
   - nativeSynonyms false
   - transcription true

2. Make schema builder truly omit disabled fields from AI-facing schema instead of requiring null/empty fields.

3. Use `RELIABLE_OUTPUT` in `translate-mode.helper.ts` for cheap models by default.

4. Keep `FULL_OUTPUT` only for explicit rich/detail mode or stronger models.

5. Shorten prompt:
   - remove full JSON template
   - rely on schema for structure
   - keep only semantic rules

6. Reduce strict retry prompt:
   - include only validation errors
   - no full checklist unless field enabled

7. Cap dictionary glosses from 5 to 2 in default mode.

8. Add telemetry:
   - prompt token estimate
   - output token estimate
   - retry count
   - needsReview rate
   - generation failure rate by model

## Verdict

**Recommend pivot to reliable-first translation.**

Do not keep three translations by default. Do not rely on prompt wording to make small models obey a rich contract. Change product default to one accurate translation plus optional detail actions. Technical priority: shrink AI-facing schema, not just prompt text.

Sources:

- OpenAI Structured Outputs guide: https://developers.openai.com/api/docs/guides/structured-outputs
- OpenAI Structured Outputs launch article: https://openai.com/index/introducing-structured-outputs-in-the-api/
- Gemini Structured Outputs docs: https://ai.google.dev/gemini-api/docs/structured-output
- Vercel AI SDK `generateObject` reference: https://vercel-ai.mintlify.app/reference/ai-sdk-core/generate-object
