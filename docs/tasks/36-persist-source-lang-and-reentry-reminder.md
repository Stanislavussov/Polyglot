# Task 36 — Persist Source Language & Translate Mode Re-entry Reminder

**Status:** 🔲 To Do  
**Type:** Reliability + UX improvement  
**Priority:** Medium-High — prevents loss of source language on restart + gives users context when returning to translate mode  
**Dependencies:** Task 17 (source language menu infrastructure)

---

## Problem

Two related issues with source language handling:

### A. Persistence (reliability)
`nextSourceLang` lives only in grammY's in-memory session. When the bot restarts or the process crashes, every user's source language selection resets to `null` (auto-detect). Users have to re-pick after every deploy.

### B. Re-entry context (UX)
When a user leaves translate mode (e.g. `/settings`, `/template`, `/dictionary`, `/start`) and returns, there's no visual cue that they're back in translate mode or what source language is active. The user loses orientation.

**New behavior:**

1. **Persist:** Add `lastSourceLang` column to `user_language_settings`. Session is the primary source (fast, no DB hit per message); DB is the fallback that survives restarts.
2. **Hydrate:** On first translate after restart, hydrate `nextSourceLang` from DB — lazy, inside `handleTranslateText()`, not in auth middleware.
3. **Remind:** After any non-translate command, the next text message in translate mode shows the source language menu as a non-blocking reminder. `/translate` command always shows the menu.
4. **Pre-select:** The reminder menu pre-selects the last used source language (from session or hydrated from DB).

### Data Flow

```
User taps "🇨🇿 Czech" in source lang menu
  → ctx.session.nextSourceLang = "cs"         (immediate, in-memory)
  → UPDATE user_language_settings SET last_source_lang = 'cs' WHERE user_id = ?
    (fire-and-forget with .catch() error logging)

Bot restarts → session is empty
  → Session init: nextSourceLang = null
  → First message in translate mode:
      nextSourceLang is null → load settings → lastSourceLang = "cs"
      → ctx.session.nextSourceLang = "cs"     (hydrate from DB)
      → proceed with translation using "cs" as source

User runs /settings, then sends text
  → needsTranslateReminder = true (set by /settings)
  → handleTranslateText sees flag → shows source lang menu (non-blocking)
  → translates normally, clears flag
```

---

## UX Flow

### Scenario 1: Bot restart, source lang restored from DB
```
[Bot restarted, session fresh, user sends "dům"]
  → nextSourceLang is null
  → handleTranslateText loads settings → lastSourceLang = "cs"
  → Hydrates ctx.session.nextSourceLang = "cs"
  → Shows reminder menu (needsTranslateReminder = true on fresh session):
    "Отправьте следующее слово или фразу."
    "Следующий перевод с:"
    [ 🇷🇺 Russian ] [ 🇬🇧 English ] [ ✓ 🇨🇿 Czech ]
  → Translates "dům" from Czech (non-blocking reminder)
```

### Scenario 2: User returns from /settings, source lang in session
```
[User used /settings, then sends "casa"]
  → needsTranslateReminder = true (set by /settings handler)
  → nextSourceLang = "es" (still in session)
  → Shows reminder menu with Spanish pre-selected
  → Translates "casa" from Spanish
  → Clears needsTranslateReminder = false
  → Next word: no reminder, just translates
```

### Scenario 3: /translate command
```
[User runs /translate after /dictionary]
  → Bot shows:
    "🔤 Russian → English, Czech"
    "Отправьте следующее слово или фразу."
    "Следующий перевод с:"
    [ ✓ 🇷🇺 Russian ] [ 🇬🇧 English ] [ 🇨🇿 Czech ]
  → Clears needsTranslateReminder = false
```

### Scenario 4: Fresh user, never selected source lang
```
[New user sends "hello" — lastSourceLang is null in DB]
  → nextSourceLang is null, DB lastSourceLang is null
  → Falls through to auto-detect (existing behavior)
  → No pre-selection in menu
```

---

## Subtasks

### Step 1: Add `lastSourceLang` column to schema + migration

