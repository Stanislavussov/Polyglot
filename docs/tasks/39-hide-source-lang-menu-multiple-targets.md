# Task 39 — Hide Source Language Menu When 2+ Target Languages

## Goal

When a user has 2 or more target (learning) languages, the source language selection menu after each translation clutters the chat and makes the translation text hard to see. Disable it for multi-target users.

## Problem Analysis

After every translation, `sendSourceLangMenu()` in `translate-mode.helper.ts` sends an additional message with a source language selection keyboard. Currently, `buildSourceLangKeyboard()` only suppresses this when `langs.length <= 2` (native + 1 learning = 2 total).

When there are 2+ learning languages (3+ total langs), the menu shows 3–5 language buttons in a row, pushing the translation card out of view. For multi-target users, auto-detection (Task 16) is sufficient — the source lang menu adds more noise than value.

## Required Behavior

- **1 learning language** (2 total): hide menu (already done — `langs.length <= 2`)
- **2+ learning languages** (3+ total): hide menu (NEW — auto-detect is sufficient)
- Keep the menu accessible via `/settings` (Task 37) for users who want to pin source lang

## Acceptance Criteria

- [ ] Source language selection menu is NOT shown after translations when user has 2+ learning languages
- [ ] Source language selection menu is NOT shown after Save/Skip when user has 2+ learning languages
- [ ] Auto-detect (Task 16) continues to work correctly for all users
- [ ] `buildSourceLangKeyboard()` or `sendSourceLangMenu()` logic updated
- [ ] Existing tests updated to reflect new threshold
- [ ] No regression for single-target-language users (menu still hidden, auto-detect works)

## Dependencies

- None (can be done independently; Task 37 can later add settings access to source lang)

## Effort Estimate

1–2 hours

## Files Likely Affected

- `apps/bot/src/scenes/helpers/translate-mode.helper.ts` — `sendSourceLangMenu()`: skip when `learningLangs.length >= 2`
- `apps/bot/src/renderers/translation.renderer.ts` — optionally update `buildSourceLangKeyboard()` threshold or leave the suppression in the caller
- `apps/bot/src/__tests__/translate-mode.test.ts` — update tests
- `apps/bot/src/renderers/__tests__/` — update keyboard tests if any
