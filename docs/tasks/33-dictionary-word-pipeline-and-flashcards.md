# Task 33 — Config-Driven Dictionary Word Pipeline + Flash Cards

**Status:** 🔲 To Do  
**Type:** Feature (new core module + DB + bot scene)  
**Priority:** High — first active use of the personal dictionary; enables SRS, quizzes, notifications  
**Dependencies:**
- Task 30/FEAT-30 (Save to Dictionary must be live — words must exist in the `words` table with `sourceLangId` and `inputType`)
- Task 32 (User Translation Template — provides `TemplateFields` for field visibility instead of a local `PresentationFields` type)

---

## Goal

Build a **config-driven dictionary word pipeline** that reads words from a user's personal dictionary and delivers them to any output format. Implement **flash cards** as the first output. The pipeline architecture must be extensible: notifications, quizzes, and exports must be addable without touching the pipeline core.

### Why Config-Driven?

- One config object controls everything: which words to pick, what data to show, how to format them
- The same pipeline powers flash cards today, notifications + quizzes tomorrow
- Strategies, filters, and renderers are swappable without rewiring

### Target User Flow (Flash Cards)

```
User: /flashcard
Bot: 📚 Flash Cards — 10 words in your deck.
     [▶️ Start]

Bot: Card 1 of 10
     🍎 apple  [word · EN]
     [👁 Reveal]   [✕ Quit]

User: [👁 Reveal]
Bot: Card 1 of 10
     🍎 apple  [word · EN]

     🇷🇺 яблоко  [ˈjabləkə]
     neutral · A1
     🇨🇿 jablko  [ˈjablkɔ]
     neutral · A1

     [▶️ Next]   [✕ Quit]

... (after last card)
Bot: 🎉 Done! Reviewed 10 words.
     [🔄 Restart]   [✕ Close]
```

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│                   DictionaryWordConfig                │
│   selection: { strategy, limit, filter }              │
│   presentation: { fields, targetLangs, flashcard }    │
└────────────────────┬─────────────────────────────────┘
                     │
          ┌──────────▼──────────┐
          │  createDictPipeline  │  packages/core/…/dictionary-pipeline/
          │  selectWords()       │  ← runs DB query via injected repo
          │  buildDisplayData()  │  ← normalizes StoredWordContent
          └──────────┬──────────┘
                     │ WordPipelineResult[]
         ┌───────────┴──────────────┐
         │                          │
  ┌──────▼──────┐           ┌───────▼──────┐
  │ Flash Card  │           │ Notification │  (future)
  │ Bot Scene   │           │ Renderer     │
  │ (grammY)    │           └──────────────┘
  └─────────────┘
```

---

## What Is Already in Place (Do Not Re-Implement)

| Existing Feature | Location |
|---|---|
| `words` table with `original`, `sourceLangId`, `inputType`, `content` (JSONB) | `packages/adapters/db/src/schema.ts` |
| `wordRepository.findByUser()` | `packages/adapters/db/src/repositories/word.repository.ts` |
| `StoredWordContent` type (`emoji`, `register`, `translations[lang]`) | `packages/adapters/db/src/repositories/word.repository.ts` |
| `LanguageTranslation` type with full nested fields | `packages/core/src/modules/translation/types.ts` |
| `getLangFlag()`, `getLangDisplay()`, language helpers | `@polyglot/core` |
| `t()` i18n function, `SupportedLang` | `@polyglot/core` |
| `BotContext`, `SessionData` | `apps/bot/src/types.ts` |
| Translation card renderer pattern | `apps/bot/src/renderers/translation.renderer.ts` |

---

## Subtasks

---

### Step 1 — Core Types: `DictionaryWordConfig` and Supporting Interfaces

**Location:** `packages/core/src/modules/dictionary-pipeline/types.ts`

**Goal:** Define the single config object that controls the entire pipeline. All consumers (flash cards, notifications, quizzes) use this type.

- [ ] Create `packages/core/src/modules/dictionary-pipeline/` directory
- [ ] Create `types.ts` with the following types:

```typescript
import type { CefrLevel, Example, ExpressionType, Register, Synonym, TranslationVariant } from '../translation/types.js';
import type { TemplateFields } from '../../shared/translation-template.types.js';

