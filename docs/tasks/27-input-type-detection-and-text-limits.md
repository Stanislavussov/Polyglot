# Task 27: Input Type Detection (Phrase vs Sentence) & Adaptive Translation Pipeline

**Status:** 🔲 To Do

## Description

Currently every input — whether a single word, a short phrase, or a full sentence — flows through an identical pipeline: the same prompt template, the same rich Zod schema, the same validation rules, the same rendering, and the same Save/Skip keyboard. This is wrong for sentences:

1. **Saving a sentence to the dictionary is useless** — a dictionary stores learnable words and phrases, not entire sentences like "Can you tell me where the nearest pharmacy is?".
2. **Full output for sentences wastes tokens** — CEFR level, synonyms, alternatives, and example sentences make no sense for a sentence. Those fields cost extra AI tokens for zero user value.
3. **Prompt is tuned for words** — the current prompt asks for "word difficulty", "synonyms of the word", "example sentences containing the translated word". For a sentence this produces nonsense.
4. **Validation checks don't apply** — example word-matching, semantic "translation ≠ original" on a sentence, and alternatives validation are all designed for single words/phrases.
5. **Rendering is wrong** — showing CEFR, synonyms, alternatives, and examples for a translated sentence clutters the card with irrelevant data.

Implement an **input type classifier** (`word` / `phrase` / `sentence`) and adapt **every layer** of the translation pipeline based on the detected type.

**References:**
- Task 21 (`docs/tasks/finished/21-translation-output-config.md`) — output presets
- Task 11 (`docs/tasks/11-input-limits-config.md`) — basic input length limits (complementary)
- Task 06 (`docs/tasks/06-token-optimization.md`) — token optimization
- `docs/tech-reqs/02-architecture.md` — clean architecture layers
- `docs/tech-reqs/08-ai-prompt.md` — prompt structure
- `docs/tech-reqs/07-ai-validation.md` — validation pipeline
- `docs/tech-reqs/13-env.md` — env variable conventions

---

## Behavior Matrix

| Layer | `word` / `phrase` | `sentence` |
|---|---|---|
| **Output preset** | `FULL_OUTPUT` | `SENTENCE_OUTPUT` (new — no synonyms, no alternatives, no examples, no equivalent note) |
| **Prompt** | Current word/phrase prompt (synonyms, CEFR, examples, alternatives) | Simplified sentence prompt: just translate, transcription + register only |
| **Zod schema** | Full schema (synonyms required, examples required, alternatives optional) | Minimal schema (text + cefr + register + transcription only) |
| **Validation** | Full pipeline: schema → semantic → language → examples → alternatives | Minimal: schema → semantic only (no example matching, no alternative checks) |
| **Rendering** | Full card: CEFR, synonyms, examples, alternatives | Compact card: just translation text + transcription |
| **Keyboard** | Save + Skip + Regen per language | Regen per language only — no Save/Skip |
| **Session** | `pendingTranslation` stored → Save/Skip handlers work | No `pendingTranslation` — nothing to save |
| **Dictionary context** | Wiktionary lookup (enrichment) | Skip dictionary lookup (no learnable word to enrich) |
| **Regen helper** | Uses `FULL_OUTPUT` preset + Save/Skip keyboard | Uses `SENTENCE_OUTPUT` preset + Regen-only keyboard |

---

## Subtasks

### Step 1: Create an `InputClassifier` module in core

- [ ] Create `packages/core/src/modules/input-classifier/`:
  - `types.ts` — `InputType`, `InputClassification`, `InputClassifierConfig`
  - `input-classifier.ts` — pure, stateless classification
  - `index.ts` — re-export public surface
- [ ] Types:
  ```ts
  /** Detected input type */
  type InputType = 'word' | 'phrase' | 'sentence';

  /** Classification result with diagnostic metadata */
  interface InputClassification {
    type: InputType;
    /** Number of whitespace-separated tokens */
    wordCount: number;
    /** Whether sentence-ending punctuation was detected */
    hasSentencePunctuation: boolean;
  }

  /** Configurable thresholds (defaults in parentheses) */
  interface InputClassifierConfig {
    /** Max tokens for "word" classification (default: 2) */
    maxWordTokens: number;
    /** Max tokens for "phrase" classification (default: 6) */
    maxPhraseTokens: number;
  }
  ```
