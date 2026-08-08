# Task 74 — Translation Quality Signal (validator false positives + measurable outcome)

**Status:** 🔲 To Do
**Category:** Quality / Observability
**Priority:** 🟠 High
**Created:** 2026-08-04
**Source:** [Weekly Grafana Report 2026-08-04](../reports/weekly-grafana/2026-08-04.md)
**Related:** Task 37 (Lite AI Translation Validator), Task 57 (Source Language Examples),
`translation-quality-program.md`

---

## Findings

Over 2026-08-01 → 2026-08-04: **10 validation failures across 43 translation requests = 23%**.
Each failure costs an AI repair round (latency + tokens).

| Rule | Hits | Words |
|---|---|---|
| `[language] Expected Russian text in Cyrillic; received Latin text or romanization` | **7** | agrada, qué mal, raro, sospechoso, hizo, flabbergasted, Ground-truth |
| `[examples] Only 1 of 3 examples demonstrate the translation …` | 3 | доделки, Hrotit, «Сделать поправку» |

Plus one `translation accepted with advisory (non-blocking) issues`.

Two further gaps surfaced while measuring this:

- **Quality outcome is not persisted anywhere.** `vocabulary_translations.details` contains
  only `examples` and `synonyms` (67 rows in the window, `qualityStatus` → `null` for all).
  The only record of a validation failure is a warn line in Loki, bounded by Loki retention.
  Quality cannot be trended, compared across releases, or regression-tested on real data.
- **The dictionary short-circuit never fires.** `dictionary_lookup_logs`: **44 lookups,
  0 matches** (es 24, en 11, ru 7, cs 2). Every translation pays a DB round-trip and then
  goes to the model anyway.

---

## Root Cause (hypothesis, needs confirmation)

`packages/core/src/modules/validation/validators/field-language.validator.ts:143`

```ts
function validateExpectedScript(value, nativeLang, field, errors) {
  if (typeof value !== "string" || value.trim().length === 0) return;
  if (nativeLang !== "ru" || hasSufficientCyrillic(value)) return;   // MIN_CYRILLIC_SHARE = 0.15
  errors.push({ rule: "language", message: "Expected Russian text in Cyrillic; …", field });
}
```

All 7 hits are on **ES→RU and EN→RU** pairs, and two of them (flabbergasted, Ground-truth)
fired **twice** — the repair round did not fix it either, which argues against "the model
occasionally slips" and for a systematic mismatch.

Most likely the rule is applied to `sourceUsage.examples[].native`, where `native` is
semantically ambiguous: inside the source-usage block the example sentence legitimately
belongs to the **source** language, but the validator demands the user's native script.
If so the defect is in scope (or in the prompt's field contract), not in the threshold —
`MIN_CYRILLIC_SHARE` was already lowered from 0.5 to 0.15 for a related false-positive class.

**First implementation step is to confirm which field path fails**, by logging
`error.field` alongside `failReason` — today only the message text is logged, which is why
this is still a hypothesis after a full log review.

---

## Goal

The validator rejects work that is actually wrong, quality is measurable over time, and a
dictionary hit demonstrably saves an AI call — or the dictionary leaves the hot path.

---

## Scope

### 74.1 — log the failing field 🔴 (prerequisite)

Include `field` (and `rule`) in the `translation validation failed` log payload and in any
persisted record. Without it every quality investigation stalls at "which one of these is it".

### 74.2 — fix the Cyrillic false positives 🔴

Once the field is known, either:

- scope `validateExpectedScript` so it never applies to source-language example fields; or
- fix the prompt's contract for `native` inside `sourceUsage` so the model fills it as the
  validator expects.

Guard the fix with cases from the real corpus above (agrada, qué mal, raro, sospechoso,
hizo, flabbergasted, Ground-truth) — all ES/EN→RU.

### 74.3 — persist the quality outcome 🟠

Store per translation: final status (`ok` / `advisory` / `needs_review` / `failed`), the
rules that fired, and the repair-round count. This makes "did quality improve?" answerable
from the database instead of from log scrollback, and gives the benchmark corpus
(`@docs/translation-benchmarks/`) a production feed.

### 74.4 — decide the dictionary's fate 🟡

0 hits in 44 lookups against 492 `vocabulary_dictionary_entries`. Determine whether the
corpus is simply too small for the languages in use (es/en/ru/cs), or the lookup itself is
mismatching (normalisation, lang code, lemma form). Then either grow/fix it so it saves AI
calls, or take it off the hot path — a 0%-hit lookup on every request is pure overhead.

### 74.5 — re-check the `[examples]` rule 🟡

3 hits, all "only 1 of 3 examples demonstrate the translation". Lower confidence that this
is a false positive than the Cyrillic rule — verify against the corpus before touching it;
it may be catching genuinely weak output.

---

## Acceptance Criteria

- [ ] `translation validation failed` logs carry `rule` + `field`.
- [ ] The 7 recorded ES/EN→RU inputs no longer trigger `[language]`, and a genuinely
      romanised Russian output still does (regression test both directions).
- [ ] Validation-failure rate over a week drops below 10% of requests (from 23%).
- [ ] A SQL query returns quality status distribution for an arbitrary date range.
- [ ] Dictionary hit rate is either > 0% or the lookup is removed from the request path.

---

## Non-Goals

- Changing the model or the generation prompt's translation strategy
  (see `plan-improvement-translation-strategy.md`).
- Building an admin UI for quality data — the DB record is enough for now.