/** Strategy for selecting words from the dictionary */
export type WordSelectionStrategy =
  | 'random'          // random shuffle
  | 'oldest_first'    // createdAt ASC — review old words
  | 'newest_first'    // createdAt DESC — review recent additions
  | 'least_reviewed'; // fewest entries in word_review_log (requires log table)
  // 'spaced_repetition' — reserved for SRS milestone (Milestone 2.0)

/** Filters applied before strategy selects words */
export interface WordFilter {
  /** Only include words of these input types */
  inputType?: Array<'word' | 'phrase'>;
  /** Only include words with this source language ID */
  sourceLangId?: number;
  /** Only include words that have a translation for this target language */
  targetLang?: string;
  /** Only include words whose stored CEFR matches (any of these levels) */
  cefr?: CefrLevel[];
  /** Exclude these word IDs (already shown in current session) */
  excludeIds?: number[];
}

/** Word selection configuration */
export interface WordSelectionConfig {
  strategy: WordSelectionStrategy;
  /** How many words to select. Default: 10 */
  limit: number;
  filter?: WordFilter;
}

/**
 * Which fields to include when presenting a word.
 *
 * ⚠️ Task 32 Integration:
 * DO NOT define a local PresentationFields type.
 * Import TemplateFields from @polyglot/core (Task 32) instead.
 * The pipeline reads the user's saved template via
 * translationTemplateRepository.getByUserId() and uses TemplateFields
 * directly for field visibility.
 *
 * Mapping:
 *   TemplateFields.transcription      → show/hide transcription
 *   TemplateFields.synonyms           → show/hide synonyms
 *   TemplateFields.examples           → show/hide examples
 *   TemplateFields.alternatives       → show/hide alternatives
 *   TemplateFields.equivalentNote     → show/hide expression notes
 *   TemplateFields.connotationWarning → show/hide connotation warnings
 *
 * CEFR and register are system-controlled (not in TemplateFields):
 *   showCefr     → hardcoded per preset (true in flash cards)
 *   showRegister → hardcoded per preset (true in flash cards)
 */

/** Flash-card-specific presentation config */
export interface FlashCardPresentationConfig {
  /** Which side is shown first. Default: 'original' */
  frontSide: 'original' | 'translation';
}

/** Presentation configuration */
export interface PresentationConfig {
  /** Which target language translations to include. null = all stored langs */
  targetLangs?: string[];
  /**
   * Field visibility — loaded from the user's saved template (Task 32).
   * Use resolveTemplate(userTemplate).fields to get TemplateFields.
   */
  fields: TemplateFields;
  /** System-controlled flags not in TemplateFields */
  showCefr: boolean;
  showRegister: boolean;
  flashcard?: FlashCardPresentationConfig;
}

/** Top-level config object — one config drives the entire pipeline */
export interface DictionaryWordConfig {
  selection: WordSelectionConfig;
  presentation: PresentationConfig;
}

/** Normalized translation data for a single target language (display-ready) */
export interface WordDisplayTranslation {
  text: string;
  cefr?: CefrLevel;
  transcription?: string;
  register?: Register;
  synonyms?: Synonym[];
  examples?: Example[];
  alternatives?: TranslationVariant[];
  expressionType?: ExpressionType;
  equivalentNote?: string;
}

/** Normalized word data ready for any renderer (Telegram, export, quiz, etc.) */
export interface WordDisplayData {
  /** DB primary key — used to log reviews, link to saved entry */
  id: number;
  original: string;
  /** ISO 639-1 source language code (e.g. "en") */
  sourceLang: string;
  inputType: 'word' | 'phrase';
  emoji: string;
  register: Register;
  createdAt: Date;
  /** Translations keyed by ISO 639-1 target language code */
  translations: Record<string, WordDisplayTranslation>;
}

/** Result from running the pipeline for a single user */
export interface WordPipelineResult {
  words: WordDisplayData[];
  meta: {
    /** Total active words in the user's dictionary (before filter/limit) */
    totalInDictionary: number;
    /** Number of words actually selected */
    selectedCount: number;
    strategy: WordSelectionStrategy;
  };
}