- [ ] Classification function:
  ```ts
  function classifyInput(text: string, config?: Partial<InputClassifierConfig>): InputClassification
  ```
  Rules:
  1. Trim input, split by whitespace → `wordCount`
  2. Detect sentence-ending punctuation (`.`, `!`, `?`, `。`, `？`, `！`) → `hasSentencePunctuation`
  3. If `wordCount <= config.maxWordTokens` → `type: 'word'`
  4. If `wordCount <= config.maxPhraseTokens` → `type: 'phrase'`
  5. If `wordCount > config.maxPhraseTokens` → `type: 'sentence'`

  **Key decision:** punctuation is metadata only — NOT a hard classifier. Short questions like `"How are you?"` (3 words with `?`) remain `phrase` because they are valid learnable dictionary entries. Only word count determines the boundary.

### Step 2: Add `SENTENCE_OUTPUT` preset + `InputType` to `TranslateInput`

- [ ] In `packages/core/src/modules/translation/translation-output.presets.ts`, add:
  ```ts
  /** Sentence translation — just translation text + transcription, no learning metadata */
  export const SENTENCE_OUTPUT: TranslationOutputConfig = {
    includeExamples: false,
    includeTranscription: true,
    includeSynonyms: false,
    includeAlternatives: false,
    includeEquivalentNote: false,
  };
  ```
- [ ] In `packages/core/src/modules/translation/types.ts`, add optional `inputType` field to `TranslateInput`:
  ```ts
  interface TranslateInput {
    // ... existing fields ...
    /** Classified input type — drives prompt, schema, and validation behavior */
    inputType?: 'word' | 'phrase' | 'sentence';
  }
  ```
- [ ] Re-export `SENTENCE_OUTPUT` from `packages/core/src/index.ts`

### Step 3: Adapt the prompt builder for sentences

- [ ] In `packages/core/src/modules/translation/prompt.builder.ts`:
  - `buildTranslationPrompt()` already respects `outputConfig` — when `SENTENCE_OUTPUT` disables examples/synonyms/alternatives/equivalentNote, those sections are already omitted from the prompt template.
  - **However**, the prompt intro still says `Translate "<text>"` and the rules mention "word difficulty" and "translated word". Add `inputType` awareness:
    - When `request.inputType === 'sentence'`: change prompt intro to `Translate the following sentence from ... to ...` (instead of `Translate "<text>"`), remove the "word difficulty" phrasing from CEFR rule, simplify rules section.
    - When `request.inputType` is `'word'` / `'phrase'` or absent: keep current prompt (backward compatible).
  - Add `inputType?: InputType` to `TranslationRequest` type.
  - Rough change to prompt builder:
    ```ts
    const isSentence = request.inputType === 'sentence';
    const intro = isSentence
      ? `Translate the following sentence from ${sourceLangName} to ${targetLangNames}:\n"${text}"`
      : `Translate "${text}" from ${sourceLangName} to ${targetLangNames}.`;
    ```
  - For sentences, the CEFR rule becomes: `- CEFR level should reflect the overall difficulty of the sentence.` (instead of "difficulty of the translated word")

### Step 4: Adapt the Zod schema builder for sentences

- [ ] In `packages/core/src/modules/translation/schemas/translation.schema.ts`:
  - `buildLanguageTranslationSchema(config?)` already relaxes disabled fields (examples default to `[]`, synonyms default to `[]`). When `SENTENCE_OUTPUT` is passed, these fields are already relaxed. **No schema changes needed** — the existing config-aware builder handles it.
  - Verify: with `SENTENCE_OUTPUT`, the built schema should accept `{ text, cefr, register, transcription? }` with empty synonyms/examples and no alternatives/equivalentNote.

### Step 5: Adapt the validation pipeline for sentences

