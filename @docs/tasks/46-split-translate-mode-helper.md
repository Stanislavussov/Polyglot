# Task 46 — Split translate-mode.helper.ts God Module

**Status:** 🔲 To Do  
**Category:** Architecture — High  
**Blocks:** Developer velocity on every translate-related feature

---

## Goal

Decompose `apps/bot/src/scenes/helpers/translate-mode.helper.ts` (550 lines, 7 exports, 8 import sources) into focused, single-responsibility modules. This file currently handles: text translation, save callback, skip callback, regeneration, source language selection, language menu rendering, and session state management.

Every new feature touching the translation flow (rate limiting, usage tracking, SRS trigger on save, quiz integration) adds more code here.

## Problem Analysis

Current exports and their responsibilities:

```
handleTranslateText()      — 100+ lines: resolve direction, classify input, call AI, render card, send menu
handleSaveCallback()       — 60+ lines: FK resolution, duplicate detection, persist, edit card
handleSkipCallback()       — 30+ lines: clear pending, edit card, send menu
handleRegenCallback()      — 90+ lines: regen single lang, merge, update DB, re-render
handleSourceLangCallback() — 30+ lines: set source lang, persist, update keyboard
buildLangOptions()         — helper for lang keyboard
sendSourceLangMenu()       — helper for source lang menu
```

All 7 functions share intertwined state management via `ctx.session.*`.

## Required Behavior

Split into 4 focused files with clear single responsibilities:

1. `translate.handler.ts` — `handleTranslateText()` (input → AI → render)
2. `save.handler.ts` — `handleSaveCallback()` (FK resolution, dedup, persist, post-save card)
3. `source-lang.handler.ts` — `handleSourceLangCallback()`, `buildLangOptions()`, `sendSourceLangMenu()`
4. `translate-mode.helper.ts` — reduced to re-exports for backward compatibility (optional)

`regen.helper.ts` already exists and handles `handleRegenCallback()` — verify it's fully extracted, or complete the extraction.

## Acceptance Criteria

- [ ] `apps/bot/src/scenes/helpers/translate.handler.ts` created with `handleTranslateText()`
- [ ] `apps/bot/src/scenes/helpers/save.handler.ts` created with `handleSaveCallback()`, `handleSkipCallback()`
- [ ] `apps/bot/src/scenes/helpers/source-lang.handler.ts` created with `handleSourceLangCallback()`, `buildLangOptions()`, `sendSourceLangMenu()`
- [ ] Each new file has ≤ 200 lines
- [ ] `translate-mode.helper.ts` either deleted or reduced to re-exports only (`export { handleTranslateText } from "./translate.handler.js"`, etc.)
- [ ] All imports in `apps/bot/src/index.ts` updated to new paths (or re-exports work transparently)
- [ ] All existing tests in `translate-mode.helper.test.ts` and related test files still pass
- [ ] No behavioral changes — pure refactor

## Dependencies

None

## Effort Estimate

3–4 hours (split files: 1.5h, update imports: 1h, verify tests: 1h)

## Files Likely Affected

- `apps/bot/src/scenes/helpers/translate.handler.ts` — NEW
- `apps/bot/src/scenes/helpers/save.handler.ts` — NEW
- `apps/bot/src/scenes/helpers/source-lang.handler.ts` — NEW
- `apps/bot/src/scenes/helpers/translate-mode.helper.ts` — gutted to re-exports or deleted
- `apps/bot/src/index.ts` — update callback handler imports
- `apps/bot/src/middlewares/mode-router.ts` — update `handleTranslateText` import
- `apps/bot/src/scenes/helpers/regen.helper.ts` — verify no leftover duplication
- Existing test files — update import paths
