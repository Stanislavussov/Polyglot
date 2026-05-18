# Task 29 — Require Source Language Selection Before Translation

**Status:** ❌ Superseded by Task 58  
**Type:** UX improvement  
**Priority:** Medium — ~~prevents wasted AI calls when auto-detect picks the wrong direction~~  
**Dependencies:** Task 17 (source language menu infrastructure)

> **Superseded by [Task 58](./58-language-detection-pre-request.md):** Task 58 removes the source language selection menu entirely in favor of automatic language detection with mistype warning. This task's approach (buffer word → show menu → auto-translate on selection) is no longer needed.

---

## Description

Currently, when `nextSourceLang` is not set (first translation or after bot restart), the bot **auto-detects** the input language via `resolveTranslationDirection()` and immediately sends the AI request. This can waste tokens on incorrect direction detection, especially for short inputs.

**New behavior:** When the user sends text in translate mode and no source language has been selected (`nextSourceLang` is `null`/`undefined`), the bot must **not** call the AI. Instead, it should show the existing source language selection menu (from Task 17) with an additional prompt message telling the user to pick a source language first. The user's text should be buffered in the session so that after they pick a language, the translation proceeds automatically.

### UX Flow

```
[User types "dům" — no source language set yet]
  → Bot does NOT call AI
  → Bot replies:
    "To translate, select the source language first:"
    [ 🇷🇺 Russian ] [ 🇬🇧 English ] [ 🇨🇿 Czech ]

[User taps "🇨🇿 Czech"]
  → Bot sets nextSourceLang = "cs"
  → Bot automatically translates the buffered word "dům" from Czech
  → Bot shows translation card + Save/Skip + source lang menu as usual

[User types "hello" — source language already set to Czech]
  → Bot translates from Czech as expected (existing behavior)
```

---

## Root Cause

In `handleTranslateText()` (`apps/bot/src/scenes/helpers/translate-mode.helper.ts`), the `else` branch when `nextSource` is falsy calls `resolveTranslationDirection()` and proceeds to translate. This auto-detect fallback should be replaced with a gate that requires explicit source language selection.

---

## Subtasks

### Step 1: Add i18n key for the prompt

- [ ] In `packages/core/src/modules/i18n/types.ts`:
  - Add `"selectSourceLangFirst"` to the `I18nKey` union
- [ ] In `packages/core/src/modules/i18n/locales/en.json`:
  - `"selectSourceLangFirst": "To translate, select the source language first:"`
- [ ] In `packages/core/src/modules/i18n/locales/ru.json`:
  - `"selectSourceLangFirst": "Для перевода выберите исходный язык:"`
- [ ] In `packages/core/src/modules/i18n/locales/cs.json`:
  - `"selectSourceLangFirst": "Pro překlad vyberte zdrojový jazyk:"`

### Step 2: Add `pendingWord` to session data

- [ ] In `apps/bot/src/types.ts`:
  - Add `pendingWord?: string | null` to `SessionData`
  - This buffers the user's text so it can be translated after source language selection
- [ ] In `apps/bot/src/index.ts`:
  - Add `pendingWord: null` to session initial data (if explicit initialization exists)

### Step 3: Gate translation on source language selection

- [ ] In `apps/bot/src/scenes/helpers/translate-mode.helper.ts` → `handleTranslateText()`:
  - Replace the `else` branch (auto-detect fallback) with:
    1. Store the word in `ctx.session.pendingWord = word`
    2. Show the `selectSourceLangFirst` prompt with the source language keyboard
    3. **Return early** — do NOT call `translateWithContext()`
  - Keep the existing `if (nextSource)` branch unchanged — when source is set, translate immediately
  - **Special case:** If user has only 2 languages total (1 native + 1 learning), auto-detect is fine — skip the gate and translate immediately (the source lang menu is not shown for 2-language users anyway, per Task 17)

### Step 4: Auto-translate buffered word after source language selection

