# Task 60 — Context Hint Marker Mode

**Status:** ✅ Done  
**Type:** Feature (Telegram UX + translation prompt context)  
**Priority:** Medium — improves ambiguous word translation without extra menus  
**Effort Estimate:** 3–4 hours

---

## Goal

Add a lightweight input mode where the user can attach context metadata to a word or phrase directly in the Telegram message. The bot should translate the clean word, while passing the marked context to the model so it chooses the intended meaning.

Recommended mobile-friendly syntax:

```text
bank #finance
bank #river
замок #door
замок #castle
bank :: financial institution
замок :: дверной замок, не крепость
```

Telegram exposes hashtags as message entities, so `#context` is a better default than `*context`: it is visually clear, easy to type on mobile, and semantically close to metadata. `*` should remain an optional alias only if user testing shows hashtags are inconvenient.

## Problem

Ambiguous words need context, but the current translate mode treats the whole message as translation input. If the user sends `bank finance`, the model may treat both words as the source phrase instead of understanding that `finance` is metadata for the word `bank`.

The user needs an inline way to say:

- translate this word or phrase;
- do not translate the marker itself;
- use the marker as contextual hint for disambiguation, examples, synonyms, and idiom decisions.

## Requirements

### 1. Parse Context Hints from Telegram Text

Add a small parser that splits a Telegram text message into:

```typescript
interface ParsedTranslateInput {
  text: string;
  contextHint?: string;
}
```

Rules:

- Primary syntax: one or more trailing hashtags, for example `bank #finance` or `замок #door #house`.
- Free-form syntax for multi-word hints: `word :: context description`, for example `bank :: financial institution`.
- Strip the hashtag tokens from `text`.
- Convert hashtags to a human-readable context string:
  - `#job_interview` → `job interview`
  - `#finance #formal` → `finance, formal`
- Keep hashtags inside the actual word only when they are not Telegram hashtag entities or not trailing metadata.
- If stripping markers leaves an empty text, show a validation error and do not call AI.

### 2. Prefer Telegram Entities When Available

When `ctx.message.entities` includes `hashtag` entities:

- use entity `offset` and `length` to extract context markers;
- avoid naive string slicing bugs with emoji and non-Latin text;
- only treat trailing hashtags as context metadata;
- preserve normal hashtags in sentence translation when they are part of the sentence.

Fallback behavior if entities are missing in tests or unsupported clients:

- parse trailing hashtag tokens with a Unicode-aware regex;
- keep the fallback conservative to avoid deleting real translation input.

### 3. Pass Context into Translation Pipeline

Use the existing `topic` field on `TranslateInput` / `TranslationRequest` instead of adding a new AI schema field.

In `handleTranslateText()`:

1. Parse the raw message text before language detection.
2. Run language detection and classification on `parsed.text`, not the full raw text.
3. Pass `topic: parsed.contextHint` into `translateWithContext()`.
4. Store the clean `original` text in translation output.

The prompt builder already includes:

```text
The word is used in the context of: "..."
```

so this task should only strengthen tests around that existing behavior if needed.

### 4. Keep Regeneration Context-Aware

Regenerating one language from a card should use the same context hint as the original translation.

Implementation options:

- add `contextHint?: string` to the session `translationMap` entry; or
- add it to `TranslateOutput` if the context must survive beyond the current session.

Choose the smallest option that keeps regen correct. Do not persist context to vocabulary unless a separate product decision says saved words should display or reuse the hint later.

### 5. UX Feedback

The translation card does not need to display the context hint by default. The goal is to reduce noise.

Add a short i18n validation message for marker-only input:

```text
#finance
```

Expected behavior: bot asks the user to enter a word or phrase before the context marker.

### 6. Optional Alias: `*context`

Do not implement `*context` in the first pass unless it is trivial after the hashtag parser.

If implemented, it must follow the same rules:

```text
bank *finance
замок *door
```

Rationale: `*` is visually lightweight, but Telegram also uses asterisks in Markdown habits, and mobile keyboards often make `#` at least as accessible. Hashtags are easier to inspect through Telegram entities.

---

## Existing Code Reference

