# Task 37 — Implement /settings Command

## Goal

The `/settings` command is registered in the bot commands list but has no handler. Implement a full settings scene that lets users change all their language and display configurations.

## Problem Analysis

In `apps/bot/src/index.ts`, the command list includes:
```js
{ command: "settings", description: "Language, notifications, timezone" }
```
But no handler is registered (`bot.command("settings", ...)`). Clicking `/settings` does nothing.

## Requirements

The settings menu must allow changing:

1. **Native language** — change the user's source/native language
2. **Learning languages** — add/remove target languages (1–4, same limit as onboarding)
3. **Interface language** — change the bot UI language (menu lang)
4. **Source language for next translation** — (already handled by inline menu, but should be accessible here too)

### UX Flow

```
/settings
→ Inline keyboard menu:
  🗣 Native language: English    [Change]
  📚 Learning: Czech, Russian    [Change]
  🌐 Interface: English          [Change]
  ❌ Close

Change native → show language picker (same as onboarding step 1)
Change learning → show multi-select (same as onboarding step 2)
Change interface → show language picker

After any change → return to settings menu with updated values
```

## Acceptance Criteria

- [ ] `/settings` command shows current language configuration with Change buttons
- [ ] User can change native language → persisted to `user_language_settings.native_lang`
- [ ] User can add/remove learning languages (1–4 limit enforced) → persisted to `user_language_settings.learning_langs`
- [ ] User can change interface language → persisted to `user_language_settings.interface_lang`
- [ ] All text in settings menu respects current interface language (i18n)
- [ ] After each change, settings menu re-renders with updated values
- [ ] Close button dismisses the menu (delete message or remove keyboard)
- [ ] Add i18n keys for all new settings UI strings in en/ru/cs locales
- [ ] Register `bot.command("settings", ...)` in `index.ts`
- [ ] Register callback handlers for settings buttons (`set:native`, `set:learning`, `set:interface`, `set:close`)

## Dependencies

- Task 36 (onboarding back-nav) — shares language picker patterns; can be done in parallel but should reuse picker helpers

## Effort Estimate

6–8 hours

## Files Likely Affected

- `apps/bot/src/scenes/settings.scene.ts` — **new file**, main settings handler
- `apps/bot/src/scenes/helpers/settings.helper.ts` — **new file**, callback handlers for settings buttons
- `apps/bot/src/index.ts` — register command + callback handlers
- `packages/core/src/modules/i18n/locales/en.json` — new i18n keys
- `packages/core/src/modules/i18n/locales/ru.json` — new i18n keys
- `packages/core/src/modules/i18n/locales/cs.json` — new i18n keys
- `packages/core/src/modules/i18n/types.ts` — new i18n key types
- `packages/adapters/db/src/repositories/user.repository.ts` — may need individual field update methods (e.g. `updateNativeLang`, `updateLearningLangs`, `updateInterfaceLang`)
