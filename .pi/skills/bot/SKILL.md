---
name: bot
description: Telegram bot using grammY with conversations plugin. Manages scenes (onboarding, translate, dictionary, settings), commands, middleware, and renders AI responses. Use when implementing or modifying bot commands, scenes, middleware, or Telegram UI.
---

# bot Agent Skill

## Module Location

`apps/bot/src/`

## Architecture Context

- **Layer:** App (top-level, Telegram-specific)
- **Dependencies:** `i18n`, `db`, `translation`, `topics`, `notifications` agents
- **Dependents:** None — this is the entry point

## Current State

Already implemented:
- `index.ts` — grammY bot setup, session middleware (default mode: "translate"), mode router, callback handlers, graceful shutdown
- `types.ts` — BotContext, ConversationContext, UserMode, SessionData (with activeMode field, DB-persisted)
- `constants.ts` — LANGUAGES display data, langDisplay() (no business text — all i18n via core)
- `middlewares/auth.ts` — resolves/creates user, attaches to ctx.user; hydrates session activeMode from DB for onboarded users (Task 20)
- `middlewares/mode-router.ts` — routes plain text to active mode handler; idle mode falls back to translate for onboarded users (persisted to DB), shows /start hint for non-onboarded; debug logging for mode routing
- `commands/start.ts` — /start handler (onboarding or main menu); restores translate mode for onboarded users (persisted to DB)
- `scenes/onboarding.scene.ts` — 3-step onboarding conversation (BRD §5); infers interface language from native language; sets activeMode = "translate" on completion (persisted to DB)
- `scenes/translate.scene.ts` — mode-based: /translate sets mode and shows confirmation (persisted to DB)
- `scenes/helpers/translate-mode.helper.ts` — handles translation text, Save/Skip callbacks with FEAT-30 flow (FK resolution, dedup detection, sanitization); uses `translateWithContext()` from context-enrichment layer (dictionary context lookup delegated to `createContextLookup()` from DB adapter)
- `scenes/helpers/regen.helper.ts` — regeneration loop helper (per-language regen, FEAT-30 save with dedup/sanitize, skip)
- `renderers/translation.renderer.ts` — renderTranslation (HTML, template-aware), renderTopicWord (HTML), buildTranslationKeyboard (inline keyboard with inputType-aware save labels), buildPostSaveKeyboard (regen-only post-save keyboard), buildSourceLangKeyboard (source language selection keyboard)
- `scenes/template.scene.ts` — /template command handler (shows current template status with Customize/Reset buttons)
- `scenes/helpers/template.helper.ts` — Template wizard callback handlers (customize, toggle, preview, save, cancel, reset)
- `scenes/template-preview.data.ts` — Mock translation output for wizard preview

Still needed:
- `scenes/dictionary.scene.ts` — dictionary browsing
- `scenes/settings.scene.ts` — user settings

### Always-On Translation (Task 19)

Translation is always active for onboarded users. Multiple layers ensure no text message is silently dropped:
1. **Default session mode** is `"translate"` (not `"idle"`) — new/restarted sessions start translating
2. **Onboarding completion** sets `activeMode = "translate"` — freshly onboarded users can immediately send words
3. **`/start` for returning users** restores `activeMode = "translate"` — recovers after bot restart
4. **Idle mode fallback** in mode router: onboarded users get translated (with warn log), non-onboarded users get `/start` hint
5. **Debug logging** in mode router: logs `{ mode, text, userId }` on every routed message

### Translation Output Config Presets (Task 21, updated by Task 32)

Bot callers use `resolveOutputConfig()` from `@polyglot/core` to determine which sections appear in AI translation responses. For words/phrases, the user's custom template (from DB) is used when available; for sentences, `SENTENCE_OUTPUT` is always used regardless of template.

**Caller → preset mapping:**

| Caller | Preset | Rationale |
|---|---|---|
| `translate-mode.helper.ts` (`handleTranslateText`, word/phrase) | User template (via `resolveOutputConfig`) | Interactive translation — user-customized cards |
| `translate-mode.helper.ts` (`handleTranslateText`, sentence) | `SENTENCE_OUTPUT` (via `resolveOutputConfig`) | Sentence translation — compact, no learning metadata |
| `translate-mode.helper.ts` (`handleRegenCallback`, word/phrase) | User template (via `resolveOutputConfig`) | Regeneration — user-customized detail |
| `translate-mode.helper.ts` (`handleRegenCallback`, sentence) | `SENTENCE_OUTPUT` (via `resolveOutputConfig`) | Sentence regen — compact output |
| `regen.helper.ts` (`handleRegenLoop`, word/phrase) | User template (via `resolveOutputConfig`) | Conversation-based regen — user-customized |
| `regen.helper.ts` (`handleRegenLoop`, sentence) | `SENTENCE_OUTPUT` (via `resolveOutputConfig`) | Conversation-based regen — compact |

