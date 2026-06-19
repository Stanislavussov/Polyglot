# Translation Quality Improvement Program

Status: in progress.
Type: Product quality, architecture, AI reliability.
Priority: P0.
Source: `docs/research/translation-quality-roadmap.html`.

## Goal

Make translation quality measurable and enforceable across generation, validation,
storage, dictionary, flashcard, and SRS flows.

The program is complete when Polyglot no longer accepts structurally valid but
linguistically invalid output, preserves source-language learning material after
Save, and can compare model/prompt changes against a stable evaluation dataset.

## Confirmed problems

1. `validateLanguage()` is a no-op, so field language is not checked.
2. Example headword validation is disabled for every multi-word expression.
3. `example.native` is required for every target language, including
   `targetLang === nativeLang`.
4. The primary prompt does not forbid IPA, romanization, or transliteration in
   every field.
5. Structured generation uses `frequencyPenalty: 0.5`, although examples need to
   repeat the relevant translation variant.
6. `sourceUsage` is rendered only in the immediate translation card.
7. `sourceUsage` is not persisted when a translation is saved.
8. Flashcard, dictionary, and SRS renderers omit source-language usage examples.
9. Flashcard, dictionary, and SRS output do not consistently render
   `connotationWarning`.
10. `connotationWarning` is overloaded as both regular usage guidance and an
    exceptional warning.
11. Dictionary context lookup selects `results[0]` without normalization or sense
    ranking.
12. There is no versioned evaluation dataset for model and prompt comparisons.
13. A generic translation cache would preserve bad AI output unless entries are
    validated and versioned.

## Product decisions

- Keep one structured generation request as the default architecture.
- Preserve example variety:
  - example 1 demonstrates the main translation;
  - examples 2 and 3 may demonstrate assigned alternatives or synonyms.
- Do not require `connotationWarning` for every target language.
- Add a separate `usageNote` field for regular target-side usage guidance.
- Store `sourceUsage` once at vocabulary-entry level.
- Use multi-call generation only if evaluation shows that the improved
  single-request path cannot meet quality targets.
- Do not fine-tune until the contract is stable and a reviewed dataset exists.

## Delivery slices

### TQ-01 — Reject invalid native example translations

Type: AFK.
Priority: P0.
Blocked by: none.
Status: completed.

#### What to build

Make example-native requirements target-aware. A translation block for the
user's native language must not request or require a same-language native
translation. Other target languages continue to require a native translation.

The primary prompt must forbid pronunciation, IPA, romanization, and
transliteration in every output field.

#### Acceptance criteria

- [x] `targetLang === nativeLang` schema does not require `example.native`.
- [x] Other target-language blocks still require `example.native`.
- [x] The primary prompt forbids IPA, romanization, and transliteration globally.
- [x] A regression test covers `phase out`, source `en`, targets `cs` and `ru`,
      native `ru`.
- [x] Existing translation schemas remain backward-compatible where no
      `nativeLang` is supplied.

### TQ-02 — Use translation-safe generation settings

Type: AFK.
Priority: P0.
Blocked by: none.
Status: completed.

#### What to build

Allow AI generation options to be supplied per request kind and use
`frequencyPenalty: 0` for translation generation.

#### Acceptance criteria

- [x] Translation requests use `frequencyPenalty: 0`.
- [x] Non-translation callers retain explicit or default settings.
- [x] AI adapter tests verify the forwarded setting.
- [x] Request logging remains unchanged.

### TQ-03 — Replace the retired preview translation model

Type: HITL.
Priority: P0.
Blocked by: TQ-10.
Status: planned.

#### What to build

Benchmark supported stable models and configure the selected model for each
subscription plan. Register every production model for correct cost reporting.

#### Acceptance criteria

- [ ] No plan uses `gemini-2.5-flash-lite-preview-09-2025`.
- [ ] Candidate models are compared on the evaluation dataset.
- [ ] The selected model meets the agreed quality, latency, and cost thresholds.
- [ ] Production model IDs exist in the model registry.
- [ ] Admin settings clearly display active plan-to-model assignments.

### TQ-04 — Validate example-to-variant alignment

Type: AFK.
Priority: P1.
Blocked by: TQ-01.
Status: in progress.

#### What to build

Replace the current ASCII single-word-only check with a phrase- and
inflection-aware validator. Validate each example against its assigned main,
alternative, or synonym variant.

#### Acceptance criteria

- [x] Multi-word expressions are no longer skipped.
- [x] `phase out` and normal inflected variants can be recognized.
- [x] Czech and Russian examples support inflection-aware matching.
- [x] Example 1 demonstrates the main translation.
- [ ] Examples 2 and 3 demonstrate their assigned variant when one is requested.
- [x] Idiomatic equivalents retain an explicit relaxation policy.

