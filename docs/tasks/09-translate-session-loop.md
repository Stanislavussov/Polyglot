# Task 09: Translation Session Loop (Persistent Translate Mode)

**Status:** 🔲 To Do

## Description

Currently the translate scene exits after each single word translation. After the user taps Save or Skip, the grammY conversation ends and the bot returns to idle state. To translate another word the user must explicitly select `/translate` again — high friction for vocabulary study sessions.

Implement a **persistent mode** system: when the user sends `/translate`, the bot enters **translate mode**. From that point on, **every new text message** the user sends is automatically treated as a word to translate — no need to re-enter `/translate`. The mode persists until the user explicitly switches to another mode by sending a different command (e.g., `/mentor`, `/dictionary`, `/settings`).

This establishes a general **active mode** pattern for the bot:
- `/translate` → translate mode (every message = word to translate)
- `/mentor` → mentor mode _(future — not part of this task)_
- Other mode commands follow the same pattern

The user always has exactly one active mode. Sending a mode-switching command changes the active mode. Non-mode commands (e.g., `/help`, `/start`) do not change the active mode — they execute and the user stays in the current mode.

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

Additionally, the bot has no concept of a **persistent active mode** — each command is a one-shot interaction. The user must consciously navigate back to the desired feature every time.

---

## Subtasks

### Step 1: Implement active mode tracking in session

- [ ] Define a `UserMode` type (e.g. `"translate" | "idle"`) — extensible for future modes like `"mentor"`
- [ ] Store the user's current active mode in the grammY session data (or equivalent state)
  - Default mode for new users / after `/start`: `"idle"` (or directly `"translate"` — TBD)
- [ ] When the user sends `/translate`, set active mode to `"translate"` and confirm with a message
- [ ] When the user sends another mode command (e.g., future `/mentor`), switch active mode accordingly
- [ ] Non-mode commands (`/help`, `/start`, `/settings`) do **not** change the active mode

### Step 2: Add i18n keys

- [ ] In `packages/core/src/modules/i18n/types.ts`:
  - Add new keys to the i18n key enum/type:
    - `translateModeOn` — confirmation when entering translate mode (e.g. "Translate mode on. Send me a word or phrase to translate.")
    - `translateModeHint` — short reminder shown after Save/Skip (e.g. "Send the next word to translate.")
- [ ] In locale files (`packages/core/src/modules/i18n/locales/en.json`, `ru.json`, `cs.json`):
  - Add translations for the new keys:
    ```json
    {
      "translateModeOn": "🔤 Translate mode — send me a word or phrase to translate.",
      "translateModeHint": "Send the next word or phrase."
    }
    ```

### Step 3: Route plain text messages through active mode

- [ ] Add a middleware / message handler that intercepts **all plain text messages** (non-command):
  - Check the user's current active mode
  - If mode is `"translate"` → run the translation pipeline on the message text (same logic as current translate scene, but triggered by the message itself)
  - If mode is `"idle"` → respond with a hint to pick a mode (e.g., "Send /translate to start translating")
  - If mode is a future mode (e.g., `"mentor"`) → route to that handler
- [ ] After translation result is shown with Save/Skip, the bot does **not** exit any scene — the user remains in translate mode. The next plain text message will trigger another translation automatically.

### Step 4: Refactor translate scene → translate mode handler

- [ ] The current `translate.scene.ts` conversation-based scene should be refactored:
  - `/translate` command → sets active mode to `"translate"`, sends confirmation message
  - Plain text in translate mode → runs translation pipeline, shows result with Save/Skip
  - Save/Skip callback → saves or skips the word, optionally shows `translateModeHint`
  - No grammY conversation loop needed — mode persistence is session-based, not conversation-based
- [ ] Extract translation handler logic into `apps/bot/src/scenes/helpers/translate-mode.helper.ts` if the file exceeds 100 lines

### Step 5: Write tests

