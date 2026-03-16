# Task 09: Translation Session Loop (Stay in Translate Mode)

**Status:** 🔲 To Do

## Description

Currently the translate scene exits after each single word translation. After the user taps Save or Skip, the grammY conversation ends and the bot returns to idle state. To translate another word the user must explicitly select `/translate` again — high friction for vocabulary study sessions.

Implement a **session loop**: after Save/Skip, prompt for the next word instead of exiting. Provide an explicit **"Done"** inline button as an escape hatch so the user can leave translation mode when finished.

**References:**

- `tech-reqs/14-agents.md` (agent contracts — bot scene rules)
- BRD §6.1 (translation is a core loop)
- BRD §9 ("✨ Next translation" button — open question, resolved by this task)

---

## Root Cause

The translate scene in `apps/bot/src/scenes/translate.scene.ts` is structured as a linear conversation:

1. Ask for a word
2. Call translation pipeline
3. Show result with Save / Skip buttons
4. Handle button tap → conversation ends

There is no loop — once the user acts on the result, the conversation exits and the bot returns to the main menu. For active vocabulary building, users want to translate many words in quick succession without navigating back to `/translate` each time.

---

## Subtasks

### Step 1: Add i18n keys for the translation loop

- [ ] In `packages/core/src/modules/i18n/types.ts`:
  - Add new keys to the i18n key enum/type:
    - `translateAnother` — prompt text shown after Save/Skip (e.g. "Send the next word to translate, or tap Done to exit")
    - `doneTranslating` — label for the "Done" inline button
- [ ] In locale files (`packages/core/src/modules/i18n/locales/en.json`, `ru.json`, `cs.json`):
  - Add translations for `translateAnother` and `doneTranslating`:
    ```json
    {
      "translateAnother": "Send the next word or tap Done to finish.",
      "doneTranslating": "✅ Done"
    }
    ```

### Step 2: Wrap the translate scene in a session loop

- [ ] In `apps/bot/src/scenes/translate.scene.ts`:
  - Wrap the core flow (ask word → translate → show result → Save/Skip) inside a `while (true)` loop
  - After Save/Skip is handled, show a prompt with:
    - Text: `t("translateAnother", lang)`
    - Inline keyboard with a single **"Done"** button (`t("doneTranslating", lang)`)
  - Wait for user input:
    - If user sends text → treat as the next word, continue the loop
    - If user taps "Done" → break the loop, exit conversation
  - Handle `/start` or `/stop` text mid-loop — break and exit gracefully (avoid freezing the user in the conversation)

### Step 3: Extract loop helper if scene exceeds 100 lines

- [ ] If the translate scene exceeds the 100-line limit (per bot agent rules):
  - Create `apps/bot/src/scenes/helpers/translate-loop.helper.ts`
  - Extract the loop body (translate → render → Save/Skip → prompt) into a reusable function
  - Keep the scene file as a thin wrapper that calls the helper in a loop

### Step 4: Write tests

- [ ] Update or create tests for the translate scene:
  - Test single translation → Done → conversation exits
  - Test multiple translations in a row → Done → conversation exits
  - Test user sends `/start` mid-loop → conversation exits gracefully
  - Test "Done" button callback is handled correctly
- [ ] If helper was extracted, test the helper function independently

---

## Architecture Constraints

| Package                 | Change scope                     | Notes                                       |
| ----------------------- | -------------------------------- | ------------------------------------------- |
| `packages/core/`        | i18n keys + locale translations  | Two new keys: `translateAnother`, `doneTranslating` |
| `apps/bot/`             | Translate scene loop logic       | Main change — wrap in `while(true)`         |
| `packages/adapters/ai/` | No changes                       | Translation pipeline unaffected             |
| `packages/adapters/db/` | No changes                       | Save logic unchanged                        |

The loop is **fully encapsulated** in the bot layer — no upstream modules need changes. The translation pipeline, DB save, and validation all work exactly as before.

---

## Files Created/Modified

- `packages/core/src/modules/i18n/types.ts` — add `translateAnother`, `doneTranslating` keys
- `packages/core/src/modules/i18n/locales/en.json` — add English translations
- `packages/core/src/modules/i18n/locales/ru.json` — add Russian translations
- `packages/core/src/modules/i18n/locales/cs.json` — add Czech translations
- `apps/bot/src/scenes/translate.scene.ts` — wrap flow in `while(true)` loop with Done escape
- `apps/bot/src/scenes/helpers/translate-loop.helper.ts` — **new** (only if 100-line limit exceeded)
- `apps/bot/src/scenes/__tests__/translate.scene.test.ts` — add/update loop tests

---

## Key Risks & Mitigations

| Risk                                              | Mitigation                                                                                           |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Scene exceeds 100-line limit                      | Extract loop body to `helpers/translate-loop.helper.ts`                                              |
| `/start` mid-loop freezes user in conversation    | Detect `/start`, `/stop` commands and break the loop gracefully                                      |
| Infinite loop if user goes silent                 | "Done" button present on every prompt; grammY conversation timeout handles abandoned sessions         |
| Conversation state grows with long sessions       | Each iteration is independent — no accumulation of state across loop cycles                          |

---

## Acceptance Criteria

- [ ] After Save/Skip, the bot prompts for the next word instead of exiting
- [ ] A "Done" inline button is shown after each translation, allowing the user to exit
- [ ] Tapping "Done" exits the translate scene and returns to idle/main menu
- [ ] Sending a new word after Save/Skip immediately starts the next translation (no need to re-enter `/translate`)
- [ ] `/start` or `/stop` sent mid-loop exits the conversation gracefully
- [ ] All texts use i18n — no hardcoded strings
- [ ] Translate scene stays within the 100-line limit (or helper is extracted)
- [ ] All new and existing tests pass: `pnpm test`
- [ ] All packages build: `pnpm -r run build`
