# Task 16: Auto-Detect Input Language & Smart Translation Direction

**Status:** 🔲 To Do

## Description

Currently, the translation pipeline always assumes the user is typing in their **native language** (`nativeLang`) and translating into their **learning languages** (`learningLangs`). This means if a user's native language is Russian and they're learning Czech and English, typing an English word still treats it as Russian input — producing broken or nonsensical results.

Implement **automatic input language detection** so the bot determines which language the user typed in and dynamically adjusts the translation direction:

- **Input is in `nativeLang`** → translate to all `learningLangs` (current behavior)
- **Input is in one of `learningLangs`** → translate to `nativeLang` + remaining `learningLangs`
- **Input is in an unknown language** → fall back to current behavior (treat as `nativeLang`)

### Example

User settings: `nativeLang: "ru"`, `learningLangs: ["cs", "en"]`

| User types        | Detected lang | sourceLang | targetLangs      |
| ----------------- | ------------- | ---------- | ---------------- |
| "привет"          | ru (native)   | ru         | [cs, en]         |
| "hello"           | en (learning) | en         | [ru, cs]         |
| "dobrý den"      | cs (learning) | cs         | [ru, en]         |
| "xyz123"          | unknown       | ru         | [cs, en]         |

**References:**
- `.pi/skills/translation/SKILL.md` (translate flow, `TranslateInput`)
- `.pi/skills/bot/SKILL.md` (translate-mode helper)
- `.pi/skills/validation/SKILL.md` (franc language detection already used)
- `docs/tech-reqs/02-architecture.md` (layer separation)

---

## Root Cause

In `apps/bot/src/scenes/helpers/translate-mode.helper.ts`, the translation call is hardcoded:

```typescript
const nativeLang = settings?.nativeLang ?? "en";
const learningLangs = settings?.learningLangs ?? [];

const output = await translateWithContext({
  word,
  sourceLang: nativeLang,       // ← always native
  targetLangs: learningLangs,   // ← always learning langs
  ...
});
```

There is no detection of what language the input text actually is. The `franc` library is already a project dependency (used in the validation module for language detection) but is not used at the input stage.

---

## Subtasks

### Step 1: Create language detection utility in core

- [ ] Create `packages/core/src/modules/language-detect/` module
- [ ] Implement `detectLanguage(text: string, candidates: string[]): string | undefined`
  - Uses `franc` (already in deps) to detect the input language
  - `candidates` = `[nativeLang, ...learningLangs]` — the set of languages to consider
  - Returns the detected ISO 639-1 code if it matches one of the candidates, or `undefined` if detection is inconclusive
  - For short inputs (1–2 words), `franc` is unreliable — use heuristics:
    - Script detection (Cyrillic → likely `ru`/`uk`/`bg`, Latin → narrow by candidates, CJK → `zh`/`ja`/`ko`)
    - If only one candidate uses the detected script, return it
    - If ambiguous, return `undefined` (fall back to default behavior)
- [ ] Export from `packages/core/src/index.ts`

### Step 2: Create translation direction resolver in core

- [ ] Create `packages/core/src/modules/language-detect/resolve-direction.ts`
- [ ] Implement `resolveTranslationDirection(input: ResolveDirectionInput): TranslationDirection`
  ```typescript
  interface ResolveDirectionInput {
    text: string;
    nativeLang: string;
    learningLangs: string[];
  }

  interface TranslationDirection {
    sourceLang: string;
    targetLangs: string[];
    detectedLang: string | undefined;  // for logging/display
  }
  ```
- [ ] Logic:
  1. Call `detectLanguage(text, [nativeLang, ...learningLangs])`
  2. If detected === `nativeLang` → `{ sourceLang: nativeLang, targetLangs: learningLangs }`
  3. If detected is one of `learningLangs` → `{ sourceLang: detected, targetLangs: [nativeLang, ...learningLangs.filter(l => l !== detected)] }`
  4. If `undefined` → fall back: `{ sourceLang: nativeLang, targetLangs: learningLangs }`
- [ ] Export from module index

### Step 3: Integrate into translate-mode helper (bot layer)

- [ ] In `apps/bot/src/scenes/helpers/translate-mode.helper.ts`:
  - Import `resolveTranslationDirection` from `@polyglot/core`
  - Replace hardcoded `sourceLang: nativeLang` / `targetLangs: learningLangs` with:
    ```typescript
    const { sourceLang, targetLangs, detectedLang } = resolveTranslationDirection({
      text: word,
      nativeLang,
      learningLangs,
    });
    ```
  - Pass resolved `sourceLang` and `targetLangs` to `translateWithContext()`
- [ ] Optionally log `detectedLang` for observability

### Step 4: Integrate into topics and notifications (if applicable)

- [ ] Review `packages/core/src/modules/topics/topic.service.ts` — topics always translate from source dataset language, **no change needed** (source lang is dataset-defined, not user input)
- [ ] Review `packages/adapters/notifications/src/notification.service.ts` — notifications use stored words with known `sourceLang`, **no change needed**
- [ ] Confirm: auto-detection is **only needed** in the translate-mode helper where the user types free-form text