All callers use `resolveOutputConfig()` from `@polyglot/core` (Task 32) instead of importing named presets directly. This routes through the user's custom template when one is saved. Sentences always use `SENTENCE_OUTPUT` regardless of user template.

### Persistent activeMode in Database (Task 20)

The user's `activeMode` is now persisted in the `userLanguageSettings.activeMode` DB column so it survives bot restarts. The session is hydrated from DB on every request via the auth middleware.

**Read path:** Auth middleware loads settings for onboarded users → sets `ctx.session.activeMode` from DB value → validates against known modes (falls back to `"translate"` for unknown values).

**Write path:** Every mode change writes to both session AND DB simultaneously:
- `/start` for onboarded users → `updateActiveMode(userId, "translate")`
- `/translate` command → `updateActiveMode(userId, "translate")`
- Onboarding completion → `updateActiveMode(userId, "translate")` via `conversation.external()`
- Mode router idle→translate fallback → `updateActiveMode(userId, "translate")`

**Forward compatibility:** The `VALID_MODES` set in auth.ts and the `UserMode` type will be extended when "mentor" and "quiz" modes are implemented. Unknown DB values gracefully fall back to "translate".

### Post-Translation Source Language Selection Menu (Task 17)

After Save/Skip in translate mode, an inline keyboard menu is shown with buttons for each configured language (native + learning langs). The user can tap a button to set the source language for the next translation, bypassing auto-detection. Key implementation details:

- **Session state**: `SessionData.nextSourceLang?: string | null` — stores the explicit source language selection
- **Keyboard builder**: `buildSourceLangKeyboard(langs, currentSelection)` in `translation.renderer.ts` — renders language buttons with `tr:srclang:{code}` callback data, marks selected with ✓, returns null when user has ≤2 languages
- **Callback handler**: `handleSourceLangCallback(ctx)` in `translate-mode.helper.ts` — parses callback, sets session, answers with confirmation, updates keyboard in-place
- **Translation integration**: `handleTranslateText()` checks `nextSourceLang` first; if set, uses `resolveDirectionFromSource()` instead of auto-detect; validates against current config, resets if invalid
- **Menu suppression**: Not shown when user has only 1 native + 1 learning language (auto-detect sufficient)
- **i18n keys**: `nextTranslationFrom` (header), `nextSourceSet` (confirmation with `{lang}` param)

### Input Type Classification & Sentence Translation (Task 27)

The translate-mode helper now classifies user input as `word`, `phrase`, or `sentence` using `classifyInput()` from `apps/bot/src/utils/classify-input.ts`. Classification is based on word count (default thresholds: ≤2 → word, ≤6 → phrase, >6 → sentence). Punctuation is metadata only — NOT a hard classifier.

**Sentence behavior** differs from word/phrase in every layer:
- **Output preset:** `SENTENCE_OUTPUT` (no synonyms, alternatives, examples, equivalent note)
- **Dictionary context:** Skipped (no Wiktionary lookup for sentences)
- **Rendering:** `renderSentenceTranslation()` — compact card: emoji, original, per-language text + transcription only. No CEFR, synonyms, examples, alternatives.
- **Keyboard:** `buildSentenceKeyboard()` — regen buttons only, no Save/Skip
- **Session:** No `pendingTranslation` stored for sentences (nothing to save to dictionary)
- **Regen:** Uses `SENTENCE_OUTPUT` preset and sentence keyboard. Reads `lastTranslation` + `lastInputType` from session.
- **i18n:** `sentenceTranslation` label prepended to card

**Session additions:**
- `lastTranslation?: TranslateOutput` — last translation output (for regen, both words and sentences)
- `lastInputType?: InputType` — input classification of last translation

**Callback handler:** `handleRegenCallback()` registered for `tr:regen:*` pattern. Handles regeneration in persistent translate mode for both word/phrase and sentence inputs.

