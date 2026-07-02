# Task 69 — Input Typo & Error Validation in Translate Mode

**Status:** ✅ Done
**Category:** Feature
**Created:** 2026-07-02

---

## Goal

When a user sends a word/phrase/sentence for translation, detect typos and grammatical errors in the **input**. Minor, unambiguous typos are corrected silently and the correction is **annotated in the reply** ("✏️ Fixed: *X* → *Y* — why"). Severe/ambiguous errors trigger a **confirmation dialog** before translating. Broken sentences get their errors explained alongside the translation of the intended meaning.

Built entirely on the **existing AI preflight** (`packages/core/src/modules/translation/preflight.*`) — no extra AI calls, no local spell-checker.

---

## Product Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Scope | **Translate mode only** — mentor, `/review`, `/flashcard`, video vocabulary untouched |
| 2 | Detection engine | Existing **AI preflight call** (extend schema/prompt); no Levenshtein, no dictionary spell-check |
| 3 | Minor typo (unambiguous fix) | New preflight outcome **`proceed_with_correction`**: translate corrected text silently, annotate reply with "✏️ Fixed: *X* → *Y* — {explanation}" |
| 4 | Severe error / multiple readings | Existing **`confirm_typo_suggestion`**: buttons "✅ Yes, I meant "{corrected}"" (translation already generated — show instantly) and "➡️ Translate as written" (re-run with a no-correction flag). **No cancel button.** Total gibberish → `correctedText: null`, only "translate as written" offered |
| 5 | Severity boundary | Defined in the preflight prompt: minor = correction unambiguous AND no other meaningful reading among the user's languages; severe = multiple candidates, or reads as a valid word in another user language, or construction is fully broken |
| 6 | Sentences / phrases | Almost never re-ask: translate the **intended (corrected) meaning** + reply block with the full corrected sentence and 1–2 lines explaining the main errors. Confirm dialog **only** when the meaning cannot be confidently reconstructed |
| 7 | Old mistype flow (language detection) | **Kept** as the cheap gatekeeper for "language undetectable". Guard against double re-asking: after the user confirms there, the preflight call runs with the no-correction flag |
| 8 | Language-ambiguity buttons | **Flag + code** buttons (`🇬🇧 EN`), rows of up to 4; message text explains each icon and the options ("pick a language below or send a clarifying message"); "✍️ Clarify with context" stays on its own row. Flags are added **on our side** from `langCode` — model labels must not contain language names |
| 9 | What is saved to the dictionary | Auto-fix / confirmed → **corrected form** (avoids typo cards in SRS and duplicate entries). "Translate as written" → **verbatim input** (user insisted: slang, dialect, rare word) |
| 10 | Explanation language | Model writes `explanation` in the user's **`nativeLang`** (interface language is slated for removal — all new copy binds to nativeLang). Static wrappers via `t(key, nativeLang)` in all 11 locales, English first. Length limit in prompt (~1–2 short sentences) + `.max()` in the Zod schema |
| 11 | Telemetry | Counter `bot_input_correction_total{outcome, input_type}` — outcome ∈ `auto_corrected` / `confirm_shown` / `confirmed` / `translate_as_written`; input_type ∈ `word` / `phrase` / `sentence`. Tuning signal: high `translate_as_written` share after confirms ⇒ model re-asks too eagerly, loosen prompt. Preflight token/cost already covered by `setAIRequestMetricSink` |

---

## Non-Goals

- No typed-answer exercises in `/review` / `/flashcard` (separate future feature)
- No error highlighting in mentor mode
- No local spell-checker / Levenshtein dependency
- No changes to the language-detection mistype flow beyond the double-ask guard

---

## Implementation Surface

- `packages/core/src/modules/translation/preflight.schema.ts` — add `proceed_with_correction` outcome; require `correctedText` for it; `.max()` on `explanation`
- `packages/core/src/modules/translation/preflight.prompt.ts` — severity boundary policy, nativeLang for `explanation`, no language names in `source_language` option labels, sentence policy (reconstruct vs confirm)
- `packages/core/src/modules/translation/translation.service.ts` — branch for `proceed_with_correction`: translate corrected text, return correction metadata (original, corrected, explanation) in the accepted decision; honor a "no correction" flag on re-runs
- `apps/bot/src/scenes/helpers/translate-mode.helper.ts` — correction annotation, double-ask guard, "translate as written" re-run, flag-button keyboard in `showTranslationClarification`
- `apps/bot/src/renderers/translation.renderer.ts` — "✏️ Fixed" line for words; corrected-sentence error block for sentences
- `packages/core/src/modules/i18n/locales/*.json` — new keys (`correctionNotice`, `sentenceErrorNotice`, clarify-language prompt, …) in all 11 locales
- `apps/bot/src/metrics.ts` — `bot_input_correction_total`
- Dictionary save path — persist corrected form (auto-fix/confirmed) vs verbatim (as-written)

---

## Test Plan (spec-first, TDD)

**Core (`packages/core`):**
- `translation.service`: `proceed_with_correction` → corrected text is what gets translated; accepted result carries correction metadata; minor correction does **not** produce `needs_clarification`; `confirm_typo_suggestion` unchanged; re-run with no-correction flag returns no correction
- Preflight schema: new outcome accepted; `correctedText` required with it; explanation length capped

**Bot (`apps/bot`):**
- Word auto-fix → reply contains "✏️ Fixed: X → Y — …"; dictionary stores the corrected form
- Sentence with errors → translation + corrected-sentence block; fully broken sentence → confirm dialog
- "Translate as written" → verbatim saved, no correction shown, `translate_as_written` counter incremented
- Language-clarify keyboard: flag+code buttons in rows of 4, context button on its own row, icons explained in the text
- Double-ask guard: after old mistype confirmation, preflight does not re-ask about the same word

**Not tested** (low value): literal prompt text, locale file contents, TypeScript-enforced types.

**Practical note:** `apps/bot` tests consume `packages/core` **dist** — rebuild core (`pnpm build`) before `pnpm test` after core changes.