/** Dependencies injected into the pipeline — keeps core free of DB imports */
export interface DictionaryPipelineDeps {
  /**
   * Fetch all active words for a user.
   * Pipeline applies strategy + filters on top of this.
   */
  findWordsByUser: (userId: number) => Promise<Array<{
    id: number;
    original: string;
    sourceLangId: number;
    sourceLang: string;  // resolved from sourceLangId via join/cache
    inputType: string;
    content: import('../../..').StoredWordContent;
    createdAt: Date;
  }>>;
  /** Fetch review count per word ID for the given user (for 'least_reviewed') */
  getReviewCounts?: (userId: number) => Promise<Map<number, number>>;
}
```

> **Note:** `DictionaryPipelineDeps.findWordsByUser` expects `sourceLang` (code) resolved.
> The DB adapter layer must join `words` with `languages` or use the existing language cache
> (`getLang(id)`) to resolve `sourceLangId → code` before returning.

---

### Step 2 — Pipeline Presets

**Location:** `packages/core/src/modules/dictionary-pipeline/presets.ts`

**Goal:** Named preset configs — callers import a preset, never build config inline.

- [ ] Create `presets.ts`:

```typescript
import type { DictionaryWordConfig } from './types.js';

/** Default flash card session — 10 random words, all fields visible */
export const FLASHCARD_CONFIG: DictionaryWordConfig = {
  selection: {
    strategy: 'random',
    limit: 10,
  },
  presentation: {
    fields: {
      showTranscription: true,
      showSynonyms: true,
      showExamples: true,
      showAlternatives: true,
      showCefr: true,
      showRegister: true,
    },
    flashcard: { frontSide: 'original' },
  },
};

/** Notification daily review — 1 least-reviewed word, compact format */
export const NOTIFICATION_DICT_CONFIG: DictionaryWordConfig = {
  selection: {
    strategy: 'least_reviewed',
    limit: 1,
  },
  presentation: {
    fields: {
      showTranscription: true,
      showSynonyms: false,
      showExamples: false,
      showAlternatives: false,
      showCefr: true,
      showRegister: false,
    },
  },
};

