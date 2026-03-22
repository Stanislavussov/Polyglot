# Task 17: Post-Translation Source Language Selection Menu

**Status:** ✅ Done

## Description

Implement an **inline keyboard menu** that appears after translation, allowing the user to quickly select the **source language of the next translation**. Instead of relying on auto-detection (Task 16), the user explicitly tells the bot: "I will type in Czech next." The menu shows all languages the user has configured (`nativeLang` + `learningLangs` from `userLanguageSettings` in DB) so the user can tap a language button to pre-set the source language for the next input.

### UX Flow

```
[User types "hello"]
  → Bot shows translation card (EN → RU, CS)

  Bot sends message with inline keyboard:
  Next translation from:
  [ 🇷🇺 Russian ] [ 🇬🇧 English ] [ 🇨🇿 Czech ]

[User taps "🇨🇿 Czech"]
  → Bot confirms: "🔤 Next from: Czech"
  → User types "dům"
  → Bot translates FROM Czech (no auto-detect needed): CS → [RU, EN]

[After Save/Skip, menu appears again:]
  Next translation from:
  [ 🇷🇺 Russian ] [ 🇬🇧 English ] [ ✓ 🇨🇿 Czech ]
```

### Behavior Rules

1. **Menu always visible:** The source language menu is shown after every Save/Skip. The currently selected language button is marked (e.g., with a ✓ prefix). No "Auto" option — the user always sees the full list of their configured languages
2. **No selection yet (first translation):** When no source language has been selected (`nextSourceLang` is null), auto-detection via `resolveTranslationDirection()` (Task 16) is used as a one-time fallback. The menu still appears after Save/Skip so the user can pick the source for the next translation
3. **Explicit source mode:** Once a language is tapped, the next translation uses that language as `sourceLang`. Target languages are determined by the standard logic: if source = native → targets = all learning langs; if source = a learning lang → targets = native + remaining learning langs
4. **Persistence:** The selected source language persists in session (`ctx.session.nextSourceLang`) until the user changes it by tapping another language. It does **not** persist across bot restarts (session-only, not DB)
5. **Overrides auto-detect:** When `nextSourceLang` is set, auto-detection is bypassed entirely — the user's explicit choice is the source language

### Example Scenarios

**User config:** `nativeLang: "ru"`, `learningLangs: ["cs", "en"]`

| Selected source | User types   | sourceLang | targetLangs | Notes                                          |
| --------------- | ------------ | ---------- | ----------- | ---------------------------------------------- |
| None (1st time) | "привет"     | ru (det.)  | [cs, en]    | Fallback auto-detect: Russian → learning langs             |
| None (1st time) | "hello"      | en (det.)  | [ru, cs]    | Fallback auto-detect: English → reversed direction         |
| Czech           | "dům"        | cs         | [ru, en]    | Explicit: Czech → native + other learning langs            |
| Czech           | "ahoj"       | cs         | [ru, en]    | Explicit: Czech source, same direction                     |
| Russian         | "привет"     | ru         | [cs, en]    | Explicit: Russian → all learning langs                     |
| English         | "house"      | en         | [ru, cs]    | Explicit: English → native + remaining learning langs      |

**References:**

- BRD §9 ("✨ Next translation" button — TBD, resolved by this task)
- `docs/tasks/09-translate-session-loop.md` (persistent translate mode)
- `docs/tasks/16-auto-detect-input-language.md` (auto-detect integration)
- `.pi/skills/bot/SKILL.md` (translate-mode helper, renderer)
- `.pi/skills/i18n/SKILL.md` (i18n keys)
- `.pi/skills/db/SKILL.md` (user settings schema)

---

## Root Cause

After Save/Skip in `translate-mode.helper.ts`, the bot sends a plain text hint (`translateModeHint`) with no interactive elements. The user has no way to quickly tell the bot which language they'll type in next — they rely entirely on auto-detection, which may not always be accurate for short inputs or mixed-script words. This creates friction especially when the user wants to practice a specific language and keep typing in it repeatedly.

The `learningLangs` array and `nativeLang` are already stored in `userLanguageSettings` and available via `userRepository.getSettings()`. The data is there — there is just no UI to leverage it for quick source language switching.

---

## Subtasks

### Step 1: Extend session data with nextSourceLang

