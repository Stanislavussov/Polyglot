# Task: Deepen dictionary deck module

Type: Technical debt.
Status: proposed.

## Problem

Flash card review and SRS review both build review decks from vocabulary, resolve language IDs, store session state, and render cards. The existing dictionary pipeline gives useful selection behavior, but callers still adapt repository rows and language cache details themselves.

This spreads review-selection rules and language resolution across bot handlers.

## Goal

Create a deeper dictionary deck module that owns deck creation, language resolution, and review metadata for flash card and SRS review modes.

## Candidate Files

- `packages/core/src/modules/dictionary-pipeline/pipeline.ts`
- `packages/core/src/modules/dictionary-pipeline/types.ts`
- `apps/bot/src/scenes/helpers/flashcard.helper.ts`
- `apps/bot/src/scenes/srs.scene.ts`
- `apps/bot/src/renderers/flashcard.renderer.ts`
- `apps/bot/src/renderers/srs.renderer.ts`

## Implementation Plan

1. [ ] Compare flash card and SRS deck inputs, outputs, and session state.
2. [ ] Decide which review rules belong in core and which remain Telegram-specific.
3. [ ] Move language resolution for deck rows behind a single adapter or workflow interface.
4. [ ] Expose deck outcomes for empty deck, active deck, completed deck, and review logging.
5. [ ] Add tests for flash card deck creation, SRS due-card deck creation, language resolution, and empty-deck behavior.

## Acceptance Criteria

- [ ] Flash card and SRS handlers no longer perform ad hoc language ID resolution.
- [ ] Deck selection rules are testable without a Telegram context.
- [ ] Existing flash card and SRS rendering remains unchanged.
- [ ] Review logging behavior remains best-effort where it is currently best-effort.
- [ ] Full quality gate passes:

```bash
pnpm build && pnpm lint && pnpm lint:deps && pnpm lint:knip && pnpm test && pnpm db:push
```
