# Task: Deepen translation request workflow

Type: Technical debt.
Status: proposed.

## Problem

Translation mode currently mixes product workflow decisions with Telegram message handling. A single request path knows about input parsing, text validation, language detection, fallback direction, quota checks, model selection, template resolution, dictionary context enrichment, request timing, metrics, and session state.

This makes source/native/learning response-shape changes hard to localize. Recent response-shape work crossed prompt building, schema, validation, direction resolution, rendering, storage, dictionary, and flashcard flows.

## Goal

Create a deeper translation request workflow module whose interface accepts user text plus user settings and returns one of the workflow outcomes:

- rejected input
- missing learning languages
- mistype confirmation required
- completed translation request

The Telegram layer should primarily translate those outcomes into replies and session updates.

## Candidate Files

- `apps/bot/src/scenes/helpers/translate-mode.helper.ts`
- `packages/core/src/modules/context-enrichment/context-enrichment.service.ts`
- `packages/core/src/modules/language-detect/resolve-direction.ts`
- `packages/core/src/modules/translation/translation.service.ts`
- `apps/bot/src/utils/parse-translate-input.ts`
- `apps/bot/src/utils/validate-text-input.ts`

## Implementation Plan

1. [ ] Identify the workflow inputs that are not Telegram-specific.
2. [ ] Move direction resolution, validation, output config, model selection inputs, and enrichment decisions behind a single workflow interface.
3. [ ] Keep Telegram-specific effects in the bot layer: replies, message deletion, keyboards, and session mutation.
4. [ ] Preserve native-source and learning-source response-shape rules from existing task docs.
5. [ ] Add workflow tests for native-source, learning-source, English hidden candidate, inconclusive detection, and quota rejection.

## Acceptance Criteria

- [ ] `handleTranslateText()` no longer owns source/native/learning response-shape decisions directly.
- [ ] Learning-language input still omits native-language translation blocks.
- [ ] Native-language input still treats connotation as target-side metadata only.
- [ ] Mistype confirmation remains behaviorally unchanged.
- [ ] Full quality gate passes:

```bash
pnpm build && pnpm lint && pnpm lint:deps && pnpm lint:knip && pnpm test && pnpm db:push
```
