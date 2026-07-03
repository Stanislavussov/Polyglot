# Task 70 — Unrecognized-Word Guard: Stop Fabricating Cards for Non-Existent Words

**Status:** ✅ Implemented
**Category:** Bug / Robustness
**Created:** 2026-07-03

---

## Incident

User (standa55, Telegram ID 368249477) sent the non-existent Czech word **"stroha" / "Stroha"** — a diacritic-stripped typo for the real word **"strohá"** (fem. of *strohý*). The bot confidently produced a fully fabricated card and saved it to the dictionary:

```
🌾 🇨🇿 Stroha (tříska, stéblo, pleva)
🇷🇺 RU: пустосло́вие (болтовня́, пустопоро́жняя речь)
💡 [invented usage note]
🇬🇧 EN: a dry husk (a dried shell, a withered casing)
💡 / ℹ️ [invented notes]
```

Observed in production 2026-07-02 19:56 UTC and 2026-07-03 05:08 UTC (right after a successful translation of the real word "strohá"). Production at the time was running **without** commit `62ff388` (force AI preflight on dictionary misses), so the typo was never challenged.

---

## Root Cause

Two layers failed together:

1. **Input layer — fixed on `develop`, pending deploy.** Preflight was skipped when language detection confidence was high, so a dictionary miss on the input word never triggered typo analysis. `62ff388` forces the AI preflight on any dictionary miss, and the preflight prompt explicitly treats missing diacritics as typos (its example is literally "stroha" → "strohá"). **Needs merge to `master` to reach prod.**

2. **No guard downstream of preflight — unfixed.** Preflight is an LLM judgment and can wrongly say "proceed"; the user can also explicitly pick "translate as written" (Task 69, decision 4). In both cases the main translation stage receives a non-word and, because the prompt only asks for translations and never asks whether the source word actually **exists**, the model fabricates senses, synonyms, and notes. Downstream everything fails open:
   - the language validator is a **no-op** (franc-min proved unreliable and was removed);
   - the semantic validator only catches trivial patterns (empty / placeholder / echo);
   - the entry is persisted unmarked into `vocabularyEntries` / `vocabularyTranslations`;
   - the daily-notification picker and SRS happily re-serve the fabricated word later.

---

## Goal

For a single-word input that is not a recognized word in the detected source language, the bot must **never** present a confident fabricated card. It must either:

- (a) offer the typo correction ("stroha" → "strohá"), or
- (b) reply that the word was not recognized (with "translate as written" as an explicit escape hatch), or
- (c) — only after the user insists on translating as written — translate with a **visible caveat**, and such an entry must be flagged **unverified** and excluded from notifications/SRS suggestions.

---

## Product Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Detection engine | Extend the **main translation call**: the model must assess whether the source headword is a real word in the source language before translating (new field in the output schema). No extra AI call. |
| 2 | Unrecognized + no override | Distinct "unrecognized word" reply: explain in `nativeLang`, offer any confident correction as a button plus "➡️ Translate as written". Reuses the Task 69 confirmation UI. |
| 3 | User overrides ("translate as written") | Translate anyway, but the card carries a caveat line (e.g. "⚠️ not found in standard dictionaries — translated literally"). |
| 4 | Persistence | Entries produced via the override/unrecognized path are saved with an `unverified` flag. Unverified entries are **excluded** from daily notifications and SRS word suggestions. |
| 5 | Preflight interplay | Preflight stays the primary typo gate; the existence assessment is defense-in-depth for preflight false-"proceed"s. One shared notion of "recognized word" — no contradictory copy. |
| 6 | Telemetry | Counter `bot_unrecognized_word_total{outcome}` — outcome ∈ `correction_offered` / `translated_as_written` / `rejected`. |

---

## Relation to Task 37 / Translation Quality Program

This task only guards the "word does not exist" case. The same incident also shows the broader failure: the fabricated card was **internally incoherent** (Czech synonyms about straw, RU block about empty talk, EN block about husks — three unrelated senses), and nothing would catch that even for a real word. That semantic/consistency layer is **Task 37 (Lite AI Translation Validator)** and the Translation Quality Program — the "Stroha" incident is direct evidence for finishing Task 37's wiring, and cross-language block consistency (native synonyms vs each target block) should be part of its scoring rubric.

---

## Non-Goals

- No local spell-checker / Levenshtein dependency (same posture as Task 69)
- No semantic correctness / cross-language consistency validation of card content — that is Task 37's scope (see above)
- No re-validation or cleanup of already-persisted entries (separate backfill task if needed)
- No changes to mentor mode, `/review`, `/flashcard`, video vocabulary
- Not a replacement for the removed language validator's translation-direction checks

---

## Implementation Surface