- [x] In `apps/bot/src/types.ts`:
  - Add `nextSourceLang?: string | null` to `SessionData`
  - `null` or `undefined` means "auto-detect" (default behavior, Task 16)
  - A language code (e.g., `"cs"`) means "next translation source is this language"

### Step 2: Add i18n keys

- [x] In `packages/core/src/modules/i18n/types.ts`:
  - Add new keys:
    - `nextTranslationFrom` — section header (e.g., "Next translation from:")
    - `nextSourceSet` — confirmation when a language is selected (e.g., "🔤 Next from: {lang}")
- [x] Add translations for all locales (en, ru, cs)

### Step 3: Build the source language selection keyboard

- [x] In `apps/bot/src/renderers/translation.renderer.ts` (or a new helper):
  - Implement `buildSourceLangKeyboard(langs: LangOption[], currentSelection: string | null, interfaceLang?: string): InlineKeyboard`
    ```typescript
    interface LangOption {
      code: string;
      name: string; // localized display name
    }
    ```
  - Renders one row of language buttons:
    - One button per language in the user's config (`nativeLang` + `learningLangs`)
    - Each button callback data: `tr:srclang:{code}` (e.g., `tr:srclang:cs`)
    - Currently selected language prefixed with ✓ (e.g., "✓ Czech")
    - No "Auto" button — only concrete languages
  - If the user has only 1 learning language and 1 native language (2 total), do **not** show the menu (only 2 possible sources, auto-detect is sufficient)

### Step 4: Show source language menu after Save/Skip

- [x] In `apps/bot/src/scenes/helpers/translate-mode.helper.ts`:
  - After Save callback: replace plain `translateModeHint` reply with a message that includes:
    1. The hint text (`translateModeHint`)
    2. The `nextTranslationFrom` header
    3. The source language selection inline keyboard
  - After Skip callback: same as Save
  - Fetch user settings to get the list of available languages
  - Use `getLanguageName()` from `@polyglot/core` for localized language display names

### Step 5: Handle source language selection callback

- [x] In `apps/bot/src/scenes/helpers/translate-mode.helper.ts` (or a new helper file):
  - Implement `handleSourceLangCallback(ctx: BotContext): Promise<void>`
  - Parse callback data `tr:srclang:{code}`
  - Set `ctx.session.nextSourceLang = code`
  - Answer callback query with confirmation text (`nextSourceSet`)
  - Update the keyboard in-place to reflect the new selection (mark ✓ on the selected button)
- [x] Register the callback handler in `apps/bot/src/index.ts`:
  - `bot.callbackQuery(/^tr:srclang:/, handleSourceLangCallback)`

### Step 6: Integrate nextSourceLang into translation direction

- [x] In `apps/bot/src/scenes/helpers/translate-mode.helper.ts` → `handleTranslateText()`:
  - If `ctx.session.nextSourceLang` is set and is not `null`:
    - **Skip** `resolveTranslationDirection()` (no auto-detection needed)
    - Set `sourceLang = ctx.session.nextSourceLang`
    - Determine `targetLangs` using standard direction logic:
      - If `sourceLang === nativeLang` → `targetLangs = learningLangs`
      - If `sourceLang` is one of `learningLangs` → `targetLangs = [nativeLang, ...remainingLearningLangs]`
    - No `detectedLang` indicator needed (user explicitly chose the source)
  - If `null` / `undefined` (first translation only): call `resolveTranslationDirection()` as fallback
  - Log the effective direction for observability

### Step 7: Write tests

- [x] `apps/bot/src/renderers/__tests__/source-lang-menu.test.ts`:
  - Renders buttons for each configured language (native + learning langs)
  - Marks currently selected language with ✓
  - No ✓ on any button when nothing is selected yet
  - Does not render menu for single learning language + native (2 total)
  - Callback data format is correct (`tr:srclang:{code}`)
- [x] `apps/bot/src/scenes/helpers/__tests__/source-lang-callback.test.ts`:
  - Tapping a language sets `session.nextSourceLang`
  - Tapping a different language switches `session.nextSourceLang`
  - Confirmation message is sent
  - Keyboard is updated with new ✓ mark
- [x] `apps/bot/src/scenes/helpers/__tests__/translate-mode-source-lang.test.ts`:
  - With `nextSourceLang = "cs"`: sourceLang is Czech, targetLangs = [ru, en]
  - With `nextSourceLang = "ru"`: sourceLang is Russian, targetLangs = [cs, en]
  - With `nextSourceLang = null` (first time): falls back to auto-detect via `resolveTranslationDirection()`
  - Source language menu appears after Save
  - Source language menu appears after Skip