| File | Purpose |
| --- | --- |
| `apps/bot/src/scenes/helpers/translate-mode.helper.ts` | `handleTranslateText()` receives raw text and calls detection + translation |
| `apps/bot/src/types.ts` | Session `translationMap` shape if regen needs stored context |
| `packages/core/src/modules/translation/types.ts` | `TranslateInput` and `TranslationRequest` already support `topic` |
| `packages/core/src/modules/translation/prompt.builder.ts` | Existing topic hint in the AI prompt |
| `packages/core/src/modules/translation/__tests__/prompt.builder.test.ts` | Existing prompt tests for topic hints |
| `apps/bot/src/scenes/helpers/translate-mode.helper.test.ts` | Main helper tests for translate input |
| `apps/bot/src/scenes/helpers/__tests__/translate-mode-detection.test.ts` | Detection path tests |

---

## Implementation Plan

### Step 1: Add Parser

- [x] Create `apps/bot/src/utils/parse-translate-input.ts`.
- [x] Return clean `text` and optional `contextHint`.
- [x] Support Telegram entity-driven hashtag parsing.
- [x] Add conservative regex fallback for trailing hashtags.
- [x] Support free-form multi-word context with `word :: context description`.
- [x] Add unit tests for ASCII, Cyrillic, emoji offsets, multiple tags, and non-trailing hashtags.

### Step 2: Wire Parser into Translate Mode

- [x] Parse the incoming word at the start of `handleTranslateText()`.
- [x] Use clean text for language detection, input classification, logging, loading/error context, and AI request.
- [x] Pass `topic: contextHint` to `translateWithContext()`.
- [x] Ensure marker-only input returns a localized validation message and does not call AI.

### Step 3: Preserve Context for Regeneration

- [x] Store the context hint with the message's translation map entry.
- [x] Pass the stored context hint to `translateOneWithContext()` in `handleRegenCallback()`.
- [x] Add tests proving regenerated translations keep the original context.

### Step 4: Tests

- [x] Parser tests cover `bank #finance` → text `bank`, context `finance`.
- [x] Parser tests cover `bank #river #informal` → context `river, informal`.
- [x] Parser tests cover `#finance` → empty clean text.
- [x] Parser tests cover `bank :: financial institution` → text `bank`, context `financial institution`.
- [x] Translate mode tests prove `translateWithContext()` receives `word: "bank"` and `topic: "finance"`.
- [x] Detection tests prove `detectLanguage()` receives the clean text, not the full text with marker.
- [x] Regen tests prove `translateOneWithContext()` receives the stored topic.

---

## Acceptance Criteria

- [x] User can send `bank #finance`; bot translates `bank` using finance context.
- [x] User can send `bank #river`; bot translates `bank` using river/geography context.
- [x] User can send `bank :: financial institution`; bot translates `bank` using a multi-word context description.
- [x] Context markers are not included in `output.original`.
- [x] Language detection and sentence/word classification use the clean input.
- [x] Regeneration preserves the same context hint.
- [x] Marker-only input shows a localized validation error and makes no AI call.
- [x] Existing behavior is unchanged for messages without context markers.
- [x] No `any`, `// @ts-ignore`, or `// @ts-expect-error` are introduced.
- [x] Full quality gate passes:

```bash
pnpm build && pnpm lint && pnpm lint:deps && pnpm test
```

## Files Created/Modified

- `apps/bot/src/utils/parse-translate-input.ts`
- `apps/bot/src/utils/parse-translate-input.test.ts`
- `apps/bot/src/scenes/helpers/translate-mode.helper.ts`
- `apps/bot/src/scenes/helpers/translate-mode.helper.test.ts`
- `apps/bot/src/scenes/helpers/__tests__/translate-mode-detection.test.ts`
- `apps/bot/src/types.ts`
- `packages/core/src/modules/i18n/types.ts`
- `packages/core/src/modules/i18n/locales/en.json`
- `packages/core/src/modules/i18n/locales/ru.json`
- `packages/core/src/modules/i18n/locales/cs.json`
- `packages/core/src/modules/i18n/__tests__/i18n.test.ts`
- `@docs/tasks/60-context-hint-marker-mode.md`
- `@docs/tasks/README.md`

---

## Open Questions

- Should context be displayed subtly in the card, for example `Context: finance`, or remain invisible?
- Should saved vocabulary persist the context hint for later dictionary/flashcard regeneration?
- Should `*context` be accepted as an alias after testing on mobile keyboards?
