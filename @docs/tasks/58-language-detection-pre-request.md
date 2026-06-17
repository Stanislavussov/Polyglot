# Task 58 — Language Detection Pre-Request with Mistype Validation

**Status:** ✅ Done  
**Type:** Feature (UX improvement)  
**Priority:** High — improves translation UX by removing manual source language selection  
**Effort Estimate:** 3–4 hours

---

## Goal

Automatically detect the input language before running the main AI translation. If the language cannot be detected (likely a mistype), show the user a warning with confirm/cancel. This replaces the source language selection menu entirely.

## Problem

Currently when a user sends text in translate mode, the bot:
1. Resolves direction (auto-detects or uses last source)
2. Shows a source language selection menu (`sendSourceLangMenu`)
3. Waits for user to pick a language
4. Only then runs the AI translation

The user wants: bot detects language automatically, warns on mistype, proceeds without asking.

---

## Requirements

### 1. Pre-Request Language Detection

Before the main AI translation call, run `detectLanguage()` against the user's `learningLangs` array only.

**File:** `apps/bot/src/scenes/helpers/translate-mode.helper.ts`  
**Function:** `handleTranslateText()`

At the start of `handleTranslateText()`, after getting user settings:

```typescript
const candidates = learningLangs; // only learningLangs
const detectedLang = detectLanguage(word, candidates);
```

If `detectedLang === undefined` → show mistype warning instead of proceeding.

### 2. Mistype Warning Flow

When `detectLanguage()` returns `undefined`:

1. Reply with warning message + inline keyboard (Confirm / Cancel)
2. Store pending state in `ctx.session`:
   - `ctx.session.pendingDetectedLang = undefined` (signals mistype flow)
   - `ctx.session.pendingWord = word`
   - `ctx.session.pendingDirection = { sourceLang, targetLangs }`
3. Do NOT call the AI translation
4. Do NOT call `sendSourceLangMenu`

**Callback data scheme:**
- `tr:mistype:confirm` — proceed with translation using fallback direction
- `tr:mistype:cancel` — clear pending state, wait for new input

### 3. Handle Confirm Callback

**New function:** `handleMistypeConfirmCallback()` in `translate-mode.helper.ts`

When user confirms:
1. Retrieve `ctx.session.pendingDirection` and `ctx.session.pendingWord`
2. Run `translateOneWithContext()` with the stored direction
3. Show translation result card
4. Clear pending state

### 4. Remove Source Language Selection Menu

Remove all calls to `sendSourceLangMenu()`:

| Location | Line |
| --- | --- |
| `translate.scene.ts` — `handleTranslateCommand()` | ~36 |
| `translate-mode.helper.ts` — `handleSkipCallback()` | ~354 |
| `translate-mode.helper.ts` — `handleSaveCallback()` | ~220 |
| `translate-mode.helper.ts` — `handleRegenCallback()` | ~243 |

Also remove unused exports from `translate-mode.helper.ts`:
- `sendSourceLangMenu`
- `buildLangOptions`

And clean up `translation.renderer.ts` import of `buildSourceLangKeyboard` if no longer used.

### 5. i18n Keys

Add to `packages/core/src/modules/i18n/locales/en.json`, `cs.json`, `ru.json`:

```json
{
  "mistypeWarning": "⚠️ I can't determine the language of \"{word}\". Did you make a typo?",
  "mistypeConfirm": "Yes, translate anyway",
  "mistypeCancel": "Try again"
}
```

Translations (CS/RU — verify with native speaker):
- **CS:** `"mistypeWarning": "⚠️ Nemohu určit jazyk \"{word}\". Neudělal/a jste překlep?"`, `"mistypeConfirm": "Ano, přeložit"`, `"mistypeCancel": "Zkusit znovu"`
- **RU:** `"mistypeWarning": "⚠️ Не удалось определить язык \"{word}\". Это опечатка?"`, `"mistypeConfirm": "Да, перевести"`, `"mistypeCancel": "Попробовать снова"`

---

## Out of Scope

- Grammar checking (future task)
- Changing the detection algorithm itself (`franc` + script heuristics are fine)
- Onboarding flow changes
- Changes to `resolveTranslationDirection()` core logic

---

## Existing Code Reference

| File | Purpose |
| --- | --- |
| `packages/core/src/modules/language-detect/detect-language.ts` | `detectLanguage(text, candidates) → string \| undefined` |
| `packages/core/src/modules/language-detect/resolve-direction.ts` | `resolveTranslationDirection()` — already uses `detectLanguage` internally |
| `apps/bot/src/scenes/helpers/translate-mode.helper.ts` | `handleTranslateText()`, `handleSkipCallback()`, `handleSaveCallback()` |
| `apps/bot/src/scenes/translate.scene.ts` | `/translate` command handler |
| `apps/bot/src/middlewares/mode-router.ts` | Routes messages to `handleTranslateText` |
| `apps/bot/src/renderers/translation.renderer.ts` | `buildSourceLangKeyboard`, `buildPostSaveKeyboard` |
| `packages/core/src/modules/i18n/locales/en.json` | i18n strings |

---

## Session State Additions

```typescript
// In BotSession (types.ts)
interface BotSession {
  // ... existing fields ...
  pendingDetectedLang?: string | undefined; // undefined = mistype flow
  pendingWord?: string;
  pendingDirection?: {
    sourceLang: string;
    targetLangs: string[];
  };
}
```
