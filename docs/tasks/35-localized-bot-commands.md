# Task 35 — Localized Bot Command Descriptions

## Goal

Telegram's bot command menu (the "/" menu) currently shows hardcoded English descriptions for all users. Adjust command descriptions to match the user's selected interface language using Telegram's `setMyCommands` with `language_code` scoping and per-user `BotCommandScopeChat`.

## Current State

- `apps/bot/src/index.ts` → `setBotCommands()` calls `bot.api.setMyCommands()` once with English-only descriptions
- 5 commands registered: `start`, `translate`, `dictionary`, `template`, `settings`
- i18n module (`@polyglot/core`) supports 10 languages; locale files exist for `en`, `ru`, `cs`
- User's `interfaceLang` is stored in DB (`userLanguageSettings.interfaceLang`)

## Approach

Telegram Bot API `setMyCommands` accepts an optional `language_code` (IETF) + `scope` parameter:
1. **At startup** — call `setMyCommands` for each language that has a locale file, using the `language_code` parameter. This covers users whose Telegram app language matches a supported locale.
2. **Per-user override** — after onboarding or interface language change, call `setMyCommands` with `BotCommandScopeChat` + the user's chat ID to set descriptions in their chosen Polyglot interface language (which may differ from their Telegram app language).

---

## Acceptance Criteria

- [x] **i18n keys added** — New keys `cmdDescStart`, `cmdDescTranslate`, `cmdDescDictionary`, `cmdDescTemplate`, `cmdDescSettings` added to `I18nKey` type and all 3 locale files (`en.json`, `ru.json`, `cs.json`)
- [x] **Startup: per-language commands** — `setBotCommands()` iterates over all locales that have a file (en, ru, cs) and calls `bot.api.setMyCommands(commands, { language_code })` for each. Default (no `language_code`) set to English as fallback for unsupported locales.
- [x] **Per-user: after onboarding** — After onboarding completes and `interfaceLang` is determined, call `bot.api.setMyCommands(commands, { scope: { type: "chat", chat_id }, language_code })` for the user with their chosen interface language.
- [ ] **Per-user: on language change** — When user changes interface language in settings, update their personal commands via the same `BotCommandScopeChat` mechanism. _(TODO: wire up when settings scene is built — `setUserCommands()` helper is ready)_
- [x] **Helper function** — Extract a reusable `getLocalizedCommands(lang: SupportedLang): BotCommand[]` that returns the 5 commands with descriptions from i18n.
- [x] **Error resilience** — `setMyCommands` failures (network, rate-limit) are logged but do not crash the bot or block startup.
- [x] **Tests** — Unit test for `getLocalizedCommands()` verifying correct i18n resolution for en/ru/cs. Integration test (or existing test update) verifying `setMyCommands` is called with correct scope/language_code parameters.

## Dependencies

- None (i18n module and bot infrastructure already exist)

## Effort Estimate

~3–4 hours

## Files Likely Affected

| File | Change |
|---|---|
| `packages/core/src/modules/i18n/types.ts` | Add 5 new `I18nKey` entries |
| `packages/core/src/modules/i18n/locales/en.json` | Add command description strings |
| `packages/core/src/modules/i18n/locales/ru.json` | Add command description strings |
| `packages/core/src/modules/i18n/locales/cs.json` | Add command description strings |
| `apps/bot/src/index.ts` | Refactor `setBotCommands()` to loop over locales + set default |
| `apps/bot/src/commands/commands.ts` _(new)_ | `getLocalizedCommands()` helper + `setUserCommands()` |
| `apps/bot/src/scenes/onboarding.scene.ts` | Call `setUserCommands()` after onboarding |
| `apps/bot/src/commands/commands.test.ts` _(new)_ | Tests for localized commands |

## Notes

- Telegram `language_code` uses IETF tags (e.g. `"en"`, `"ru"`, `"cs"`), which match our `SupportedLang` codes.
- `setMyCommands` with `BotCommandScopeChat` overrides both the language-based and default command lists for that user — exactly what we want.
- Settings scene doesn't exist yet as a full implementation, so the "on language change" hook may be a TODO wired up when settings is built. Add the helper and document the integration point.