- [ ] In `packages/adapters/db/src/schema.ts` → `userLanguageSettings`:
  - Add `lastSourceLang: text("last_source_lang")` — nullable, no default (null = auto-detect / never selected)
- [ ] Generate migration:
  - `cd packages/adapters/db && npx drizzle-kit generate` → expect `0009_*.sql`
  - Migration should be `ALTER TABLE user_language_settings ADD COLUMN last_source_lang text;`
- [ ] Apply migration: `npx drizzle-kit push` or `npx drizzle-kit migrate`

### Step 2: Add repository method to update `lastSourceLang`

- [ ] In `packages/adapters/db/src/repositories/user.repository.ts`:
  - Add `updateLastSourceLang(userId: number, lang: string | null): Promise<void>`
  - Simple UPDATE on `userLanguageSettings` setting `lastSourceLang` + `updatedAt`
- [ ] Ensure `getSettings()` already returns the new column (it does — Drizzle infers from schema)
- [ ] Include `lastSourceLang` in the `updateSettings()` upsert `set` clause so full settings updates don't null it out

### Step 3: Sync to DB on source language selection

- [ ] In `apps/bot/src/scenes/helpers/translate-mode.helper.ts` → `handleSourceLangCallback()`:
  - After `ctx.session.nextSourceLang = code`:
    - Call `userRepository.updateLastSourceLang(ctx.user.id, code)` — fire-and-forget with `.catch(err => logger.error(...))`
  - This keeps the DB in sync without blocking the callback response
- [ ] **Only** persist on explicit user selection (callback). Do NOT persist auto-detected source language — auto-detect can be wrong and would pollute the stored preference.

### Step 4: Hydrate session from DB on first translate (lazy)

Hydration happens in `handleTranslateText()`, NOT in auth middleware. This avoids unnecessary DB reads on non-translate requests.

- [ ] In `apps/bot/src/scenes/helpers/translate-mode.helper.ts` → `handleTranslateText()`:
  - In the existing `else` branch (when `nextSource` is falsy):
    - Before falling back to auto-detect, check `settings.lastSourceLang`
    - If `settings.lastSourceLang` is set:
      - Hydrate `ctx.session.nextSourceLang = settings.lastSourceLang`
      - Use `resolveDirectionFromSource()` with the hydrated value (same as the `if (nextSource)` branch)
    - If `settings.lastSourceLang` is null:
      - Fall through to existing auto-detect behavior (`resolveTranslationDirection()`)
  - This means the DB value is only read once per session (on the first translation after restart), then session takes over

### Step 5: Clear `lastSourceLang` when it becomes invalid

- [ ] In `handleTranslateText()`:
  - When `resolveDirectionFromSource()` returns `null` for the hydrated `lastSourceLang` (language removed from config):
    - Clear both: `ctx.session.nextSourceLang = null` and `userRepository.updateLastSourceLang(ctx.user.id, null)` (fire-and-forget)
    - Fall through to auto-detect
- [ ] In `apps/bot/src/scenes/onboarding.scene.ts`:
  - When onboarding completes (languages may have changed), clear `lastSourceLang` via `updateSettings()` (already includes it after Step 2)

### Step 6: Add `needsTranslateReminder` session flag

- [ ] In `apps/bot/src/types.ts`:
  - Add `needsTranslateReminder?: boolean` to `SessionData`
- [ ] In `apps/bot/src/index.ts`:
  - Initialize `needsTranslateReminder: true` in session defaults (first message always shows menu)
- [ ] In command handlers that take the user out of translate flow:
  - `/start` (`apps/bot/src/commands/start.ts`): set `ctx.session.needsTranslateReminder = true`
  - `/template` (`apps/bot/src/scenes/template.scene.ts`): set `ctx.session.needsTranslateReminder = true`
  - Any future commands (`/settings`, `/dictionary`) when implemented: same pattern

### Step 7: Show reminder menu on `/translate` command

- [ ] In `translate-mode.helper.ts`:
  - Export `sendSourceLangMenu` (currently `async function sendSourceLangMenu` — needs `export`)
