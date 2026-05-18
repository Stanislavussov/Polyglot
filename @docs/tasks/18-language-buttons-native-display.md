# Task 18: Display Language Buttons with Native Names and Flags

**Status:** 🔲 To Do

## Description

Currently, language selection buttons in the bot UI (onboarding, settings) display languages using their native name and emoji flag via `getLangDisplay()`, which reads from the DB `languages` table. However, the **settings scene** is not yet implemented and the existing buttons should be verified to consistently show the format:

```
🇷🇺 Русский
🇬🇧 English
🇨🇿 Čeština
🇩🇪 Deutsch
```

### Requirements

1. **All language selection keyboards** must display each language as `{flag} {nativeName}` (e.g. `🇷🇺 Русский`, not `🇷🇺 Russian`)
2. **Onboarding steps** (interface lang, native lang, learning langs) — verify buttons use `getLangDisplay(code)` from the DB cache
3. **Settings scene** (when implemented) — language change buttons must use the same format
4. **Translate mode header** — the `translateModeOn` message shows `fromLang` and `toLangs`, these should also use native names with flags
5. **Fallback** — if a language has no flag in the DB (e.g. Latin), show just the native name

### Data Source

All display data comes from the `languages` table (single source of truth):

| Column | Usage |
|--------|-------|
| `flag` | Emoji flag: `🇷🇺`, `🇬🇧` |
| `native_name` | Autonym: `Русский`, `English`, `Čeština` |
| `is_supported` | Which languages appear in selection keyboards |

The `getLangDisplay(code)` function in `@polyglot/adapter-db` already formats this as `"{flag} {nativeName}"`.

### Files to Check / Update

- `apps/bot/src/scenes/onboarding.scene.ts` — language selection keyboards (already updated to use `getLangDisplay`)
- `apps/bot/src/scenes/translate.scene.ts` — translate mode header display
- `apps/bot/src/scenes/settings.scene.ts` — settings language buttons (when implemented)
- `apps/bot/src/renderers/translation.renderer.ts` — regeneration buttons per language
- `packages/adapters/db/src/language-cache.ts` — `getLangDisplay()` implementation

### Acceptance Criteria

- [ ] Onboarding language keyboards show `🇷🇺 Русский` format (not English names)
- [ ] Translate mode `fromLang` / `toLangs` display uses native names with flags
- [ ] Regeneration buttons (`🔄 Čeština`) use native name with flag
- [ ] Languages without a flag (e.g. Latin) display just the native name
- [ ] All display strings come from DB — no hardcoded labels in code

### References

- `docs/tasks/14-language-table-refactor.md` — DB as single source of truth
- `.pi/skills/bot/SKILL.md` — bot scenes and rendering
- `.pi/skills/db/SKILL.md` — language cache API