- [ ] In `packages/core/src/modules/validation/index.ts`, the `validate()` function:
  - Currently runs: schema → semantic → language → examples → alternatives (for every input).
  - For sentences, example validation and alternatives validation are meaningless (those fields are empty).
  - **The existing code already handles this gracefully**: example validation only runs when `examples && Array.isArray(examples) && translationText`, and alternatives validation only runs when `alternatives && Array.isArray(alternatives)`. With `SENTENCE_OUTPUT`, the AI returns empty arrays / undefined → those checks are skipped naturally.
  - **However**, add explicit `inputType` awareness for the semantic validator:
    - For sentences, `validateSemantic(original, translationText)` may flag long translations as "too similar to original" if source/target languages share vocabulary. The current check is fine for words but may need relaxation for sentences.
    - Add an optional `inputType` parameter to `validate()`:
      ```ts
      function validate(raw, schema, original, expectedLangs, inputType?): ValidationResult
      ```
    - When `inputType === 'sentence'`, skip semantic validation entirely (sentence translations are naturally more similar to originals and the "translation ≠ original" check is not meaningful for sentences).
  - Update the translation service to pass `inputType` through to `validate()`.

### Step 6: Adapt the rendering layer for sentences

- [ ] In `apps/bot/src/renderers/translation.renderer.ts`:
  - Add `renderSentenceTranslation(output: TranslateOutput, interfaceLang?: string): string`:
    ```ts
    /**
     * Render a compact sentence translation card.
     * Shows only: emoji, original sentence, and per-language translations
     * with transcription. No CEFR, synonyms, examples, or alternatives.
     */
    export function renderSentenceTranslation(output: TranslateOutput, interfaceLang?: string): string
    ```
    - Format per language: `🇩🇪 DE: <b>translation text</b> [transcription]`
    - No CEFR line, no synonyms block, no examples block, no alternatives
    - Keeps `needsReview` warning if present
  - Add `buildSentenceKeyboard(langCodes: string[], interfaceLang?: string): InlineKeyboard`:
    ```ts
    /**
     * Build inline keyboard for sentence translations.
     * Only regenerate buttons — no Save/Skip (sentences aren't saved to dictionary).
     */
    export function buildSentenceKeyboard(langCodes: string[], interfaceLang?: string): InlineKeyboard
    ```
    - Row 1: regenerate buttons per language (same as `buildTranslationKeyboard`)
    - No Row 2 (no Save/Skip)

### Step 7: Adapt the translate-mode helper (main integration point)

- [ ] In `apps/bot/src/scenes/helpers/translate-mode.helper.ts`, in `handleTranslateText()`:
  1. After receiving `word`, call `classifyInput(word)` from `@polyglot/core`
  2. Select output preset: `classification.type === 'sentence' ? SENTENCE_OUTPUT : FULL_OUTPUT`
  3. For sentences, skip dictionary context lookup (no `lookupContext` call)
  4. Pass `inputType` to `translateWithContext()` / `translate()`:
     ```ts
     const output = await translateWithContext(
       { word, sourceLang, targetLangs, model, userId, outputConfig, inputType: classification.type },
       { lookupContext, generateObjectFn: generateObject },
     );
     ```
  5. After translation, branch on `classification.type`:
     - **`'word'` / `'phrase'`**: current behavior — `renderTranslation()`, `buildTranslationKeyboard()`, store `pendingTranslation` in session, show source lang menu
     - **`'sentence'`**: `renderSentenceTranslation()`, `buildSentenceKeyboard()`, do NOT store `pendingTranslation`, prepend `sentenceTranslation` i18n label, show source lang menu
  6. Log classification: `logger.debug({ word, inputType, wordCount }, 'Input classified')`

### Step 8: Adapt the context-enrichment layer for sentences

- [ ] In `packages/core/src/modules/context-enrichment/` (or wherever `translateWithContext` lives):
  - When `input.inputType === 'sentence'`, skip the Wiktionary `lookupContext()` call entirely — dictionary context is per-word, not per-sentence.
  - Pass `inputType` through to the underlying `translate()` call.