### TQ-05 — Add deterministic field-language validation

Type: AFK.
Priority: P1.
Blocked by: TQ-01.
Status: completed.

#### What to build

Add cheap deterministic validators before any AI judge:

- target/native equality;
- expected writing system;
- likely romanization;
- forbidden pronunciation markers;
- duplicate notes copied across target blocks.

The prompt must also state explicitly that `connotationWarning` is written in the user's native language even inside non-native target blocks.

Use statistical language detection only for sufficiently long text and treat
low-confidence results as inconclusive rather than invalid.

#### Acceptance criteria

- [x] Russian native text written as Latin romanization is rejected.
- [x] Identical target and native example strings are rejected.
- [x] Short Czech/German strings do not regress due to unreliable detection.
- [x] Validation errors include precise field paths.
- [x] Retry prompts receive actionable error messages.
- [x] Pronunciation markers embedded inside ordinary response fields are rejected.
- [x] Notes duplicated across target-language blocks are rejected.

### TQ-06 — Persist source-language usage material

Type: AFK.
Priority: P1.
Blocked by: none.
Status: completed.

#### What to build

Persist `sourceUsage` at vocabulary-entry level and preserve it through create,
read, regeneration, dictionary, flashcard, and SRS flows.

#### Acceptance criteria

- [x] Drizzle schema stores source usage on `vocabulary_entries`.
- [x] Migration is generated by Drizzle Kit and reviewed.
- [x] `toVocabularyInput()` maps source usage.
- [x] Repository create/read paths preserve it.
- [x] Existing vocabulary rows remain valid.
- [x] `pnpm db:push` applies the schema to the local/dev database.

### TQ-07 — Render source usage consistently

Type: AFK.
Priority: P1.
Blocked by: TQ-06.
Status: completed.

#### What to build

Render saved source-language guidance in flashcard, dictionary detail, and SRS
views while keeping each view appropriately compact.

#### Acceptance criteria

- [x] Flashcard back shows source explanation and source examples.
- [x] Dictionary detail preserves the full saved learning card.
- [x] SRS shows a compact source example and target example.
- [x] HTML escaping is preserved.
- [x] Renderers have regression tests.

### TQ-08 — Separate usage notes from connotation warnings

Type: AFK.
Priority: P1.
Blocked by: TQ-05.
Status: completed.

#### What to build

Add per-target `usageNote` for regular nuance, register, government, and usage
context. Keep `connotationWarning` optional and limited to exceptional risks.

#### Acceptance criteria

- [x] Prompt and schema define distinct semantics for both fields.
- [x] `usageNote` is written in the user's native language.
- [x] `connotationWarning` is not required for neutral translations.
- [x] Both fields are persisted and rendered consistently.
- [x] Existing stored translations remain readable.

### TQ-09 — Normalize dictionary context lookup

Type: AFK.
Priority: P2.
Blocked by: none.
Status: planned.

#### What to build

Normalize lookup input and return candidate senses instead of selecting the first
database row.

#### Acceptance criteria

- [ ] Lookup applies Unicode normalization, case folding, and whitespace trim.
- [ ] Exact expression, known form, and lemma candidates are supported.
- [ ] The context adapter no longer silently selects `results[0]`.
- [ ] Candidate ordering is deterministic.
- [ ] Existing fail-open behavior is preserved.

### TQ-10 — Rank dictionary senses by context

Type: AFK.
Priority: P2.
Blocked by: TQ-09.
Status: planned.

#### What to build

Select one or two dictionary senses using input type, part of speech, context
hint, and confidence. Keep sense selection separate from translation generation.

#### Acceptance criteria

- [ ] Ambiguous words expose ranked senses with confidence.
- [ ] Context hints affect the selected sense.
- [ ] Prompts receive no more than two selected senses.
- [ ] The selected sense identity is available for evaluation and caching.

### TQ-11 — Build the translation evaluation dataset

Type: AFK.
Priority: P1.
Blocked by: TQ-01, TQ-04, TQ-05.
Status: planned.

#### What to build

Create a versioned dataset of 200–500 reviewed translation cases and an
agent-runnable evaluation command.

#### Acceptance criteria

- [ ] Dataset covers phrasal verbs, idioms, ambiguity, inflection, false friends,
      register, target-native equality, and writing-system boundaries.
- [ ] Each fixture declares acceptable translations and forbidden patterns.
- [ ] Each fixture declares expected language and example-variant requirements.
- [ ] Evaluation output reports accuracy by model, prompt version, and language pair.
- [ ] The suite contains real production failures, starting with `phase out`.