/** Word-of-the-day from dictionary — oldest unreviewed */
export const WORD_OF_DAY_DICT_CONFIG: DictionaryWordConfig = {
  selection: {
    strategy: 'oldest_first',
    limit: 1,
  },
  presentation: {
    fields: {
      showTranscription: true,
      showSynonyms: true,
      showExamples: false,
      showAlternatives: false,
      showCefr: true,
      showRegister: true,
    },
  },
};
```

---

### Step 3 — Pipeline Core Function

**Location:** `packages/core/src/modules/dictionary-pipeline/pipeline.ts`

**Goal:** Pure function that takes config + userId + deps → returns selected + normalized `WordPipelineResult`.

- [ ] Create `pipeline.ts`:

```typescript
export function createDictionaryPipeline(deps: DictionaryPipelineDeps) {
  return {
    async run(userId: number, config: DictionaryWordConfig): Promise<WordPipelineResult>
  };
}
```

**Selection logic per strategy:**
- `random`: shuffle the filtered array; take `limit` items (`Math.random()` sort)
- `oldest_first`: sort by `createdAt ASC`; take `limit`
- `newest_first`: sort by `createdAt DESC`; take `limit`
- `least_reviewed`: merge with review counts (0 for never reviewed); sort by count ASC, then `createdAt ASC` as tiebreaker; take `limit`

**Filter logic (applied before strategy):**
- `inputType`: keep words matching any of the listed input types
- `sourceLangId`: keep words with matching source language ID
- `targetLang`: keep words whose `content.translations` has a key equal to `targetLang`
- `cefr`: keep words where ANY target lang translation in the content matches the CEFR list
- `excludeIds`: remove words whose `id` is in the exclude list

**Display data building** (`buildDisplayData(word, config) → WordDisplayData`):
- Map `StoredWordContent` fields to `WordDisplayData`
- Apply `presentation.targetLangs` filter: if set, only include those keys in `translations`
- Apply `presentation.fields` masking:
  - `showTranscription: false` → omit `transcription`
  - `showSynonyms: false` → omit `synonyms`
  - `showExamples: false` → omit `examples`
  - `showAlternatives: false` → omit `alternatives`
  - `showCefr: false` → omit `cefr`
  - `showRegister: false` → omit `register` on both `WordDisplayData` and each `WordDisplayTranslation`

**Implementation rules:**
- No DB imports — all data access via `deps`
- Pure functions for selection and filtering (no side effects)
- `logger.debug(...)` on strategy/filter results

---

### Step 4 — `index.ts` Export

**Location:** `packages/core/src/modules/dictionary-pipeline/index.ts`

- [ ] Export all public types and functions:
  ```typescript
  export * from './types.js';
  export * from './presets.js';
  export { createDictionaryPipeline } from './pipeline.js';
  ```
- [ ] Add `dictionary-pipeline` to `packages/core/src/index.ts` barrel exports

---

### Step 5 — DB: `word_review_log` Table + Repository

**Location:**
- Schema: `packages/adapters/db/src/schema.ts`
- Migration: `packages/adapters/db/drizzle/0008_word_review_log.sql`
- Repository: `packages/adapters/db/src/repositories/word-review.repository.ts`

**Goal:** Track when a user reviewed each word (flash card shown, notification sent, quiz answered). Required for `least_reviewed` strategy and future SRS scheduling.

#### 5a — Schema addition in `schema.ts`

- [ ] Add to `schema.ts`:

```typescript
export const wordReviewLog = pgTable(
  'word_review_log',
  {
    id: serial('id').primaryKey(),
    wordId: integer('word_id')
      .references(() => words.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** What triggered this review: 'flashcard' | 'notification' | 'quiz' | 'srs' */
    sessionType: text('session_type').notNull(),
    reviewedAt: timestamp('reviewed_at').defaultNow().notNull(),
  },
  (t) => [
    index('word_review_log_word_idx').on(t.wordId),
    index('word_review_log_user_date_idx').on(t.userId, t.reviewedAt),
  ],
);
```

#### 5b — Migration file `0008_word_review_log.sql`

- [ ] Write migration:

```sql
CREATE TABLE IF NOT EXISTS "word_review_log" (
  "id" serial PRIMARY KEY NOT NULL,
  "word_id" integer NOT NULL REFERENCES "words"("id") ON DELETE cascade,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "session_type" text NOT NULL,
  "reviewed_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX "word_review_log_word_idx" ON "word_review_log" ("word_id");
CREATE INDEX "word_review_log_user_date_idx" ON "word_review_log" ("user_id", "reviewed_at");
```

#### 5c — `word-review.repository.ts`

- [ ] Create repository with these methods:

```typescript
export const wordReviewRepository = {
  /** Log that a word was reviewed in a session */
  async logReview(userId: number, wordId: number, sessionType: string): Promise<void>,

  /**
   * Get review counts per word for the given user.
   * Returns Map<wordId, reviewCount>.
   * Words with no reviews are NOT in the map (treat as 0 externally).
   */
  async getReviewCounts(userId: number): Promise<Map<number, number>>,

  /** Get reviews for a single word (for SRS scheduling, future use) */
  async getReviewsForWord(wordId: number, limit?: number): Promise<WordReview[]>,
};
```

#### 5d — `wordRepository` extension: `findByUserWithSourceLang()`

The pipeline needs `sourceLang` code, not `sourceLangId`. Extend `wordRepository`:

- [ ] Add to `word.repository.ts`:

```typescript
/**
 * Find all active words for a user with resolved sourceLang code.
 * Resolves sourceLangId → code via the in-memory language cache (getLang).
 * Used by the dictionary word pipeline.
 */
async findByUserWithSourceLang(userId: number): Promise<WordWithSourceLang[]>

export interface WordWithSourceLang extends Word {
  sourceLang: string;  // resolved ISO 639-1 code
}
```

> Use `getLang(id)` from `@polyglot/adapter-db` (in-memory language cache already populated at startup).
> Fall back to `'unknown'` with a `logger.warn` if the language is not in cache.

---

### Step 6 — Bot: Flash Card Renderer

**Location:** `apps/bot/src/renderers/flashcard.renderer.ts`

**Goal:** Telegram-specific rendering of `WordDisplayData` as HTML messages + inline keyboards.

- [ ] Create `flashcard.renderer.ts` with these functions:

```typescript
/**
 * Render the FRONT of a flash card (original word, no translations).
 * Shown before user taps "Reveal".
 */
export function renderFlashCardFront(
  word: WordDisplayData,
  cardIndex: number,     // 1-based
  totalCards: number,
  lang: SupportedLang,
): string;

/**
 * Render the BACK of a flash card (original word + all translations).
 * Shown after user taps "Reveal".
 */
export function renderFlashCardBack(
  word: WordDisplayData,
  cardIndex: number,
  totalCards: number,
  lang: SupportedLang,
): string;

/** Build the keyboard for the front of a card (before reveal) */
export function buildFlashCardFrontKeyboard(lang: SupportedLang): InlineKeyboard;

/** Build the keyboard for the back of a card (after reveal) */
export function buildFlashCardBackKeyboard(
  isLastCard: boolean,
  lang: SupportedLang,
): InlineKeyboard;

/** Build the keyboard for the session-complete screen */
export function buildFlashCardDoneKeyboard(lang: SupportedLang): InlineKeyboard;
```

**Card front format:**
```
Card {n} of {total}

{emoji} <b>{original}</b>
<i>{inputType} · {sourceLang flag}</i>
```

**Card back format:**
```
Card {n} of {total}

{emoji} <b>{original}</b>
<i>{inputType} · {sourceLang flag}</i>

{foreach targetLang}
{flag} <b>{text}</b>{transcription ? " [" + transcription + "]" : ""}
{cefr ? "CEFR: " + cefr : ""}{register ? " · " + register : ""}
{synonyms if showSynonyms: "(syn1, syn2)"}
{examples if showExamples: "💬 sentence → context"}
```

**Keyboards:**
- Front: `[👁 Reveal]  [✕ Quit]` — callbacks `fc:reveal`, `fc:quit`
- Back (not last): `[▶️ Next]  [✕ Quit]` — callbacks `fc:next`, `fc:quit`
- Back (last card): `[🎉 Done!]  [🔄 Restart]` — callbacks `fc:done`, `fc:restart`
- Session complete: `[🔄 New Deck]  [✕ Close]` — callbacks `fc:restart`, `fc:close`

---

### Step 7 — Bot: Flash Card Scene

**Location:** `apps/bot/src/scenes/flashcard.scene.ts`

**Goal:** grammY conversation/scene that manages a flash card session. Handles deck lifecycle from start to last card.

#### Session state additions

- [ ] Extend `SessionData` in `apps/bot/src/types.ts` with:

```typescript
/** Flash card session state */
flashcard?: {
  /** Ordered word IDs for this deck */
  deckIds: number[];
  /** Words already selected (from pipeline) — stored for rendering without re-fetch */
  deck: WordDisplayData[];
  /** Current position in deck (0-based index) */
  currentIndex: number;
  /** Message ID of the current card message (for in-place editing) */
  cardMsgId?: number;
  /** Config used to generate this deck */
  config: DictionaryWordConfig;
};
```

#### Callback handlers

Implement callbacks as message handlers (not as a conversation, to survive session restarts):

| Callback | Action |
|---|---|
| `fc:start` | Build deck, show first card front |
| `fc:reveal` | Edit current card to show back |
| `fc:next` | Log review, advance index, show next card front |
| `fc:done` | Log review, show completion screen |
| `fc:restart` | Clear session, rebuild deck, show first card |
| `fc:quit` | Log review, clear session, show quit message |
| `fc:close` | Delete the card message |

#### Scene logic

```
/flashcard command:
  1. Call pipeline: createDictionaryPipeline(deps).run(userId, FLASHCARD_CONFIG)
  2. If words.length == 0 → reply t('flashcardEmpty', lang)
  3. Store result in session.flashcard
  4. Send message: t('flashcardStart', lang, { count: words.length }) + [▶️ Start] keyboard
     callback: fc:start

fc:start:
  1. Edit message to show card 0 front (renderFlashCardFront)
  2. Store message ID in session.flashcard.cardMsgId

fc:reveal:
  1. Edit message to show card back (renderFlashCardBack)

fc:next:
  1. Log review for current word: wordReviewRepository.logReview(userId, wordId, 'flashcard')
  2. Increment session.flashcard.currentIndex
  3. Edit message to show next card front
  4. If currentIndex >= deck.length → should not happen (fc:done is used for last card)

fc:done:
  1. Log review for last word
  2. Edit message to show completion screen: t('flashcardDone', lang, { count: deck.length })

fc:restart:
  1. Re-run pipeline (fresh deck, new random order)
  2. Reset session.flashcard
  3. Show first card front

fc:quit:
  1. Log review if currentIndex > 0 (user viewed at least one card)
  2. Clear session.flashcard
  3. Edit message to t('flashcardQuit', lang)

fc:close:
  1. Delete message
  2. Clear session.flashcard
```

#### Wiring into the bot

- [ ] Register `/flashcard` command handler in `apps/bot/src/index.ts`
- [ ] Register all `fc:*` callback handlers in `apps/bot/src/index.ts` (or a dedicated `flashcard-callbacks.ts` helper)
- [ ] Add `flashcard` to the bot command list (`apps/bot/src/commands/start.ts` or command registration)

---

### Step 8 — i18n Keys

**Goal:** Add all flash card UI strings to all 3 locale files.

- [ ] Add to `packages/core/src/modules/i18n/locales/en.json`:

```json
{
  "flashcardStart": "📚 Flash Cards — {count} words in your deck.",
  "flashcardStartBtn": "▶️ Start",
  "flashcardEmpty": "📖 Your dictionary is empty. Translate some words and save them first!",
  "flashcardReveal": "👁 Reveal",
  "flashcardNext": "▶️ Next",
  "flashcardDone": "🎉 Done! You reviewed {count} words.",
  "flashcardQuit": "👋 Flash card session ended.",
  "flashcardRestart": "🔄 New Deck",
  "flashcardClose": "✕ Close",
  "flashcardProgress": "Card {current} of {total}",
  "flashcardQuitBtn": "✕ Quit",
  "flashcardDoneBtn": "🎉 Done!",
  "flashcardNewDeckBtn": "🔄 New Deck"
}
```

- [ ] Add equivalent keys to `ru.json` (Russian translations)
- [ ] Add equivalent keys to `cs.json` (Czech translations)

---

### Step 9 — Wire Pipeline Deps in Bot Layer

**Location:** `apps/bot/src/scenes/flashcard.scene.ts` (or a `flashcard.deps.ts` helper)

**Goal:** Create the `DictionaryPipelineDeps` implementation that uses the existing DB adapter.

```typescript
const pipelineDeps: DictionaryPipelineDeps = {
  findWordsByUser: async (userId) => {
    const words = await wordRepository.findByUserWithSourceLang(userId);
    return words;
  },
  getReviewCounts: async (userId) => {
    return wordReviewRepository.getReviewCounts(userId);
  },
};
```

> The pipeline is constructed once at module load: `const pipeline = createDictionaryPipeline(pipelineDeps)`

---

### Step 10 — Tests

#### Unit Tests — Pipeline Core

**Location:** `packages/core/src/modules/dictionary-pipeline/__tests__/`

- [ ] `pipeline.test.ts`:
  - `random` strategy: returns `limit` words from a pool (all different, from pool)
  - `oldest_first`: returns sorted by createdAt ASC
  - `newest_first`: returns sorted by createdAt DESC
  - `least_reviewed`: returns word with review count 0 before word with count 5
  - Filter `inputType`: excludes words not matching
  - Filter `excludeIds`: excludes specified word IDs
  - Filter `targetLang`: excludes words missing that lang in translations
  - Empty dictionary: returns empty `WordPipelineResult`
  - `totalInDictionary` meta reflects full pool size, `selectedCount` reflects after limit
  - `presentation.targetLangs` filter: output only includes requested langs
  - `showSynonyms: false`: synonyms absent from `WordDisplayTranslation`
  - `showExamples: false`: examples absent

- [ ] `presets.test.ts`:
  - `FLASHCARD_CONFIG.selection.strategy === 'random'`
  - `FLASHCARD_CONFIG.selection.limit === 10`
  - `NOTIFICATION_DICT_CONFIG.selection.limit === 1`
  - All presets are valid `DictionaryWordConfig` objects (compile-time + runtime)

#### Unit Tests — Word Review Repository

**Location:** `packages/adapters/db/src/__tests__/word-review.repository.test.ts`

- [ ] `logReview()`: inserts a row into `word_review_log`
- [ ] `getReviewCounts()`: returns correct counts per word ID
- [ ] `getReviewCounts()` for user with no reviews: returns empty Map
- [ ] `getReviewsForWord()`: returns reviews in desc order

#### Unit Tests — Flash Card Renderer

**Location:** `apps/bot/src/__tests__/flashcard.renderer.test.ts`

- [ ] `renderFlashCardFront()`: contains original word, progress string, NOT translation text
- [ ] `renderFlashCardBack()`: contains original + all translations, CEFR if enabled
- [ ] `renderFlashCardBack()` with `showSynonyms: false`: no synonyms in output
- [ ] `buildFlashCardFrontKeyboard()`: has `fc:reveal` and `fc:quit` buttons
- [ ] `buildFlashCardBackKeyboard(isLastCard: false)`: has `fc:next` and `fc:quit`
- [ ] `buildFlashCardBackKeyboard(isLastCard: true)`: has `fc:done` and `fc:restart`
- [ ] `buildFlashCardDoneKeyboard()`: has `fc:restart` and `fc:close`

---

## Files to Create

| File | Description |
|---|---|
| `packages/core/src/modules/dictionary-pipeline/types.ts` | All types for the pipeline |
| `packages/core/src/modules/dictionary-pipeline/presets.ts` | Named config presets |
| `packages/core/src/modules/dictionary-pipeline/pipeline.ts` | `createDictionaryPipeline()` |
| `packages/core/src/modules/dictionary-pipeline/index.ts` | Barrel exports |
| `packages/core/src/modules/dictionary-pipeline/__tests__/pipeline.test.ts` | Pipeline unit tests |
| `packages/core/src/modules/dictionary-pipeline/__tests__/presets.test.ts` | Preset validation tests |
| `packages/adapters/db/drizzle/0008_word_review_log.sql` | DB migration |
| `packages/adapters/db/src/repositories/word-review.repository.ts` | Review log repository |
| `packages/adapters/db/src/__tests__/word-review.repository.test.ts` | Repository tests |
| `apps/bot/src/renderers/flashcard.renderer.ts` | Telegram flash card renderer |
| `apps/bot/src/__tests__/flashcard.renderer.test.ts` | Renderer tests |
| `apps/bot/src/scenes/flashcard.scene.ts` | Flash card scene + callbacks |

## Files to Modify

| File | Change |
|---|---|
| `packages/core/src/index.ts` | Add `dictionary-pipeline` barrel export |
| `packages/adapters/db/src/schema.ts` | Add `wordReviewLog` table |
| `packages/adapters/db/src/repositories/word.repository.ts` | Add `findByUserWithSourceLang()` |
| `packages/adapters/db/src/index.ts` | Export `wordReviewRepository` |
| `apps/bot/src/types.ts` | Add `flashcard?: {...}` to `SessionData` |
| `apps/bot/src/index.ts` | Register `/flashcard` command + `fc:*` callbacks |
| `packages/core/src/modules/i18n/locales/en.json` | Add flashcard i18n keys |
| `packages/core/src/modules/i18n/locales/ru.json` | Add flashcard i18n keys |
| `packages/core/src/modules/i18n/locales/cs.json` | Add flashcard i18n keys |

---

## Architecture Constraints

| Rule | Details |
|---|---|
| No DB in core | `packages/core` must not import `@polyglot/adapter-db`. Pipeline receives deps via injection. |
| No bot imports in core | `packages/core` must not import grammY or any bot-specific types. |
| No cross-module imports in core | `dictionary-pipeline` imports only from `translation/types.ts` and `shared/types.ts` |
| Presets are the only configs | Callers must use named presets from `presets.ts`. Custom configs only in tests. |
| Session size | `WordDisplayData[]` stored in session must be bounded. `FLASHCARD_CONFIG.selection.limit` caps at 20 max. |
| Review logging is best-effort | Errors in `wordReviewRepository.logReview()` must be caught and logged — never rethrow or block UX |

---

## Edge Cases

| Scenario | Expected Behavior |
|---|---|
| Dictionary is empty | Flash card command replies with `flashcardEmpty` — no deck started |
| Dictionary has fewer words than `limit` | All words are used; `selectedCount < limit` is valid |
| `targetLangs` filter yields empty translations | Word is excluded from deck (no renderable content) |
| `excludeIds` excludes all words | Empty deck → `flashcardEmpty` reply |
| Session lost mid-deck (bot restart) | `fc:reveal/next` with no `session.flashcard` → `answerCallbackQuery` with "Session expired, use /flashcard to restart" |
| `least_reviewed` with no review log entries | All words treated as count 0 → falls back to `oldest_first` tiebreaker |
| User has words in deck but all `isActive: false` | `findByUserWithSourceLang()` already filters `isActive = true` — handled at DB level |
| Concurrency: two taps on `fc:next` | `editMessageText` will throw on second call (Telegram "message not modified") — catch and ignore |

---

## Effort Estimate

~8–10 hours

---

## Acceptance Criteria

- [ ] `packages/core/src/modules/dictionary-pipeline/` module exists with `DictionaryWordConfig`, `WordPipelineResult`, `WordDisplayData` types
- [ ] `createDictionaryPipeline(deps).run(userId, config)` returns words selected by the specified strategy with filters applied
- [ ] `FLASHCARD_CONFIG`, `NOTIFICATION_DICT_CONFIG`, `WORD_OF_DAY_DICT_CONFIG` presets exported from `@polyglot/core`
- [ ] `word_review_log` table exists in DB schema with migration `0008_word_review_log.sql`
- [ ] `wordReviewRepository.logReview()` inserts a review entry
- [ ] `wordReviewRepository.getReviewCounts()` returns correct counts per word ID
- [ ] `wordRepository.findByUserWithSourceLang()` returns words with resolved `sourceLang` code
- [ ] `/flashcard` command starts a 10-word flash card session
- [ ] Flash card front shows: emoji + original word + progress counter
- [ ] Tapping "👁 Reveal" shows translations with transcription, CEFR, synonyms
- [ ] Tapping "▶️ Next" logs a review and advances to the next card
- [ ] On last card: "🎉 Done!" button appears; tapping shows completion message
- [ ] "🔄 New Deck" builds a fresh deck (new random order)
- [ ] "✕ Quit" ends the session and logs partial completion
- [ ] All 3 locale files (en, ru, cs) have `flashcard*` keys
- [ ] Session loss mid-deck shows "Session expired" message on callback
- [ ] Review log errors never block UX (caught + logged)
- [ ] All new tests pass: `pnpm -r run test`
- [ ] All packages build: `pnpm -r run build`

---

## Future Extensions (Out of Scope Now)

These are explicitly deferred — the architecture supports them without rework:

| Feature | How to Add |
|---|---|
| `spaced_repetition` strategy | Add `'spaced_repetition'` to `WordSelectionStrategy`; implement SM-2 scheduler in Milestone 2.0 |
| Notification from dictionary (not topics) | Use `NOTIFICATION_DICT_CONFIG` preset in the notification service — swap `deps` implementation |
| Quiz mode | Add `QuizConfig` to `PresentationConfig`; create `quiz.scene.ts` using the same pipeline |
| Export dictionary | Add `export` format to `PresentationConfig`; implement CSV/JSON renderer outside the bot |
| `by_cefr` strategy | Add `'by_cefr'` to strategy enum; sort/filter on `cefr` field in content JSONB |
| `groupBy: 'source_lang'` | Add grouping to `WordSelectionConfig`; pipeline returns `Map<string, WordDisplayData[]>` |
| Session persistence for decks | Store `deckIds` in DB (new `flashcard_sessions` table) instead of session memory |