### Save to Dictionary — FEAT-30

The translate-mode save flow now implements the full FEAT-30 pipeline: FK resolution, duplicate detection, content sanitization, and in-place card editing.

**Save flow (handleSaveCallback):**
1. FK resolution: `getLang(sourceLang)` from language cache → `sourceLangId`
2. Duplicate detection: `wordRepository.findByOriginalAndSource(userId, original, sourceLangId)` → if exists, show "already saved" toast and return
3. Sanitize: `sanitizeForStorage(output)` strips `needsReview`, `dictionaryContext`, `original`, `sourceLang` — returns `StoredWordContent`
4. Persist: `wordRepository.create(userId, { original, sourceLangId, inputType, content })` with `CreateWordInput` shape
5. Session: set `savedWordId`, clear `pendingTranslation` and `pendingCardMsgId`
6. Edit card in-place: render with `savedToDict` text + `buildPostSaveKeyboard()` (regen-only)

**Post-save regen (handleRegenCallback):**
When `savedWordId` is set, regen auto-updates the saved DB entry via `wordRepository.updateContent()`. Card shows `savedToDict` text + `buildPostSaveKeyboard()`. `savedWordId` persists across regens.

**Session additions:**
- `savedWordId?: number` — set after successful save, enables auto-update on regen, cleared on new translation

**Keyboard changes:**
- `buildTranslationKeyboard(langCodes, inputType, interfaceLang)` — contextual save label: `saveWord` for words, `savePhrase` for phrases
- `buildPostSaveKeyboard(langCodes, interfaceLang)` — regen buttons only, no Save/Skip

**Utility:**
- `sanitizeForStorage(output: TranslateOutput): StoredWordContent` in `apps/bot/src/utils/sanitize-word-content.ts`

### Auto-Detect Input Language (Task 16)

The translate-mode helper now uses `resolveTranslationDirection()` from `@polyglot/core` to automatically detect the input language and adjust the translation direction:
- Input in native language → translates to all learning languages (unchanged behavior)
- Input in a learning language → translates to native + remaining learning languages (reversed direction)
- Ambiguous/unknown input → falls back to native→learning (safe default)

When the detected language differs from the native language (reversed direction), a `🔍 Detected: {lang}` indicator is prepended to the translation card using `getLanguageName()` for localized display names and the `detectedLang` i18n key.

### User Translation Template Constructor (Task 32)

Users can customize which fields appear in their translation output via `/template` command. The wizard uses inline keyboard toggles for 6 fields: transcription, synonyms, examples, alternatives, equivalentNote, connotationWarning.

**Session state**: `SessionData.templateWizard?: { fields: TemplateFields; wizardMsgId?: number }` — working copy during editing

**Command & callbacks:**
- `/template` → shows current template status (Default or Custom) with [📝 Customize] [🔄 Reset] buttons
- `tpl:customize` → initializes wizard with current fields, shows toggle keyboard
- `tpl:toggle:<key>` → toggles the field ✅↔❌, re-renders keyboard
- `tpl:preview` → renders mock translation card respecting current field toggles
- `tpl:save` → persists to DB via `translationTemplateRepository.upsert()`, clears wizard
- `tpl:cancel` → discards changes, clears wizard
- `tpl:reset` → deletes custom template from DB, restores default
- `tpl:back` → returns from preview to constructor

**Template-aware rendering**: `renderTranslation(output, lang, templateFields?)` accepts optional `TemplateFields`. When provided, disabled fields are omitted from the card. When undefined, all sections render (backward compat).

**Pipeline integration**: `handleTranslateText()` and `handleRegenCallback()` load the user's template via `translationTemplateRepository.getByUserId()`, then use `resolveOutputConfig()` (sentences → SENTENCE_OUTPUT, words/phrases → user template or default) and pass `effectiveTemplate.fields` to the renderer.

**i18n keys**: `templateTitle`, `templateCurrent` (with `{name}`), `templateDefault`, `templateCustom`, `templateCustomize`, `templateReset`, `templateConstructor`, `templatePreview`, `templateSave`, `templateCancel`, `templateBack`, `templateSaved`, `templateResetDone`, `templateCancelled`, `templateField*` (6 field labels), `templatePreviewHeader`, `templateSessionExpired`.

## Boundary