- [ ] In `handleTranslateCommand()` (`apps/bot/src/scenes/translate.scene.ts`):
  - After the existing confirmation message (`translateModeOn`), call:
    ```ts
    await sendSourceLangMenu(ctx, settings, lang);
    ```
  - Set `ctx.session.needsTranslateReminder = false` (user just saw the menu)

### Step 8: Show non-blocking reminder on text after other commands

- [ ] In `handleTranslateText()` (`translate-mode.helper.ts`):
  - At the top, after resolving settings but before translation logic:
    - If `ctx.session.needsTranslateReminder === true` **and** `nextSourceLang` is set:
      - Show reminder menu via `sendSourceLangMenu(ctx, settings, lang)` — non-blocking
      - Set `ctx.session.needsTranslateReminder = false`
      - Proceed with translation normally (do NOT return early)
    - If `ctx.session.needsTranslateReminder === true` **and** `nextSourceLang` is null:
      - This is handled by Step 4 (hydration) or Task 29 (gate). Set flag to `false`.
    - If `false` / undefined: proceed normally (no reminder)

### Step 9: Write tests

- [ ] `packages/adapters/db/src/__tests__/user.repository.test.ts` (extend):
  - `updateLastSourceLang()` persists value
  - `updateLastSourceLang(userId, null)` clears value
  - `getSettings()` returns `lastSourceLang`
  - `updateSettings()` does not null out `lastSourceLang` when not provided
- [ ] `apps/bot/src/scenes/helpers/__tests__/translate-mode-source-lang.test.ts` (extend):
  - **Session has nextSourceLang:** uses session value, does not read DB — existing behavior
  - **Session empty + DB has lastSourceLang:** hydrates from DB, translates with that source
  - **Session empty + DB has lastSourceLang that is invalid:** clears both session and DB, falls back to auto-detect
  - **Session empty + DB lastSourceLang is null:** falls back to auto-detect — existing behavior
  - **Source lang callback:** writes to both session and DB
  - **DB write failure on callback:** translation still works (fire-and-forget)
- [ ] `apps/bot/src/scenes/helpers/__tests__/translate-mode-reminder.test.ts` (new):
  - **/translate command shows source lang menu** with pre-selected language
  - **Text after /start shows reminder menu** (non-blocking) before translating
  - **Text after /template shows reminder menu** before translating
  - **Consecutive translations don't show reminder** (flag is false)
  - **2-language users: no source lang keyboard** (existing behavior preserved)

---

## Files Affected

| File | Change |
|---|---|
| `packages/adapters/db/src/schema.ts` | Add `lastSourceLang` column to `userLanguageSettings` |
| `packages/adapters/db/drizzle/0009_*.sql` | Generated migration |
| `packages/adapters/db/src/repositories/user.repository.ts` | Add `updateLastSourceLang()`, update `updateSettings()` set clause |
| `packages/adapters/db/src/__tests__/user.repository.test.ts` | New test cases for `updateLastSourceLang` |
| `apps/bot/src/types.ts` | Add `needsTranslateReminder` to `SessionData` |
| `apps/bot/src/index.ts` | Initialize `needsTranslateReminder` in session defaults |
| `apps/bot/src/scenes/helpers/translate-mode.helper.ts` | Export `sendSourceLangMenu`, hydrate from DB, reminder check, fire-and-forget sync |
| `apps/bot/src/scenes/translate.scene.ts` | Show source lang menu on `/translate`, clear reminder flag |
| `apps/bot/src/commands/start.ts` | Set `needsTranslateReminder = true` |
| `apps/bot/src/scenes/template.scene.ts` | Set `needsTranslateReminder = true` |
| `apps/bot/src/scenes/onboarding.scene.ts` | Clear `lastSourceLang` on re-onboard |
| `apps/bot/src/scenes/helpers/__tests__/translate-mode-source-lang.test.ts` | New persistence test cases |
| `apps/bot/src/scenes/helpers/__tests__/translate-mode-reminder.test.ts` | New reminder test file |

---

## Architecture Constraints

