# Task: Deepen translation card lifecycle

Type: Technical debt.
Status: proposed.

## Problem

Translation card actions are spread across callback handlers. Save, skip, regenerate, sentence-only cards, saved-word updates, post-save keyboards, and template-aware rendering all repeat similar branching rules.

The current interface is shallow: callers must know whether the card is a sentence, word, phrase, saved, unsaved, expired, or regenerating, then pick rendering and persistence behavior themselves.

## Goal

Create a deeper translation card lifecycle module that owns state transitions for translation cards and returns renderable card state for Telegram handlers.

The Telegram layer should still perform Telegram effects, but it should not decide lifecycle behavior.

## Candidate Files

- `apps/bot/src/scenes/helpers/translate-mode.helper.ts`
- `apps/bot/src/scenes/helpers/regen.helper.ts`
- `apps/bot/src/renderers/translation.renderer.ts`
- `apps/bot/src/utils/vocabulary-mapper.ts`
- `apps/bot/src/types.ts`

## Implementation Plan

1. [ ] Model card state: pending word/phrase, pending sentence, saved word/phrase, skipped, expired, regenerating.
2. [ ] Move save, skip, and regenerate transition decisions behind one module interface.
3. [ ] Keep Telegram-specific callback parsing and `editMessageText()` calls in handlers.
4. [ ] Centralize card rendering inputs: template fields, native language, message id, and available target languages.
5. [ ] Add tests for save, duplicate save, skip, sentence regeneration, unsaved regeneration, and saved-word regeneration update.

## Acceptance Criteria

- [ ] Save/skip/regenerate callbacks do not duplicate card branching logic.
- [ ] Saved-word regeneration still updates persisted translation rows.
- [ ] Sentence cards remain regen-only.
- [ ] Expired session behavior remains unchanged.
- [ ] Full quality gate passes:

```bash
pnpm build && pnpm lint && pnpm lint:deps && pnpm lint:knip && pnpm test && pnpm db:push
```