- **Mode:** role — when this skill is active, you ARE the bot agent. Only modify the Telegram bot layer.
- **Produces:** bot source code and tests in `apps/bot/src/`
- **Never:** modify code outside `apps/bot/src/`
- **Never:** contain business logic, direct DB access, or hardcoded strings
- **Never:** modify core packages (`packages/core/`) or adapter packages (`packages/adapters/`)
- **Allowed tools:** `read`, `bash`, `edit`, `write`
- **Allowed write paths:** `apps/bot/src/**`

## Rules

1. Never contains business logic — only calls to other agents
2. Never accesses the DB directly — only through the `db` agent (repositories)
3. All texts only through the `i18n` agent — no hardcoded strings
4. Each scene is a separate file, max 100 lines

## Bot Commands

| Command       | Description                       |
| ------------- | --------------------------------- |
| `/start`      | Onboarding or main menu           |
| `/translate`  | Translate a word or phrase        |
| `/template`   | Customize translation output      |
| `/dictionary` | Personal dictionary               |
| `/settings`   | Language, notifications, timezone |

## Skills (Public API / Key Functions)

```typescript
// Render a full translation card for Telegram (HTML)
// Dictionary context (if present) is NOT rendered — used only for AI prompt enrichment
// Optional templateFields controls which sections are rendered (Task 32)
function renderTranslation(output: TranslateOutput, interfaceLang?: string, templateFields?: TemplateFields): string;

// Render a single topic word card (HTML)
function renderTopicWord(word: TopicWord): string;

// Build inline keyboard with per-language regenerate buttons + contextual save/skip
function buildTranslationKeyboard(langCodes: string[], inputType: 'word' | 'phrase', interfaceLang?: string): InlineKeyboard;

// Build post-save keyboard — regen buttons only, no Save/Skip (FEAT-30)
function buildPostSaveKeyboard(langCodes: string[], interfaceLang?: string): InlineKeyboard;

// Strip transient fields from TranslateOutput for DB storage (FEAT-30)
function sanitizeForStorage(output: TranslateOutput): StoredWordContent;

// Render a compact sentence translation card (Task 27)
// No CEFR, synonyms, examples, alternatives — just text + transcription
function renderSentenceTranslation(output: TranslateOutput, interfaceLang?: string): string;

// Build inline keyboard for sentences — regen only, no Save/Skip (Task 27)
function buildSentenceKeyboard(langCodes: string[], interfaceLang?: string): InlineKeyboard;

// Scene: 3-step onboarding (BUG-01 fix — BRD §5)
async function onboarding(conversation, ctx): Promise<void>;

// Command: /translate — sets mode and shows confirmation
async function handleTranslateCommand(ctx: BotContext): Promise<void>;

// Mode handler: translate text (plain text in translate mode)
async function handleTranslateText(ctx: BotContext, word: string): Promise<void>;

// Callback: Save translation to dictionary
async function handleSaveCallback(ctx: BotContext): Promise<void>;

// Callback: Skip translation (discard)
async function handleSkipCallback(ctx: BotContext): Promise<void>;

// Callback: Regeneration in persistent translate mode (Task 27)
async function handleRegenCallback(ctx: BotContext): Promise<void>;

// Callback: Source language selection (Task 17)
async function handleSourceLangCallback(ctx: BotContext): Promise<void>;

// Build source language selection keyboard (Task 17)
// Returns null when user has ≤2 languages (auto-detect sufficient)
function buildSourceLangKeyboard(langs: LangOption[], currentSelection: string | null): InlineKeyboard | null;

// Build language option list from user settings (Task 17)
function buildLangOptions(nativeLang: string, learningLangs: string[], interfaceLang: SupportedLang): LangOption[];

// Helper: regeneration loop (regen/save/skip callback handling, sentence-aware)
async function handleRegenLoop(conversation, ctx, output, lang, userId, cardMsgId, inputType?): Promise<void>;

// Classify user input as word, phrase, or sentence (Task 27)
function classifyInput(text: string, config?: Partial<InputClassifierConfig>): InputClassification;

// Command: /template — shows template status with Customize/Reset buttons (Task 32)
async function handleTemplateCommand(ctx: BotContext): Promise<void>;

// Template wizard callbacks (Task 32)
async function handleCustomizeCallback(ctx: BotContext): Promise<void>;
async function handleToggleCallback(ctx: BotContext): Promise<void>;
async function handlePreviewCallback(ctx: BotContext): Promise<void>;
async function handleSaveTemplateCallback(ctx: BotContext): Promise<void>;
async function handleCancelCallback(ctx: BotContext): Promise<void>;
async function handleResetCallback(ctx: BotContext): Promise<void>;
async function handleBackCallback(ctx: BotContext): Promise<void>;

// Scene: dictionary browsing (not yet implemented)
async function handleDictionary(conversation, ctx): Promise<void>;

// Scene: user settings (not yet implemented)
async function handleSettings(conversation, ctx): Promise<void>;
```