### Step 9: Adapt the regen helper for sentences

- [ ] In `apps/bot/src/scenes/helpers/regen.helper.ts`:
  - The regen helper currently uses `FULL_OUTPUT` and `buildTranslationKeyboard` (with Save/Skip).
  - It needs to know whether the current translation is a sentence to use the right preset and keyboard.
  - **Option A (simple)**: Store `inputType` in session alongside `pendingTranslation`. But sentences don't store `pendingTranslation`.
  - **Option B (recommended)**: The regen callback (`tr:regen:<lang>`) for sentences is handled in translate-mode helper, not the conversation-based regen helper. Since sentence translations have no `pendingTranslation`, the regen handler must read the output from the message itself or use a separate session field.
  - **Practical approach**: Store `lastTranslation` and `lastInputType` in session for regen purposes (separate from `pendingTranslation` which is for Save):
    ```ts
    interface SessionData {
      // ... existing ...
      lastTranslation?: TranslateOutput;   // for regen (both words and sentences)
      lastInputType?: InputType;           // to select correct preset/keyboard on regen
    }
    ```
  - In the `tr:regen:<lang>` callback handler:
    - Read `lastTranslation` and `lastInputType` from session
    - Use `SENTENCE_OUTPUT` + `buildSentenceKeyboard` when `lastInputType === 'sentence'`
    - Use `FULL_OUTPUT` + `buildTranslationKeyboard` when word/phrase

### Step 10: Add i18n keys

- [ ] In `packages/core/src/modules/i18n/locales/{en,ru,cs}.json`, add:
  ```json
  "sentenceTranslation": "📝 Sentence translation"
  ```
  This label is shown above the translation card for sentences to set user expectations (no save option).
- [ ] Update `TranslationKey` union type in `packages/core/src/modules/i18n/types.ts`

### Step 11: Add config env var (optional tuning)

- [ ] In `packages/infra/src/config.ts`, extend `envSchema` with:
  ```ts
  INPUT_MAX_PHRASE_WORDS: z.coerce.number().int().min(2).default(6),
  ```
- [ ] This allows tuning the phrase↔sentence boundary without a code change

### Step 12: Write tests

**Core — input classifier:**
- [ ] `packages/core/src/modules/input-classifier/__tests__/input-classifier.test.ts`:
  - `"hello"` → `{ type: 'word', wordCount: 1, hasSentencePunctuation: false }`
  - `"good morning"` → `{ type: 'word', wordCount: 2, hasSentencePunctuation: false }`
  - `"how are you doing"` → `{ type: 'phrase', wordCount: 4, hasSentencePunctuation: false }`
  - `"How are you?"` → `{ type: 'phrase', wordCount: 3, hasSentencePunctuation: true }` (short = phrase despite `?`)
  - `"Guten Tag!"` → `{ type: 'word', wordCount: 2, hasSentencePunctuation: true }`
  - `"Can you tell me where the nearest pharmacy is?"` (9 words) → `{ type: 'sentence' }`
  - `"I went to the store and bought some milk and bread"` (11 words) → `{ type: 'sentence' }`
  - `"Können Sie mir sagen wo die nächste Apotheke ist"` (9 words) → `{ type: 'sentence' }`
  - Empty/whitespace `"   "` → `{ type: 'word', wordCount: 0 }`
  - Custom config: `classifyInput("one two three", { maxPhraseTokens: 2 })` → `{ type: 'sentence' }`
  - Single long word → `{ type: 'word', wordCount: 1 }`

**Core — prompt builder:**
- [ ] In `packages/core/src/modules/translation/__tests__/prompt.builder.test.ts`, add:
  - When `inputType === 'sentence'` → prompt contains "Translate the following sentence" (not `Translate "..."`)
  - When `inputType === 'sentence'` → no "synonyms", no "alternatives", no "example sentences" in prompt text
  - When `inputType === 'word'` or absent → current prompt format (backward compat)

