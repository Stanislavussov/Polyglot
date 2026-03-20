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
- `index.ts` — grammY bot setup, session middleware, mode router, callback handlers, graceful shutdown
- `types.ts` — BotContext, ConversationContext, UserMode, SessionData (with activeMode field)
- `constants.ts` — LANGUAGES display data, langDisplay() (no business text — all i18n via core)
- `middlewares/auth.ts` — resolves/creates user, attaches to ctx.user
- `middlewares/mode-router.ts` — routes plain text to active mode handler (translate/idle)
- `commands/start.ts` — /start handler (onboarding or main menu)
- `scenes/onboarding.scene.ts` — 4-step onboarding conversation
- `scenes/translate.scene.ts` — mode-based: /translate sets mode and shows confirmation
- `scenes/helpers/translate-mode.helper.ts` — handles translation text, Save/Skip callbacks; uses `translateWithContext()` from context-enrichment layer (dictionary context lookup delegated to `createContextLookup()` from DB adapter)
- `scenes/helpers/regen.helper.ts` — regeneration loop helper (per-language regen, save, skip)
- `renderers/translation.renderer.ts` — renderTranslation, renderTopicWord, buildTranslationKeyboard, renderDictionaryHint (Wiktionary context display)
- `renderers/translation.renderer.ts` — renderTranslation (HTML), renderTopicWord (HTML), buildTranslationKeyboard (inline keyboard with regen buttons)

Still needed:
- `scenes/dictionary.scene.ts` — dictionary browsing
- `scenes/settings.scene.ts` — user settings

### Auto-Detect Input Language (Task 16)

The translate-mode helper now uses `resolveTranslationDirection()` from `@polyglot/core` to automatically detect the input language and adjust the translation direction:
- Input in native language → translates to all learning languages (unchanged behavior)
- Input in a learning language → translates to native + remaining learning languages (reversed direction)
- Ambiguous/unknown input → falls back to native→learning (safe default)

When the detected language differs from the native language (reversed direction), a `🔍 Detected: {lang}` indicator is prepended to the translation card using `getLanguageName()` for localized display names and the `detectedLang` i18n key.

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
| `/dictionary` | Personal dictionary               |
| `/settings`   | Language, notifications, timezone |

## Skills (Public API / Key Functions)

```typescript
// Render a full translation card for Telegram (HTML)
// Includes dictionary context hint when output.dictionaryContext is present
function renderTranslation(output: TranslateOutput, interfaceLang?: string): string;

// Render a Wiktionary dictionary context hint (pos, glosses)
function renderDictionaryHint(dc: DictionaryContext, lang: SupportedLang): string;

// Render a single topic word card (HTML)
function renderTopicWord(word: TopicWord): string;

// Build inline keyboard with per-language regenerate buttons + save/skip
function buildTranslationKeyboard(langCodes: string[], interfaceLang?: string): InlineKeyboard;

// Scene: 4-step onboarding (implemented)
async function onboarding(conversation, ctx): Promise<void>;

// Command: /translate — sets mode and shows confirmation
async function handleTranslateCommand(ctx: BotContext): Promise<void>;

// Mode handler: translate text (plain text in translate mode)
async function handleTranslateText(ctx: BotContext, word: string): Promise<void>;

// Callback: Save translation to dictionary
async function handleSaveCallback(ctx: BotContext): Promise<void>;

// Callback: Skip translation (discard)
async function handleSkipCallback(ctx: BotContext): Promise<void>;

// Helper: regeneration loop (regen/save/skip callback handling)
async function handleRegenLoop(conversation, ctx, output, lang, userId, cardMsgId): Promise<void>;

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
  ├─ Auto-detect input language via resolveTranslationDirection()
  │   (determines sourceLang/targetLangs based on detected language)
  ├─ Show "Translating..." indicator
  ├─ Call translateWithContext() with resolved direction + createContextLookup() + generateObject
  │   (context-enrichment layer handles dictionary lookup + fail-open internally)
  ├─ Render translation card (HTML format, includes dictionary hint if context found)
  ├─ Prepend "🔍 Detected: {lang}" when direction is reversed (detected ≠ native)
  ├─ Show inline keyboard: Save/Skip buttons
  └─ Store pendingTranslation in session for callback handling

[Save callback]
  ├─ Save to dictionary via wordRepository.create()
  ├─ Show "✅ Saved to dictionary!"
  ├─ Clear pending state
  └─ Show hint: "Send the next word or phrase."

[Skip callback]
  ├─ Remove keyboard from card
  ├─ Clear pending state
  └─ Show hint: "Send the next word or phrase."
```