| Package | Scope | Notes |
|---|---|---|
| `packages/adapters/db/` | Schema + migration + repository | 1 new column, 1 new method, updateSettings protection |
| `apps/bot/` | Session, helpers, commands, scenes | Hydrate + sync + reminder flag + menu display |
| `packages/core/` | No changes | Existing i18n keys sufficient |
| `packages/adapters/ai/` | No changes | Translation logic untouched |

---

## Design Decisions

| Decision | Rationale |
|---|---|
| **Lazy hydration in `handleTranslateText()`** (not auth middleware) | Avoids unnecessary DB reads on `/settings`, `/template`, etc. Only pay the cost when actually translating. |
| **Only persist explicit selections** (not auto-detect results) | Auto-detect can be wrong — persisting a wrong guess would pollute the stored preference. |
| **Fire-and-forget DB writes** with `.catch(logger.error)` | Don't block the UX. Session is the source of truth during the session; DB is only the restart-survival fallback. |
| **`updateSettings()` must not null out `lastSourceLang`** | Other flows (onboarding, settings changes) call `updateSettings()` without knowing about `lastSourceLang` — must not accidentally erase it. |
| **Reminder is non-blocking** | When source lang IS set, show the menu but translate immediately. Don't force users to interact with the menu every time. |
| **`needsTranslateReminder` is session-only** | Ephemeral flag — no DB persistence needed. Defaults to `true` on fresh session, which is the correct behavior after restart. |

---

## Interaction with Task 29

Task 29 handles the **blocking gate**: `nextSourceLang` is null AND `lastSourceLang` is null → must pick language before translating, buffer word.

This task reduces how often Task 29's gate fires by hydrating from DB. When `lastSourceLang` exists in DB, it's loaded into session before Task 29's check runs. The gate only fires for truly new users or users who never explicitly selected a source language.

If Task 29 is not yet implemented, this task still works — the `else` branch in `handleTranslateText()` falls through to auto-detect as today, but now with DB hydration first.

---

## Edge Cases

| Scenario | Behavior |
|---|---|
| Bot restarts, user sends text | Hydrates `nextSourceLang` from `lastSourceLang` in DB — seamless |
| DB write fails on callback | Logged, session still works — next restart will use stale/null value |
| User re-onboards with different languages | `lastSourceLang` cleared — fresh start |
| `lastSourceLang` points to a removed language | `resolveDirectionFromSource()` returns null → clear both session + DB, fall back to auto-detect |
| User never picked a source lang (new user) | `lastSourceLang` is null → auto-detect as today |
| Multiple rapid source lang changes | Each callback overwrites — last write wins, which is correct |
| `updateSettings()` called without `lastSourceLang` field | Must NOT null it out — only update when explicitly provided |
| User has only 2 languages | Source lang menu returns null → only hint text shown, no keyboard |
| User runs `/translate` twice in a row | Both show menu (harmless, consistent) |
| Reminder + translation in same message | Non-blocking: menu sent first, translation follows immediately |

---

## Effort Estimate

~4–5 hours

---

## Acceptance Criteria

- [ ] `user_language_settings` has a nullable `last_source_lang` text column
- [ ] Migration generated and applied cleanly
- [ ] Selecting a source language via inline keyboard persists choice to DB (fire-and-forget)
- [ ] After bot restart, first translation uses DB `lastSourceLang` as fallback (lazy hydration in `handleTranslateText`)
- [ ] Session value always takes priority over DB when present
- [ ] Invalid `lastSourceLang` (removed language) is auto-cleared from both session and DB
- [ ] `updateSettings()` does not accidentally null out `lastSourceLang`
- [ ] Re-onboarding clears `lastSourceLang`
- [ ] `/translate` command shows source language menu with pre-selected last language
- [ ] After `/start`, `/template`, or other commands, next text shows the reminder menu (non-blocking)
- [ ] Consecutive translations don't show reminder (flag cleared after first)
- [ ] Pre-selection works: last used source language has `✓` prefix in keyboard
- [ ] 2-language users don't see source lang keyboard (existing behavior preserved)
- [ ] Auto-detected source language is NOT persisted to DB
- [ ] All i18n — no hardcoded strings
- [ ] All new and existing tests pass
- [ ] All packages build: `pnpm -r run build`