**Core — validation:**
- [ ] In `packages/core/src/modules/validation/__tests__/validate.test.ts`, add:
  - When `inputType === 'sentence'` → semantic validation is skipped
  - When `inputType` is absent → full validation runs (backward compat)

**Core — preset:**
- [ ] `SENTENCE_OUTPUT` has correct field values (all disabled except transcription)

**Bot — renderer:**
- [ ] `renderSentenceTranslation()` produces compact card (no CEFR, no synonyms, no examples)
- [ ] `buildSentenceKeyboard()` returns keyboard with regen buttons only, no Save/Skip

**Bot — i18n:**
- [ ] `sentenceTranslation` key resolves in en/ru/cs

**All:**
- [ ] All existing tests continue to pass

### Step 13: Update docs

- [ ] Update `docs/tech-reqs/13-env.md` — document `INPUT_MAX_PHRASE_WORDS`
- [ ] Update `.pi/skills/translation/SKILL.md`:
  - Add `SENTENCE_OUTPUT` to preset table
  - Add `inputType` to `TranslateInput` / `TranslationRequest` types
  - Update caller→preset mapping table
  - Update prompt builder section (sentence-aware)
  - Update translation flow diagram (classifier step)
- [ ] Update `.pi/skills/validation/SKILL.md`:
  - Add `inputType` parameter to `validate()` signature
  - Document sentence validation behavior (semantic skipped)
- [ ] Update `.pi/skills/bot/SKILL.md`:
  - Document `renderSentenceTranslation()`, `buildSentenceKeyboard()`
  - Document session changes (`lastTranslation`, `lastInputType`)
- [ ] Update `.pi/skills/context-enrichment/SKILL.md`:
  - Document sentence skip behavior (no Wiktionary lookup)

---

## Architecture Notes

### Full pipeline with classifier

```
User sends text
      │
      ▼
[input-guard]            ← Task 11: empty, too short, digits-only, commands
      │ ok
      ▼
[input-classifier]       ← THIS TASK: word / phrase / sentence
      │ sets: outputConfig, inputType
      │
      ├── word/phrase ──────────────────────────────────┐
      │                                                  │
      │   [dictionary context]  ← Wiktionary lookup      │
      │          │                                       │
      │   [translate]           ← AI: FULL_OUTPUT        │
      │          │                                       │
      │   [validate: full]      ← schema+semantic+       │
      │          │                 examples+alternatives  │
      │   [render: full card]   ← CEFR, synonyms, etc.  │
      │          │                                       │
      │   [keyboard: Save/Skip/Regen]                    │
      │          │                                       │
      │   [session: pendingTranslation]                  │
      │                                                  │
      ├── sentence ─────────────────────────────────────┐
      │                                                  │
      │   [skip dictionary context]  ← no Wiktionary     │
      │          │                                       │
      │   [translate]           ← AI: SENTENCE_OUTPUT    │
      │          │                                       │
      │   [validate: minimal]   ← schema only            │
      │          │                 (skip semantic+        │
      │          │                  examples+alts)        │
      │   [render: compact card] ← text + transcription  │
      │          │                                       │
      │   [keyboard: Regen only] ← no Save/Skip         │
      │          │                                       │
      │   [session: lastTranslation + lastInputType]     │
```

### Why word count, not character count?

Character count is a poor proxy:
- `"Pneumonoultramicroscopicsilicovolcanoconiosis"` = 45 chars, 1 word → valid dictionary word
- `"I love cats"` = 11 chars, 3 words → borderline phrase

Word count directly correlates with whether something is a learnable unit (dictionary entry) vs a full thought (sentence).

### Token savings for sentences

`SENTENCE_OUTPUT` vs `FULL_OUTPUT` per-request savings:

| Field removed | Tokens saved |
|---|---|
| Examples (3 sentences × N langs) | ~200–400 |
| Synonyms (2–3 per lang) | ~60–100 |
| Alternatives (2 per lang) | ~120–200 |
| Equivalent note | ~30–50 |
| Dictionary context (Wiktionary block) | ~50–100 |
| Simplified prompt text | ~100–200 |
| **Total saved per sentence request** | **~560–1050 tokens** |