## Translation Flow (Persistent Mode System)

The bot uses a **persistent mode system** for translate. Once the user enters translate mode, every plain text message is automatically treated as a word to translate.

```
/translate
  ├─ Set activeMode = "translate" in session
  └─ Show confirmation: "🔤 Translate mode — send me a word or phrase to translate."

[Plain text message while in translate mode]
  ├─ Get user settings (interfaceLang, nativeLang, learningLangs)
  ├─ Resolve translation direction:
  │   ├─ If nextSourceLang set → use resolveDirectionFromSource() (explicit, no detection)
  │   ├─ If nextSourceLang invalid → reset to null, fall back to auto-detect
  │   └─ If nextSourceLang null → auto-detect via resolveTranslationDirection()
  ├─ Classify input: classifyInput(word) → word / phrase / sentence (Task 27)
  ├─ Load user template: translationTemplateRepository.getByUserId() (Task 32)
  ├─ Resolve output config: resolveOutputConfig(userTpl, classification.type)
  │   (sentences → SENTENCE_OUTPUT, words/phrases → user template or DEFAULT_TEMPLATE)
  ├─ Show "Translating..." indicator
  ├─ Call translateWithContext() with resolved direction + generateObject
  │   (sentences skip dictionary lookup via no-op lookupContext)
  ├─ Store lastTranslation + lastInputType in session (for regen)
  │
  ├── word/phrase:
  │   ├─ Render full card (HTML), prepend detected lang if reversed
  │   ├─ Show Save/Skip/Regen keyboard
  │   ├─ Store pendingTranslation for Save/Skip
  │   └─ Show source language selection menu
  │
  └── sentence:
      ├─ Render compact card via renderSentenceTranslation()
      ├─ Prepend "📝 Sentence translation" label
      ├─ Show Regen-only keyboard (no Save/Skip)
      ├─ No pendingTranslation (nothing to save)
      └─ Show source language selection menu

[Save callback — FEAT-30 flow]
  ├─ FK resolution: getLang(sourceLang) → sourceLangId
  ├─ Duplicate detection: wordRepository.findByOriginalAndSource()
  │   └─ If duplicate: show "already saved" toast, return early
  ├─ Sanitize: sanitizeForStorage() strips transient fields
  ├─ Persist: wordRepository.create() with CreateWordInput shape
  ├─ Session: set savedWordId, clear pendingTranslation
  └─ Edit card in-place: savedToDict text + buildPostSaveKeyboard (regen-only)

[Skip callback]
  ├─ Remove keyboard from card
  ├─ Clear pending state
  └─ Show source language selection menu (or plain hint if ≤2 langs)

[Regen callback (tr:regen:{code}) — Task 27 + FEAT-30]
  ├─ Read lastTranslation + lastInputType from session
  ├─ Load user template: translationTemplateRepository.getByUserId() (Task 32)
  ├─ Resolve output config: resolveOutputConfig(userTpl, inputType)
  │   (sentences → SENTENCE_OUTPUT, words/phrases → user template or default)
  ├─ Call translateOneWithContext() with correct preset + inputType
  ├─ Merge regenerated translation into lastTranslation
  ├─ If savedWordId set: auto-update DB entry via wordRepository.updateContent()
  ├─ For word/phrase (not yet saved): also update pendingTranslation
  └─ Re-render card: savedWordId? → postSaveKeyboard+savedToDict : translationKeyboard

[Source language selection callback (tr:srclang:{code})]
  ├─ Set ctx.session.nextSourceLang = code
  ├─ Answer with confirmation "🔤 Next from: {lang}"
  └─ Update keyboard in-place (✓ on selected button)
```

**Mode Persistence:**
- User stays in translate mode after Save/Skip
- Next plain text message triggers another translation
- Mode switches only when user sends another mode command (e.g., future `/mentor`)
- Non-mode commands (`/help`, `/settings`, `/start`) don't change the mode

## Onboarding Flow (3 Steps — BRD §5)