- [x] All new and existing tests pass: `pnpm test` (741 tests, 50 files)

---

## Architecture Constraints

| Package                 | Change scope                                     | Notes                                                                          |
| ----------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------ |
| `packages/core/`        | i18n keys + locale translations                  | New keys: `nextTranslationFrom`, `nextSourceSet` |
| `apps/bot/`             | Session type, helper, renderer, callback handler | Main change — source lang menu UI + session-based source override              |
| `packages/adapters/ai/` | No changes                                       | Translation pipeline unaffected                                                |
| `packages/adapters/db/` | No changes                                       | User settings schema unchanged — `learningLangs` already stored                |

The feature is **fully encapsulated** in the bot layer (session state + UI) with a small i18n addition in core. No DB schema changes needed — the user's language config is already available via `userLanguageSettings.learningLangs` and `nativeLang`. The `nextSourceLang` selection is session-only (non-persistent) by design — it's a quick-switch for the current session, not a permanent setting.

---

## Edge Cases

| Scenario                                        | Behavior                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------- |
| User has only 1 learning language               | Source lang menu is **not shown** — only 2 possible sources, auto-detect is sufficient |
| User selects a language then changes settings    | `nextSourceLang` may become invalid — validate before use, fall back to auto-detect    |
| Session expires / bot restarts                   | `nextSourceLang` resets to `null` — first translation uses auto-detect fallback        |
| User taps a language button from an old message  | Still works — sets `nextSourceLang` based on callback data                             |
| Selected source lang removed from user settings  | Validate: if `nextSourceLang` not in current config, reset to null (auto-detect)       |

---

## Key Risks & Mitigations

| Risk                                                   | Mitigation                                                                                         |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Too many buttons for 4+ languages                      | Max 4 learning langs + 1 native = 5 buttons. Fits in 1–2 rows. If needed, use 2-column grid        |
| `nextSourceLang` stale after settings change           | Validate against current language config before each translation; reset if invalid                   |
| Source language menu adds visual clutter               | Only shown after Save/Skip, not on every translation card. Clean, minimal layout                    |
| Callback data collisions with existing `tr:` callbacks | New prefix `tr:srclang:` is unique, no conflict with `tr:save`, `tr:skip`, `tr:regen:`               |

---

## Acceptance Criteria

- [x] After Save/Skip in translate mode, an inline keyboard with source language buttons always appears
- [x] Tapping a language button sets it as the source language for the next translation
- [x] No "Auto" button — only concrete language choices (native + learning langs)
- [x] The currently selected source language is visually marked (✓ prefix)
- [x] When a source language is explicitly selected, auto-detection is bypassed
- [x] Target languages are correctly derived from the selected source language
- [x] First translation (no selection yet) falls back to auto-detect, menu appears after Save/Skip
- [x] The source language menu is **not** shown when the user has only 1 learning language
- [x] `nextSourceLang` is session-only — does not persist to DB
- [x] All texts use i18n — no hardcoded strings
- [x] All new and existing tests pass: `pnpm test` (741 tests, 50 files)
- [x] All packages build: `pnpm -r run build`

## Files created/modified

- `apps/bot/src/types.ts` — Added `nextSourceLang?: string | null` to `SessionData`
- `apps/bot/src/index.ts` — Registered `handleSourceLangCallback`, added `nextSourceLang` to session initial state
- `apps/bot/src/renderers/translation.renderer.ts` — Added `buildSourceLangKeyboard()` and `LangOption` interface
- `apps/bot/src/scenes/helpers/translate-mode.helper.ts` — Added `handleSourceLangCallback`, `buildLangOptions`, `sendSourceLangMenu`; updated `handleTranslateText` for explicit source, updated Save/Skip to show menu
- `apps/bot/src/renderers/__tests__/source-lang-menu.test.ts` — 8 tests for keyboard rendering
- `apps/bot/src/scenes/helpers/__tests__/source-lang-callback.test.ts` — 7 tests for callback handling
- `apps/bot/src/scenes/helpers/__tests__/translate-mode-source-lang.test.ts` — 11 tests for integration
- `docs/tasks/17-next-translation-language-menu.md` — Updated status and checkboxes
- `.pi/skills/bot/SKILL.md` — Updated Current State, File Structure, Skills