**Mode Persistence:**
- User stays in translate mode after Save/Skip
- Next plain text message triggers another translation
- Mode switches only when user sends another mode command (e.g., future `/mentor`)
- Non-mode commands (`/help`, `/settings`, `/start`) don't change the mode

## Onboarding Flow (4 Steps)

```
/start
  ├─ Step 1: Choose interface language (inline keyboard)
  ├─ Step 2: Choose native language (inline keyboard)
  ├─ Step 3: Choose learning languages (multi-select, 1–4)
  └─ Step 4: Demo translation → "Save to dictionary?" → Complete
```

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

When `TranslateOutput.dictionaryContext` is present, `renderTranslation()` appends a dictionary context hint section using `renderDictionaryHint()`. The hint shows:
- **Expression detection** (`💬 Expression detected: {expression}`) for `pos === "phrase"` or `pos === "idiom"` (unified handling — both use `expressionDetected` i18n key)
- **Part of speech** (`Part of speech: {pos}`) for all other POS values
- **Glosses** (first 3 English definitions from Wiktionary, joined by `;`)

Dictionary context lookup is handled by the **context-enrichment layer** (`translateWithContext()` from `@polyglot/core`). The bot passes `createContextLookup()` from `@polyglot/adapter-db` as a dependency — the enrichment layer handles fail-open lookup, transformation to `DictionaryContext`, and merging into the translation prompt. The bot never accesses `wordContextRepository` directly.

### Translation Alternatives (Task 15)

When `LanguageTranslation.alternatives` is present and non-empty, `renderLangBlock()` renders each alternative after the main translation header and before the CEFR line:
```
🔤 CS: <b>dům</b>
   ∙ domov (neutral) — bydliště (neutral)
   ∙ stavení (literary)
CEFR: A1 · neutral
```
Each alternative shows its text, register, and optional synonyms inline. The `alternatives` field is optional — existing translations without it render unchanged.

### Idiomatic Equivalent Support (Task 10)

The renderer is **transparent** to idiomatic equivalent metadata. When upstream translation types include `expressionType` and `equivalentNote` fields (added in Task 10), the renderer continues to display the `text` field as before. These metadata fields are not rendered in the Telegram output — they flow through the data model without any bot-layer changes. Compatibility is verified by dedicated transparency tests.

## File Structure

```
apps/bot/src/
├── index.ts                    # Bot setup, session, middleware, callbacks, start
├── types.ts                    # BotContext, ConversationContext, UserMode, SessionData
├── constants.ts                # LANGUAGES display data, langDisplay()
├── middlewares/
│   ├── auth.ts                 # Auth middleware (user resolution)
│   └── mode-router.ts          # ✅ Routes plain text to active mode handler
├── commands/
│   └── start.ts                # /start command
├── renderers/
│   └── translation.renderer.ts # renderTranslation, renderTopicWord, buildTranslationKeyboard, renderDictionaryHint
├── scenes/
│   ├── onboarding.scene.ts     # ✅ implemented (conversation-based)
│   ├── translate.scene.ts      # ✅ implemented (mode-based: sets mode + confirmation)
│   ├── helpers/
│   │   ├── translate-mode.helper.ts  # ✅ handleTranslateText (uses translateWithContext + resolveTranslationDirection), handleSaveCallback, handleSkipCallback
│   │   ├── translate-mode.helper.test.ts # 4 tests (context enrichment wiring)
│   │   ├── __tests__/
│   │   │   └── translate-mode-detection.test.ts # 8 tests (auto-detect language direction)
│   │   ├── regen.helper.ts           # ✅ regeneration loop helper (for onboarding)
│   │   └── regen.helper.test.ts      # 9 tests
│   ├── dictionary.scene.ts     # ❌ to be created
│   └── settings.scene.ts       # ❌ to be created
└── __tests__/
    ├── translate-mode.test.ts              # ✅ 8 tests (mode system tests)
    ├── translation.renderer.test.ts        # 48 tests (includes 7 alternatives tests)
    ├── dictionary-context-renderer.test.ts # 13 tests (dict context rendering, unified expression detection)
    └── onboarding.scene.test.ts            # 16 tests
```

## Reference

- Onboarding spec: `docs/tech-reqs/09-onboarding.md`
- Bot commands: `docs/tech-reqs/10-bot-commands.md`
- Architecture: `docs/tech-reqs/02-architecture.md`
- Agent contracts: `docs/tech-reqs/14-agents.md` (bot section)