```
/start
  ├─ Step 1: Choose native language (inline keyboard) — interface language inferred
  ├─ Step 2: Choose learning languages (multi-select, 1–4)
  └─ Step 3: Demo translation → shows result immediately (no Save/Skip) → Complete
```

Interface language is inferred from native language (or Telegram locale as fallback). No separate interface language selection step.

## grammY Conversations Pattern

```typescript
import { Conversation } from "@grammyjs/conversations";

export async function myScene(
  conversation: Conversation<BotContext, ConversationContext>,
  ctx: ConversationContext,
): Promise<void> {
  // Use conversation.external() for side effects (DB calls, AI calls)
  const data = await conversation.external(async () => {
    return someRepository.findSomething();
  });

  // Use conversation.waitFor() for user input
  const response = await conversation.waitFor("message:text");
}
```

## Rendering

Translation results use **HTML parse mode** for safe rendering of dynamic content:
- `<b>bold</b>` for words and translations
- `<i>italic</i>` for example sentences
- HTML entities (`&amp;`, `&lt;`, `&gt;`) for escaping user/AI content

### Wiktionary Dictionary Context (Task 13)

Dictionary context (`TranslateOutput.dictionaryContext`) is **not rendered** in the user-facing Telegram card. It is used only to enrich the AI translation prompt via the context-enrichment layer. The renderer explicitly ignores the `dictionaryContext` field — tests verify no POS, glosses, or expression hints appear in the card output.

Dictionary context lookup is handled by the **context-enrichment layer** (`translateWithContext()` from `@polyglot/core`). The bot passes `createContextLookup()` from `@polyglot/adapter-db` as a dependency — the enrichment layer handles fail-open lookup, transformation to `DictionaryContext`, and merging into the translation prompt. The bot never accesses `wordContextRepository` directly.

### Language Flags in Translation Cards (Task 25)

The translation card and topic word card now display emoji flags from the DB language registry instead of a hardcoded `🔤`. Both `renderLangBlock()` and `renderTopicWord()` call `getLangFlag(code)` from `@polyglot/core` with a `?? "🔤"` fallback for languages without a flag. All 10 supported languages have flags populated in the DB (en→🇬🇧, ru→🇷🇺, cs→🇨🇿, de→🇩🇪, fr→🇫🇷, es→🇪🇸, it→🇮🇹, pt→🇵🇹, uk→🇺🇦, pl→🇵🇱).

### Translation Alternatives (Task 15)

When `LanguageTranslation.alternatives` is present and non-empty, `renderLangBlock()` renders each alternative after the main translation header and before examples:
```
🇨🇿 CS: <b>dům</b> (domov, obydlí)
   ∙ domov (neutral) — bydliště (neutral)
   ∙ stavení (literary)
💬 <i>Dům je velký.</i>  → neutrální
```
Each alternative shows its text, register, and optional synonyms inline. The `alternatives` field is optional — existing translations without it render unchanged.

### Idiomatic Equivalent Support (Task 10)

The renderer is **transparent** to idiomatic equivalent metadata. When upstream translation types include `expressionType` and `equivalentNote` fields (added in Task 10), the renderer continues to display the `text` field as before. These metadata fields are not rendered in the Telegram output — they flow through the data model without any bot-layer changes. Compatibility is verified by dedicated transparency tests.

### Redesigned Translation Card (Task 31)

The translation card was redesigned for better usability:

- **Inline synonyms**: Synonyms are shown compactly after the translation header: `🇬🇧 EN: <b>to excite</b> (syn1, syn2)` — text only, no register in parenthetical. No separate "Synonyms:" section block.
- **Register-labeled examples**: All examples use `💬` icon (no per-context icons). Each example shows the target sentence in italic with an inline register label: `💬 <i>sentence</i>  → register`. No native (source language) translation rendered — only target language.
- **Connotation warnings**: Optional `⚠️` line rendered after examples when `LanguageTranslation.connotationWarning` is present. Uses i18n key `connotationWarning` with `{warning}` param.
- **Backward compatibility**: Renderer gracefully handles old example format from DB — examples without `register` field render without the `→ label` suffix; `native` field is silently ignored.
- **Card layout order**: flag + lang code + translation (+ inline synonyms) → alternatives → examples (💬 + register) → connotation warning (⚠️).

## File Structure