### Step 5: Add i18n keys (optional, for display)

- [ ] Consider adding an optional indicator in the translation card showing the detected source language, e.g. "(detected: English)" — especially useful when the detected language differs from the native language
- [ ] If added, create i18n keys:
  - `detectedLang` — "Detected: {lang}" (for the translation card header)
- [ ] Add translations for all locales (en, ru, cs)

### Step 6: Write tests

- [ ] `packages/core/src/modules/language-detect/__tests__/detect-language.test.ts`:
  - Detects Russian from Cyrillic text
  - Detects English from Latin text when candidates include English
  - Detects Czech from Latin text when candidates include Czech (with diacritics like ř, ž, č)
  - Returns `undefined` for ambiguous short input
  - Returns `undefined` when detected language is not in candidates
  - Script-based fallback for single-word inputs
  - Empty text returns `undefined`
- [ ] `packages/core/src/modules/language-detect/__tests__/resolve-direction.test.ts`:
  - Native language input → standard direction (source=native, targets=learning)
  - Learning language input → reversed direction (source=detected, targets=native+remaining learning)
  - Unknown input → fallback to native as source
  - Single learning language: detected=learning → targets=[native] only
  - Multiple learning languages: detected=one → targets=[native, ...others]
- [ ] `apps/bot/src/scenes/helpers/__tests__/translate-mode-detection.test.ts`:
  - Integration test: Russian user types English → sourceLang is "en", targetLangs includes "ru"
  - Integration test: Russian user types Russian → sourceLang is "ru", targetLangs are learning langs
- [ ] All existing tests pass: `pnpm test`

---

## Architecture Constraints

| Package                        | Change scope                              | Notes                                                              |
| ------------------------------ | ----------------------------------------- | ------------------------------------------------------------------ |
| `packages/core/`               | New `language-detect` module              | Pure functions, no DB/infra deps. Uses `franc` (already in deps)   |
| `apps/bot/`                    | `translate-mode.helper.ts` updated        | Calls `resolveTranslationDirection()` before translation           |
| `packages/adapters/ai/`        | No changes                                | Translation pipeline unaffected                                    |
| `packages/adapters/db/`        | No changes                                | User settings schema unchanged                                     |
| `packages/core/src/modules/i18n/` | Optional: new key for detected lang display |                                                                  |

The detection module is **fully encapsulated** in core — pure functions with no side effects. The bot layer is the only consumer. The translation pipeline itself (`translate()`, `translateWithContext()`) is unchanged — it already accepts arbitrary `sourceLang` / `targetLangs`.

---

## Edge Cases

| Scenario                                           | Behavior                                                     |
| -------------------------------------------------- | ------------------------------------------------------------ |
| User types a single character ("a")                | `franc` unreliable → script heuristic → fallback to native   |
| User types mixed-script text ("hello привет")      | `franc` may detect one → if ambiguous, fallback to native    |
| User types a number or emoji only                  | No language detected → fallback to native                    |
| User types in a language not in native/learning    | Not in candidates → fallback to native                       |
| Czech and Slovak (very similar)                    | `franc` may confuse → candidates filter helps (only match configured langs) |
| User has only 1 learning language (e.g., cs)       | Detected=cs → source=cs, targets=[native]. Detected=native → source=native, targets=[cs] |

---

## Key Risks & Mitigations

| Risk                                                  | Mitigation                                                                                    |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `franc` misdetects short text                         | Script-based heuristic fallback for 1–2 word inputs; candidates filter limits false positives  |
| Detection adds latency                                | `franc` is fast (~1ms for short text); negligible vs AI call latency                          |
| User expects to always translate from native          | Detected language indicator in card makes direction transparent; behavior matches intuition    |
| Similar languages confused (cs/sk, ru/uk)             | Candidates list limits detection to user's configured languages only                          |
| Breaking change for users who type foreign words intentionally as native input | Fallback is always native→learning; only confident detections override |

---

## Acceptance Criteria

- [ ] Typing a word in a learning language auto-detects it and translates TO the native language (+ other learning langs)
- [ ] Typing a word in the native language works as before (translates to all learning langs)
- [ ] Short/ambiguous input falls back to native→learning direction (no crash, no wrong detection)
- [ ] Detection only applies to free-form user input in translate mode (not topics, not notifications)
- [ ] `detectLanguage()` and `resolveTranslationDirection()` are pure functions in core with full test coverage
- [ ] All new and existing tests pass: `pnpm test`
- [ ] All packages build: `pnpm -r run build`

---

## File Structure (planned)

```
packages/core/src/modules/language-detect/
├── index.ts                    # Re-exports: detectLanguage, resolveTranslationDirection, types
├── detect-language.ts          # detectLanguage() — franc + script heuristics
├── resolve-direction.ts        # resolveTranslationDirection() — direction logic
├── types.ts                    # ResolveDirectionInput, TranslationDirection
└── __tests__/
    ├── detect-language.test.ts
    └── resolve-direction.test.ts
```
