# Task: Clean response when input is in a learning language

Status: implemented.

## Problem

When the user sends a word or phrase in a learning language, the bot should not include a separate native-language translation block in the response. The user is already a native speaker, so this block is low value and makes the card noisier.

However, examples for the learning-language translation still need to be understandable. Each example sentence in the learning language should include a Russian translation in parentheses.

Desired shape:

```text
🇨🇿 CS: <b>ahoj</b> [ˈahoj] (dobrý den, nazdar)
💬 <i>Ahoj, jak se máš?</i> (Привет, как дела?)
```

Undesired shape when the source word is already in a learning language:

```text
🇷🇺 RU: <b>привет</b>
```

## Current State

- Direction resolution intentionally includes the native language as a target when the detected source is a learning language:
  - `packages/core/src/modules/language-detect/resolve-direction.ts:34`
  - `packages/core/src/modules/language-detect/resolve-direction.ts:81`
- The translation prompt asks for examples, but it does not ask for a native-language translation of each example:
  - `packages/core/src/modules/translation/prompt.builder.ts:55`
  - `packages/core/src/modules/translation/prompt.builder.ts:93`
- The AI response schema only allows example fields `context` and `target`:
  - `packages/core/src/modules/translation/schemas/translation.schema.ts:18`
- The public `Example` type also only has `context` and `target`:
  - `packages/core/src/modules/translation/types.ts:36`
- The Telegram renderer prints examples as target-language sentences only:
  - `apps/bot/src/renderers/translation.renderer.ts:94`
- Saved vocabulary persists examples through `details.examples`, so the new field must survive save/load if examples are shown later from dictionary/flashcards:
  - `apps/bot/src/utils/vocabulary-mapper.ts:50`
  - `packages/core/src/modules/dictionary-pipeline/types.ts:150`

## Decision

Implement this as a contract change, not as a renderer-only patch.

Use a new optional field on examples:

```ts
interface Example {
  context: string;
  target: string;
  native?: string | null;
}
```

`native` means "translation of the target example sentence into the user's native language". For the current product direction this will usually be Russian, but the implementation should use the configured `nativeLang` instead of hard-coding `ru`.

## Implementation Plan

1. [x] Update translation example schema and types.
   - Add optional/nullish `native` to `Example`.
   - Add `native` to `exampleSchema`.
   - Keep it optional for backward compatibility with old saved examples.

2. [x] Update prompt building.
   - When `includeExamples` is true and `nativeLang` is known, instruct AI to include `native` for every example.
   - Make the instruction explicit: `target` is in the target language, `native` is the same sentence translated into the user's native language.
   - Remove or fix the stale prompt reference to `"register"` because the schema no longer contains a register field.

3. [x] Exclude native-language translation blocks when source is a learning language.
   - Direction resolution now returns learning-language targets only for learning-language source input, including the source learning language so the card can still render examples for it.
   - Still pass `nativeLang` to the translation request so examples can get native translations.
   - For source equals native language, keep the existing behavior unless product decides otherwise.

4. [x] Update rendering.
   - Render examples as `<target> (<native>)` when `native` exists.
   - Escape both target and native strings for Telegram HTML.
   - Keep fallback behavior: if old examples do not have `native`, render the existing target-only line.

5. [x] Preserve examples through storage and dictionary flows.
   - Ensure `toVocabularyInput()` keeps `example.native` in `details.examples`.
   - Ensure dictionary pipeline and flashcard/dictionary renderers can display `native` when present.

6. [x] Update tests.
   - Add prompt-builder tests for requesting native example translations.
   - Add schema/type tests proving examples with `native` parse and examples without `native` still parse.
   - Add direction tests: source in learning language should not include native language in `targetLangs`.
   - Add renderer tests for `💬 <i>...</i> (...)`.
   - Add vocabulary mapper/dictionary pipeline tests for preserving `native`.

## Acceptance Criteria

- [x] If user native language is Russian and learning language is Czech, input `ahoj` produces no `RU:` translation block.
- [x] Czech examples render with Russian translations in parentheses.
- [x] Existing saved examples without `native` still render without errors.
- [x] No `any`, `// @ts-ignore`, or `// @ts-expect-error` are introduced by this task.
- [x] Full quality gate passes:

```bash
pnpm build && pnpm lint && pnpm lint:deps && pnpm test
```

## Open Questions

- Should native-language input continue to include a native-language block in `targetLangs`? Current code does this in some paths; it may be intentional for consistent save logic, but it is also noisy.
- Should the native example translation always be Russian for interface-language `ru`, or should it always follow `settings.nativeLang`? Implemented as `settings.nativeLang`.

## Files Modified

- `packages/core/src/modules/translation/types.ts`
- `packages/core/src/modules/translation/schemas/translation.schema.ts`
- `packages/core/src/modules/translation/prompt.builder.ts`
- `packages/core/src/modules/translation/translation.service.ts`
- `packages/core/src/modules/language-detect/resolve-direction.ts`
- `packages/core/src/modules/topics/types.ts`
- `packages/core/src/modules/validation/index.ts`
- `packages/core/src/modules/validation/validators/example.validator.ts`
- `apps/bot/src/renderers/translation.renderer.ts`
- `apps/bot/src/renderers/flashcard.renderer.ts`
- `apps/bot/src/renderers/dictionary.renderer.ts`
- `apps/bot/src/scenes/helpers/translate-mode.helper.ts`
- Related tests in `packages/core/src/modules/**/__tests__`, `apps/bot/src/__tests__`, `apps/bot/src/renderers/__tests__`, and `apps/bot/src/scenes/helpers/**/__tests__`.