- `packages/core/src/modules/translation/schema.builder.ts` / translate output types — source-word existence assessment field
- `packages/core/src/modules/translation/prompt.builder.ts` — instruct the model to assess headword existence; forbid inventing senses for unknown words
- `packages/core/src/modules/translation/translation.service.ts` — branch on the assessment: unrecognized → clarification-style outcome (reuse Task 69 plumbing); honor the as-written flag
- `packages/core/src/modules/translation/validation.service.ts` — remove/repurpose the no-op language validator so the stage honestly reflects what is checked
- `packages/adapters/db/src/schema.ts` — `unverified` flag on vocabulary entries (`pnpm db:generate` + `pnpm db:push`)
- `apps/bot/src/scenes/helpers/translate-mode.helper.ts` — unrecognized-word dialog; thread override flag to persistence
- `apps/bot/src/renderers/translation.renderer.ts` — caveat line on override cards
- `apps/bot/src/notifications/notification.service.ts` — picker excludes unverified entries
- `packages/core/src/modules/i18n/locales/*.json` — new keys in all 11 locales
- `apps/bot/src/metrics.ts` — `bot_unrecognized_word_total`

---

## Test Plan (spec-first, TDD)

Ordered RED–GREEN slices:

1. **RED:** translation of a single word the model assesses as non-existent yields an "unrecognized word" outcome (with correction options when available), not a normal card.
   **GREEN:** existence field in the translate schema + branch in the translation service.
2. **RED:** re-running with the as-written flag translates the verbatim word and the result carries the unrecognized marker.
   **GREEN:** honor the flag, thread the marker through the accepted result.
3. **RED (bot):** override card renders the caveat line; normal cards don't.
   **GREEN:** renderer change.
4. **RED:** persistence saves the `unverified` flag for override-path entries.
   **GREEN:** schema + save path.
5. **RED:** notification word picker never selects unverified entries.
   **GREEN:** picker filter.
6. **RED (integration):** "stroha" with a dictionary miss ends in either the "strohá" correction suggestion or the unrecognized-word outcome — never a confident card with fabricated synonyms.
   **GREEN:** wire any remaining gaps.

**REFACTOR:** consolidate preflight's and translation's "recognized word" wording; drop the dead language-validator no-op.

**Not tested** (low value): literal prompt text, locale contents, TypeScript-enforced types.

**Practical note:** `apps/bot` tests consume `packages/core` **dist** — rebuild core before `pnpm test`; update adapter-db `vi.mock`s if new exports are added.

---

## Acceptance Criteria

- [x] "stroha" → correction suggestion or unrecognized-word reply; never a confident fabricated card
- [x] Plausible gibberish is translated only after explicit user override, with a visible caveat
- [x] Override/unrecognized entries are flagged unverified and never appear in daily notifications or SRS suggestions
- [ ] `62ff388` (forced preflight on dictionary miss) deployed: `develop` merged to `master` — *deploy step, outside this change*
- [x] All new tests pass; existing tests still pass

## Implementation Notes (as built)

- **Existence assessment on the main call** — `buildMetadataSchema` / `buildMetadataPrompt` gained an `assessExistence` flag that adds `sourceWordRecognized` (boolean) and `suggestedCorrection` (string|null). No extra AI call. Opt-in via `TranslateInput.assessSourceExistence` (set by the two primary bot translate paths only); never runs for sentences or for batch/topic/video flows.
- **Guard branch** in `translation.service.ts`: an unrecognized headword returns `needs_clarification` (reason `unrecognized_word`) with a `typo_correction` option (when a confident correction exists) plus a `translate_as_written` option. On the override re-run (`skipInputCorrection`) it translates anyway and sets `TranslateOutput.unverified`, which drives the caveat line and the persisted `unverified` flag.
- **Reused Task 69 plumbing** — the bot renders the clarification with the existing confirmation UI; `translate_as_written` / `typo_correction` callbacks already exist.
- **Persistence** — `vocabulary_entries.unverified` column (migration `0041_oval_overlord.sql`), threaded through the port, repo `create`, and the `toVocabularyInput` mapper.
- **Exclusion** — the notification dictionary picker (`pickDictionaryWord`) now filters out `unverified` entries (the bot's `getUserVocabulary` supplies the flag). `/flashcard` and `/review` are untouched (non-goals).
- **Telemetry** — `bot_unrecognized_word_total{outcome}` (`correction_offered` / `translated_as_written` / `rejected`).
- **Cleanup** — deleted the dead no-op `validateLanguage` validator (and its export/test) so the validation stage honestly reflects what it checks.
- **Bonus (user request)** — the "Other meaning" button no longer surfaces a scary error when there is nothing new to offer (or on failure); it restores the card and shows "No other meanings available." (`translationNoMoreMeanings`).