- [ ] In `apps/bot/src/scenes/helpers/translate-mode.helper.ts` → `handleSourceLangCallback()`:
  - After setting `ctx.session.nextSourceLang = code`:
    - Check if `ctx.session.pendingWord` is set
    - If yes: call `handleTranslateText(ctx, ctx.session.pendingWord)` to translate the buffered word, then clear `ctx.session.pendingWord = null`
    - If no: existing behavior (just update keyboard, show confirmation)

### Step 5: Clear pendingWord on mode change / new text

- [ ] In `handleTranslateText()`:
  - When source lang IS set and translation proceeds normally, ensure `pendingWord` is cleared (`ctx.session.pendingWord = null`)
- [ ] In `handleTranslateCommand()` (`apps/bot/src/scenes/translate.scene.ts`):
  - Clear `pendingWord` when user re-enters translate mode (fresh start)

### Step 6: Write tests

- [ ] `apps/bot/src/scenes/helpers/__tests__/translate-mode-source-lang.test.ts` (extend existing):
  - **No source lang + text input:** bot does NOT call AI, shows `selectSourceLangFirst` + language keyboard
  - **No source lang + text input + tap language:** bot translates the buffered word with selected source
  - **Source lang already set + text input:** bot translates immediately (no gate)
  - **2-language user + no source lang:** bot auto-detects and translates immediately (no gate)
  - **pendingWord cleared after successful translation**
  - **pendingWord cleared on /translate command**

---

## Files Affected

| File | Change |
|---|---|
| `packages/core/src/modules/i18n/types.ts` | Add `selectSourceLangFirst` to `I18nKey` |
| `packages/core/src/modules/i18n/locales/en.json` | Add `selectSourceLangFirst` string |
| `packages/core/src/modules/i18n/locales/ru.json` | Add `selectSourceLangFirst` string |
| `packages/core/src/modules/i18n/locales/cs.json` | Add `selectSourceLangFirst` string |
| `apps/bot/src/types.ts` | Add `pendingWord?: string \| null` to `SessionData` |
| `apps/bot/src/index.ts` | Initialize `pendingWord` in session defaults |
| `apps/bot/src/scenes/helpers/translate-mode.helper.ts` | Gate on source lang, buffer word, auto-translate on callback |
| `apps/bot/src/scenes/translate.scene.ts` | Clear `pendingWord` on mode entry |
| `apps/bot/src/scenes/helpers/__tests__/translate-mode-source-lang.test.ts` | New test cases |

---

## Architecture Constraints

| Package | Scope | Notes |
|---|---|---|
| `packages/core/` | i18n key only | 1 new key + 3 locale translations |
| `apps/bot/` | Session, helper, scene | Main change — gate + buffer + auto-translate |
| `packages/adapters/ai/` | No changes | AI is simply not called until source lang is set |
| `packages/adapters/db/` | No changes | `pendingWord` is session-only, not persisted |

---

## Edge Cases

| Scenario | Behavior |
|---|---|
| User sends multiple words before picking source lang | Each new word overwrites `pendingWord` — only the latest is translated |
| User picks source lang without pending word | Normal behavior — just sets `nextSourceLang`, no auto-translate |
| Bot restarts while `pendingWord` is set | `pendingWord` is session-only — lost on restart, user re-sends text |
| User has only 2 languages (1 native + 1 learning) | Gate is skipped — auto-detect is used (source lang menu not shown per Task 17) |
| User switches to another mode while word is pending | `pendingWord` stays in session but is harmless — cleared on next `/translate` |
| `handleSourceLangCallback` triggers `handleTranslateText` recursively | Safe: the second call will have `nextSourceLang` set, so it enters the existing translation branch |

---

## Effort Estimate

~3–4 hours

---

## Acceptance Criteria

- [ ] When no source language is selected and user sends text, bot does NOT call AI
- [ ] Bot shows `selectSourceLangFirst` message with the source language inline keyboard
- [ ] After user taps a source language, the buffered word is automatically translated
- [ ] When source language is already set, translation proceeds immediately (no change)
- [ ] Users with only 2 languages (native + 1 learning) bypass the gate (auto-detect works)
- [ ] `pendingWord` is session-only — not persisted to DB
- [ ] All texts use i18n — no hardcoded strings
- [ ] All new and existing tests pass
- [ ] All packages build: `pnpm -r run build`
