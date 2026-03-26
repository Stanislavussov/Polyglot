# Task 25: Show Language Emoji Flag from DB in Translation Card

**Status:** 🔲 To Do

## Description

The `languages` table already stores emoji flags (`flag` column: 🇬🇧, 🇷🇺, 🇨🇿) and helpers `getLangFlag(code)` / `getLangDisplay(code)` exist in both `@polyglot/core` (language registry) and `@polyglot/adapter-db` (language cache). However, the translation card renderer ignores them — it uses a hardcoded `🔤` prefix for every language block.

**Current output:**
```
🐘 слонопотам
Регистр: colloquial

🔤 EN: efalump
   ∙ great big imaginary elephant (colloquial) — elephantine being (literary)
   ...
🔤 CS: sloní mládě
   ∙ bájný slon (literary) — pohádkový slon (neutral)
   ...
```

**Desired output:**
```
🐘 слонопотам
Регистр: colloquial

🇬🇧 EN: efalump
   ∙ great big imaginary elephant (colloquial) — elephantine being (literary)
   ...
🇨🇿 CS: sloní mládě
   ∙ bájný slon (literary) — pohádkový slon (neutral)
   ...
```

**References:**
- `docs/tech-reqs/02-architecture.md` (layer separation)
- `docs/tasks/18-language-buttons-native-display.md` (related: native names in UI)
- `docs/tasks/14-language-table-refactor.md` (language table as SSOT)

---

## Current State

| Component | Has flag data? | Uses it? |
|---|---|---|
| `languages` table (`packages/adapters/db/src/schema.ts`) | ✅ `flag` column with emoji | — |
| Language registry (`packages/core/src/modules/i18n/language-registry.ts`) | ✅ `getLangFlag(code)`, `LanguageEntry.flag` | Only used by `getLangDisplay()` for settings menus |
| Language cache (`packages/adapters/db/src/language-cache.ts`) | ✅ `getLangFlag(code)` mirror | Same — not used in cards |
| Translation renderer (`apps/bot/src/renderers/translation.renderer.ts`) | ❌ Hardcoded `🔤` in `renderLangBlock()` | **Gap** |
| Topic word renderer (`renderTopicWord` in same file) | ❌ Hardcoded `🔤` | Same gap |

---

## Subtasks

### Step 1: Use `getLangFlag` in the translation card renderer

Replace the hardcoded `🔤` with the actual emoji flag from the language registry.

- [ ] In `apps/bot/src/renderers/translation.renderer.ts`:
  - Import `getLangFlag` from `@polyglot/core`
  - In `renderLangBlock()`, replace:
    ```typescript
    // before
    lines.push(`🔤 ${esc(code.toUpperCase())}: ${header}`);
    // after
    const flag = getLangFlag(code) ?? "🔤";
    lines.push(`${flag} ${esc(code.toUpperCase())}: ${header}`);
    ```
  - Graceful fallback: if the language has no flag in the DB, keep `🔤` as default
- [ ] Apply the same change to `renderTopicWord()`:
  ```typescript
  // before
  lines.push(`🔤 ${esc(code.toUpperCase())}: ${header}`);
  // after
  const flag = getLangFlag(code) ?? "🔤";
  lines.push(`${flag} ${esc(code.toUpperCase())}: ${header}`);
  ```
- [ ] Update tests in `apps/bot/src/__tests__/translation.renderer.test.ts`:
  - Mock `getLangFlag` to return emoji flags for test language codes
  - Assert that the rendered output contains the flag emoji instead of `🔤`
  - Assert fallback to `🔤` when `getLangFlag` returns `undefined`

### Step 2: Ensure flag data is populated for all supported languages

Verify that every supported language in the DB has a `flag` value. If any are missing, add a migration or seed script to fill them.

- [ ] Run a query to check for supported languages with null/empty `flag`:
  ```sql
  SELECT code, name, flag FROM languages WHERE is_supported = true AND (flag IS NULL OR flag = '');
  ```
- [ ] If gaps exist, create a data migration in `packages/adapters/db/src/migrations/` to populate missing flags
- [ ] Common flags to ensure:
  | Code | Flag |
  |------|------|
  | en   | 🇬🇧  |
  | ru   | 🇷🇺  |
  | cs   | 🇨🇿  |
  | de   | 🇩🇪  |
  | fr   | 🇫🇷  |
  | es   | 🇪🇸  |
  | it   | 🇮🇹  |
  | pt   | 🇵🇹  |
  | uk   | 🇺🇦  |
  | pl   | 🇵🇱  |
  | ja   | 🇯🇵  |
  | zh   | 🇨🇳  |
  | ko   | 🇰🇷  |
  | tr   | 🇹🇷  |

---

## Architecture Constraints

| Package | Change scope | Notes |
|---|---|---|
| `apps/bot/src/renderers/` | Use `getLangFlag()` instead of hardcoded `🔤` | Import from `@polyglot/core` (already a dependency) |
| `packages/core/` | No changes needed | `getLangFlag` already exported |
| `packages/adapters/db/` | Possibly: data migration if flags are missing | Schema unchanged |

---

## Files Modified

- `apps/bot/src/renderers/translation.renderer.ts` — replace `🔤` with `getLangFlag(code)` in `renderLangBlock()` and `renderTopicWord()`
- `apps/bot/src/__tests__/translation.renderer.test.ts` — update assertions for flag emoji
- `packages/adapters/db/src/migrations/` — (conditionally) data migration for missing flags

---

## Dependencies

- None — `getLangFlag` already exists and is exported from `@polyglot/core`
- Language registry must be initialized at boot (already the case)

**Estimated Effort:** 1–2 hours

---

## Key Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Language registry not initialized when renderer runs | Already initialized at bot startup; `getLangFlag` returns `undefined` → falls back to `🔤` |
| Some languages have no flag in DB | Fallback to `🔤`; Step 2 fills gaps for all supported languages |
| Emoji flag rendering on older Telegram clients | Emoji flags are standard Unicode; supported by all modern clients |

---

## Acceptance Criteria

- [ ] Translation card shows emoji flag (🇬🇧, 🇨🇿, etc.) from the `languages` table instead of hardcoded `🔤`
- [ ] Topic word card (`renderTopicWord`) also uses the flag from DB
- [ ] When a language has no flag in DB, `🔤` is shown as fallback
- [ ] All supported languages in the DB have non-null `flag` values
- [ ] Existing tests updated and passing: `pnpm test`
- [ ] All packages build: `pnpm -r run build`