Plus: no validation retries triggered by irrelevant checks → further savings.

### Edge cases

| Input | Words | Classification | Rationale |
|---|---|---|---|
| `"Katze"` | 1 | word | Single word → save to dict |
| `"Guten Tag"` | 2 | word | Greeting → learnable, save |
| `"How are you?"` | 3 | phrase | Short question → learnable phrase |
| `"schwarzer Kaffee mit Milch"` | 4 | phrase | Compound expression → save |
| `"in the meantime"` | 3 | phrase | Prepositional phrase → save |
| `"Können Sie mir sagen wo der Bahnhof ist?"` | 8 | sentence | Full sentence → translate only |
| `"I went to the store and bought some milk"` | 9 | sentence | Full sentence → translate only |

---

## Architecture Constraints

| Package | Change scope | Notes |
|---|---|---|
| `packages/core/` | New `input-classifier` module (pure) | No bot or DB imports |
| `packages/core/` | New `SENTENCE_OUTPUT` preset | One-line addition to presets file |
| `packages/core/` | `translation/types.ts` — add `inputType` to `TranslateInput`, `TranslationRequest` | Type-only change |
| `packages/core/` | `translation/prompt.builder.ts` — sentence-aware intro + rules | ~15 lines changed |
| `packages/core/` | `validation/index.ts` — `inputType` param, skip semantic for sentences | ~5 lines changed |
| `packages/core/` | `i18n` locales — 1 new key | Standard i18n update |
| `packages/core/` | `context-enrichment/` — skip lookup for sentences | ~3 lines changed |
| `packages/infra/` | `config.ts` — 1 env field | Optional tuning |
| `apps/bot/` | `translate-mode.helper.ts` — classifier + branching | ~25 lines changed |
| `apps/bot/` | `translation.renderer.ts` — new render + keyboard functions | ~30 lines added |
| `apps/bot/` | `regen.helper.ts` — sentence-aware preset + keyboard | ~10 lines changed |
| `apps/bot/` | `types.ts` — session additions | 2 fields |

---

## Files to Create / Modify

**Create:**
- `packages/core/src/modules/input-classifier/types.ts`
- `packages/core/src/modules/input-classifier/input-classifier.ts`
- `packages/core/src/modules/input-classifier/index.ts`
- `packages/core/src/modules/input-classifier/__tests__/input-classifier.test.ts`

**Modify (core — translation):**
- `packages/core/src/modules/translation/translation-output.presets.ts` — add `SENTENCE_OUTPUT`
- `packages/core/src/modules/translation/types.ts` — add `inputType` to `TranslateInput`, `TranslationRequest`
- `packages/core/src/modules/translation/prompt.builder.ts` — sentence-aware prompt
- `packages/core/src/modules/translation/translation.service.ts` — pass `inputType` to `validate()`
- `packages/core/src/modules/translation/__tests__/prompt.builder.test.ts` — sentence prompt tests

**Modify (core — validation):**
- `packages/core/src/modules/validation/index.ts` — add `inputType` param, skip semantic for sentences
- `packages/core/src/modules/validation/__tests__/validate.test.ts` — sentence validation tests

**Modify (core — context-enrichment):**
- Context-enrichment module — skip Wiktionary lookup for sentences

**Modify (core — i18n):**
- `packages/core/src/modules/i18n/locales/en.json` — 1 new key
- `packages/core/src/modules/i18n/locales/ru.json` — 1 new key
- `packages/core/src/modules/i18n/locales/cs.json` — 1 new key
- `packages/core/src/modules/i18n/types.ts` — extend `TranslationKey`

**Modify (core — exports):**
- `packages/core/src/index.ts` — re-export `input-classifier` + `SENTENCE_OUTPUT`

**Modify (infra):**
- `packages/infra/src/config.ts` — add `INPUT_MAX_PHRASE_WORDS`