- [ ] Test: send `/translate` → mode is set, confirmation message shown
- [ ] Test: send a word while in translate mode → translation pipeline runs, result shown
- [ ] Test: send multiple words in succession → each triggers a translation (no re-entering `/translate`)
- [ ] Test: send `/settings` while in translate mode → settings open, mode remains `"translate"`
- [ ] Test: send a future mode command (mock `/mentor`) → mode switches away from `"translate"`
- [ ] Test: send text while in `"idle"` mode → hint message shown
- [ ] Test: Save/Skip callbacks work correctly within translate mode
- [ ] All new and existing tests pass: `pnpm test`

---

## Architecture Constraints

| Package                 | Change scope                                  | Notes                                                       |
| ----------------------- | --------------------------------------------- | ----------------------------------------------------------- |
| `packages/core/`        | i18n keys + locale translations               | New keys: `translateModeOn`, `translateModeHint`            |
| `apps/bot/`             | Active mode tracking, text routing, refactor   | Main change — session-based mode + message routing middleware |
| `packages/adapters/ai/` | No changes                                    | Translation pipeline unaffected                              |
| `packages/adapters/db/` | No changes                                    | Save logic unchanged                                         |

The mode system is **fully encapsulated** in the bot layer — no upstream modules need changes. The translation pipeline, DB save, and validation all work exactly as before. The active mode pattern is designed to be extensible: adding `/mentor` in the future means adding a new mode value and a corresponding message handler — no structural changes.

---

## Files Created/Modified

- `packages/core/src/modules/i18n/types.ts` — add `translateModeOn`, `translateModeHint` keys
- `packages/core/src/modules/i18n/locales/en.json` — add English translations
- `packages/core/src/modules/i18n/locales/ru.json` — add Russian translations
- `packages/core/src/modules/i18n/locales/cs.json` — add Czech translations
- `apps/bot/src/session.ts` (or equivalent) — add `activeMode` field to session data with `UserMode` type
- `apps/bot/src/middleware/mode-router.ts` — **new** — middleware that routes plain text to the active mode handler
- `apps/bot/src/scenes/translate.scene.ts` — refactor from conversation-based scene to mode-based handler
- `apps/bot/src/scenes/helpers/translate-mode.helper.ts` — **new** (if 100-line limit exceeded)
- `apps/bot/src/scenes/__tests__/translate-mode.test.ts` — **new** — tests for persistent mode behavior

---

## Key Risks & Mitigations

| Risk                                                   | Mitigation                                                                                           |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Scene/handler exceeds 100-line limit                   | Extract handler body to `helpers/translate-mode.helper.ts`                                           |
| User forgets which mode they are in                    | Show mode confirmation on `/translate`; optionally show mode indicator in responses                   |
| Middleware intercepts messages meant for other handlers | Mode router only handles plain text — commands (`/...`) are processed by their own handlers first    |
| Adding new modes requires changes everywhere           | Mode is a simple enum; router is a switch — adding a mode = one new case + one handler               |
| Session lost / mode resets unexpectedly                | Persist `activeMode` in session storage (same as other session data); default to `"idle"` on reset   |

---

## Acceptance Criteria

- [ ] Sending `/translate` activates translate mode and shows a confirmation message
- [ ] While in translate mode, every plain text message is automatically treated as a word/phrase to translate — no need to re-enter `/translate`
- [ ] After Save/Skip, the user remains in translate mode — the next text message triggers another translation
- [ ] Sending a different mode command (e.g., future `/mentor`) switches the active mode away from translate
- [ ] Non-mode commands (`/help`, `/settings`, `/start`) execute normally without changing the active mode
- [ ] In `"idle"` mode (no mode selected), plain text shows a hint to pick a mode
- [ ] The `UserMode` type is extensible — adding future modes requires only a new enum value + handler
- [ ] All texts use i18n — no hardcoded strings
- [ ] Translate handler stays within the 100-line limit (or helper is extracted)
- [ ] All new and existing tests pass: `pnpm test`
- [ ] All packages build: `pnpm -r run build`