```
apps/bot/src/
├── index.ts                    # Bot setup, session, middleware, callbacks, start
├── types.ts                    # BotContext, ConversationContext, UserMode, SessionData
├── constants.ts                # LANGUAGES display data, langDisplay()
├── middlewares/
│   ├── auth.ts                 # Auth middleware (user resolution + activeMode hydration from DB)
│   ├── auth.test.ts            # 7 tests (user resolution, activeMode hydration, fallback)
│   └── mode-router.ts          # ✅ Routes plain text to active mode handler (idle→translate fallback, DB persist)
├── commands/
│   ├── start.ts                # /start command (restores translate mode, persists to DB)
│   └── start.test.ts           # 4 tests (activeMode restore, DB persistence, onboarding entry, no user)
├── utils/
│   ├── classify-input.ts       # ✅ Input classifier: word/phrase/sentence (Task 27)
│   ├── classify-input.test.ts  # 18 tests (classification rules, boundaries, config)
│   ├── sanitize-word-content.ts      # ✅ sanitizeForStorage() — strips transient fields for DB (FEAT-30)
│   └── sanitize-word-content.test.ts # 9 tests (field stripping, immutability, minimal input)
├── renderers/
│   ├── translation.renderer.ts # renderTranslation, renderSentenceTranslation, renderTopicWord, buildTranslationKeyboard(+inputType), buildPostSaveKeyboard, buildSentenceKeyboard, buildSourceLangKeyboard
│   └── __tests__/
│       └── source-lang-menu.test.ts     # 8 tests (keyboard rendering, ✓ marks, suppression)
├── scenes/
│   ├── onboarding.scene.ts     # ✅ 3-step onboarding (BRD §5, BUG-01 fix, infers interface lang)
│   ├── translate.scene.ts      # ✅ implemented (mode-based: sets mode + confirmation, persists to DB)
│   ├── translate.scene.test.ts # 3 tests (mode activation, DB persistence, confirmation)
│   ├── template.scene.ts       # ✅ /template command handler (Task 32)
│   ├── template-preview.data.ts # ✅ Mock translation output for wizard preview (Task 32)
│   ├── helpers/
│   │   ├── translate-mode.helper.ts  # ✅ handleTranslateText (classifier + branching + template-aware), handleRegenCallback, handleSaveCallback, handleSkipCallback, handleSourceLangCallback
│   │   ├── translate-mode.helper.test.ts # 5 tests (context enrichment wiring)
│   │   ├── __tests__/
│   │   │   ├── translate-mode-detection.test.ts      # 8 tests (auto-detect language direction)
│   │   │   ├── translate-mode-source-lang.test.ts    # 11 tests (explicit source lang override)
│   │   │   └── source-lang-callback.test.ts          # 7 tests (callback handling)
│   │   ├── template.helper.ts        # ✅ Template wizard callbacks: customize, toggle, preview, save, cancel, reset, back (Task 32)
│   │   ├── regen.helper.ts           # ✅ regeneration loop helper (sentence-aware, FEAT-30 save flow, template-aware)
│   │   └── regen.helper.test.ts      # 13 tests (includes dedup, FK resolution, inputType)
│   ├── dictionary.scene.ts     # ❌ to be created
│   └── settings.scene.ts       # ❌ to be created
└── __tests__/
    ├── translate-mode.test.ts              # ✅ 11 tests (mode system tests, idle fallback, DB persistence)
    ├── translation.renderer.test.ts        # 89 tests (includes 7 alternatives, 5 connotation warnings, 2 backward compat, 4 inline synonyms, 15 sentence renderer, 7 sentence keyboard, 5 post-save keyboard)
    ├── translation.renderer.template.test.ts # ✅ 10 tests (template-aware rendering: field toggle, backward compat, mixed fields)
    ├── template.scene.test.ts              # ✅ 15 tests (command, customize, toggle, save, cancel, reset, preview, back)
    ├── dictionary-context-renderer.test.ts # 6 tests (dict context rendering, unified expression detection)
    └── onboarding.scene.test.ts            # 18 tests (3-step flow, back nav, interface lang inference, no Save/Skip)
```

## Reference

- Onboarding spec: `docs/tech-reqs/09-onboarding.md`
- Bot commands: `docs/tech-reqs/10-bot-commands.md`
- Architecture: `docs/tech-reqs/02-architecture.md`
- Agent contracts: `docs/tech-reqs/14-agents.md` (bot section)