### TQ-12 — Add translation quality telemetry

Type: AFK.
Priority: P1.
Blocked by: TQ-11.
Status: planned.

#### What to build

Persist and report prompt/schema version, validation result, retry count, review
status, model, latency, and cost for translation requests.

#### Acceptance criteria

- [ ] Quality metrics are attributable to model and language pair.
- [ ] Wrong-language, romanization, duplication, and example-alignment failures
      are separately measurable.
- [ ] No raw sensitive user content is added to metrics without an explicit
      retention decision.
- [ ] Admin reporting can compare releases.

### TQ-13 — Route high-risk translations to stronger models

Type: AFK.
Priority: P2.
Blocked by: TQ-10, TQ-11, TQ-12.
Status: planned.

#### What to build

Select a model tier using measurable risk: phrase/idiom, dictionary miss,
ambiguous sense, uncommon language pair, or prior validation failure.

#### Acceptance criteria

- [ ] Simple dictionary-backed words use the economical configured model.
- [ ] High-risk inputs use a stronger model.
- [ ] Routing decisions are logged and measurable.
- [ ] Routing thresholds are covered by tests.
- [ ] Quality improves without sending every request to the most expensive model.

### TQ-14 — Repair only invalid fields

Type: AFK.
Priority: P2.
Blocked by: TQ-05, TQ-08, TQ-13.
Status: planned.

#### What to build

When validation identifies a specific bad field, regenerate only that field or
language block instead of repeating the complete multi-language request.

#### Acceptance criteria

- [ ] Repair input includes the accepted translation as an anchor.
- [ ] A bad Czech example does not regenerate Russian output.
- [ ] Repair uses a strict minimal schema.
- [ ] Repair attempts and outcomes are observable.
- [ ] The full-response retry remains a bounded fallback.

### TQ-15 — Add a versioned verified translation cache

Type: AFK.
Priority: P2.
Blocked by: TQ-10, TQ-11, TQ-12.
Status: planned.

#### What to build

Cache only translations that pass the required quality gates. Include context,
sense, output contract, prompt version, and schema version in cache identity.

#### Acceptance criteria

- [ ] Candidate or failed outputs are never served from cache.
- [ ] Cache keys distinguish different senses and context hints.
- [ ] Prompt/schema changes do not silently reuse incompatible entries.
- [ ] Entries support `candidate`, `validated`, `approved`, and `superseded`
      lifecycle states.
- [ ] Administrators can invalidate or supersede an incorrect translation.

### TQ-16 — Collect structured user feedback

Type: AFK.
Priority: P2.
Blocked by: TQ-12.
Status: planned.

#### What to build

Allow users to report wrong translation, wrong example, wrong language,
unwanted transliteration, or wrong nuance directly from a translation card.

#### Acceptance criteria

- [ ] Feedback is linked to model, prompt/schema version, and request identity.
- [ ] Common failure categories require one tap.
- [ ] Feedback can be promoted into evaluation fixtures.
- [ ] Admins can inspect and resolve reports.

### TQ-17 — Reassess multi-call generation and fine-tuning

Type: HITL.
Priority: P2.
Blocked by: TQ-11, TQ-12, TQ-13, TQ-14.
Status: planned.

#### What to build

Review measured residual failure modes after the preceding work. Decide whether
examples/alternatives need separate generation calls and whether sufficient
reviewed training data exists for fine-tuning.

#### Acceptance criteria

- [ ] Decision uses evaluation and production telemetry.
- [ ] Cost and latency impact is quantified.
- [ ] Multi-call generation is adopted only for failure modes it demonstrably fixes.
- [ ] Fine-tuning is considered only with a stable contract and reviewed dataset.

## Dependency overview

```text
TQ-01 ─┬─> TQ-04 ─┐
       └─> TQ-05 ─┼─> TQ-11 ─> TQ-12 ─┬─> TQ-13 ─> TQ-14
                  └─> TQ-08           ├─> TQ-15
TQ-06 ─> TQ-07                        └─> TQ-16
TQ-09 ─> TQ-10 ───────────────────────┘
TQ-11 ─> TQ-03
TQ-11 + TQ-12 + TQ-13 + TQ-14 ─> TQ-17
```

## Quality gate

Every implementation slice must:

1. update `CHANGELOG.md`;
2. update the relevant `.pi/skills/*/SKILL.md`;
3. run:

```bash
pnpm build && pnpm lint && pnpm lint:deps && pnpm lint:knip && pnpm test && pnpm db:push
```

Database slices must additionally run `pnpm db:generate` and review the generated
migration before `pnpm db:push`. Agents must not run `pnpm db:migrate` locally.