**Modify (bot):**
- `apps/bot/src/types.ts` — add `lastTranslation`, `lastInputType` to `SessionData`
- `apps/bot/src/scenes/helpers/translate-mode.helper.ts` — classifier integration + branching
- `apps/bot/src/scenes/helpers/regen.helper.ts` — sentence-aware preset + keyboard
- `apps/bot/src/renderers/translation.renderer.ts` — add `renderSentenceTranslation()`, `buildSentenceKeyboard()`

**Modify (docs):**
- `docs/tech-reqs/13-env.md` — document `INPUT_MAX_PHRASE_WORDS`
- `.pi/skills/translation/SKILL.md` — preset table, inputType, prompt, flow
- `.pi/skills/validation/SKILL.md` — inputType param, sentence behavior
- `.pi/skills/bot/SKILL.md` — new renderer/keyboard, session changes
- `.pi/skills/context-enrichment/SKILL.md` — sentence skip

---

## Key Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Threshold too low — valid phrases classified as sentences | Default 6 words is generous. Tunable via `INPUT_MAX_PHRASE_WORDS` env var |
| Users expect to save sentences to dictionary | `sentenceTranslation` label makes it clear. Feature is transparent |
| CJK text has no spaces — word count = 1 for long sentences | CJK sentences use punctuation `。？！`. Can add character-count fallback in future. Most CJK learnable phrases are short |
| Regen for sentences still costs tokens | Uses `SENTENCE_OUTPUT` — cheaper than `FULL_OUTPUT` regen |
| Breaking change for `validate()` signature | New `inputType` param is optional — backward compatible. Absent = full validation |
| Breaking change for `TranslateInput` type | New `inputType` field is optional — backward compatible |

---

## Effort Estimate

~6–8 hours (touches many layers but each change is small)

---

## Dependencies

- Task 21 (output presets) — ✅ done. This task adds one new preset.
- Task 11 (input-guard) — complementary. Input-guard runs first (structural checks), then classifier (semantic type). Can be implemented independently.

---

## Acceptance Criteria

- [ ] `classifyInput("hello")` returns `{ type: 'word' }`
- [ ] `classifyInput("how are you doing")` returns `{ type: 'phrase' }`
- [ ] `classifyInput("Can you tell me where the nearest pharmacy is?")` returns `{ type: 'sentence' }`
- [ ] Sending a word in translate mode → full translation card with Save/Skip/Regen keyboard
- [ ] Sending a phrase in translate mode → full translation card with Save/Skip/Regen keyboard
- [ ] Sending a sentence (>6 words) in translate mode → compact card with Regen-only keyboard, `sentenceTranslation` label, no Save option
- [ ] Sentence translations use `SENTENCE_OUTPUT` preset (no synonyms, no alternatives, no examples, no equivalent note)
- [ ] Sentence translations skip Wiktionary dictionary context lookup
- [ ] Sentence prompt says "Translate the following sentence" (not "Translate word")
- [ ] Sentence validation skips semantic check (no false "translation = original" failures)
- [ ] Sentence rendering shows only translation text + transcription (no CEFR, synonyms, examples, alternatives)
- [ ] `buildSentenceKeyboard()` returns keyboard with regen buttons only (no Save/Skip)
- [ ] Regen for sentences uses `SENTENCE_OUTPUT` preset and sentence keyboard
- [ ] Word/phrase behavior is completely unchanged (backward compatible)
- [ ] `SENTENCE_OUTPUT` preset exists and is re-exported from `@polyglot/core`
- [ ] `sentenceTranslation` i18n key resolves in en/ru/cs
- [ ] `INPUT_MAX_PHRASE_WORDS` env var has working default (6); missing value does not crash
- [ ] All unit tests for `classifyInput` pass (≥11 cases)
- [ ] Prompt builder tests cover sentence vs word/phrase prompt differences
- [ ] Validation tests cover sentence-mode semantic skip
- [ ] Renderer tests cover `renderSentenceTranslation` and `buildSentenceKeyboard`
- [ ] All existing tests pass without modification
- [ ] All packages build: `pnpm -r run build`
