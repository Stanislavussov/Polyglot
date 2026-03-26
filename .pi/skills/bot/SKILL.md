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
- `scenes/helpers/translate-mode.helper.ts` — handles translation text, Save/Skip callbacks; uses `translateWithContext()` from context-enrichment layer (dictionary context lookup delegated to `createContextLookup()` from DB adapter)
- `scenes/helpers/regen.helper.ts` — regeneration loop helper (per-language regen, save, skip)
- `renderers/translation.renderer.ts` — renderTranslation (HTML), renderTopicWord (HTML), buildTranslationKeyboard (inline keyboard with regen buttons), buildSourceLangKeyboard (source language selection keyboard)

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

### Translation Output Config Presets (Task 21)

Bot callers use centralized `TranslationOutputConfig` presets from `@polyglot/core` to control which sections appear in AI translation responses. This reduces token usage for use cases that don't need full verbosity.

**Caller → preset mapping:**

| Caller | Preset | Rationale |
|---|---|---|
| `translate-mode.helper.ts` (`handleTranslateText`) | `FULL_OUTPUT` | Interactive translation — user expects rich cards |
| `regen.helper.ts` (`handleRegenLoop`) | `FULL_OUTPUT` | Regeneration — same rich detail as interactive |

Both callers import `FULL_OUTPUT` from `@polyglot/core` and pass `outputConfig: FULL_OUTPUT` in their translation input. Rule: callers must always use a named preset — never construct `TranslationOutputConfig` inline.

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

### Auto-Detect Input Language (Task 16)

The translate-mode helper now uses `resolveTranslationDirection()` from `@polyglot/core` to automatically detect the input language and adjust the translation direction:
- Input in native language → translates to all learning languages (unchanged behavior)
- Input in a learning language → translates to native + remaining learning languages (reversed direction)
- Ambiguous/unknown input → falls back to native→learning (safe default)

When the detected language differs from the native language (reversed direction), a `🔍 Detected: {lang}` indicator is prepended to the translation card using `getLanguageName()` for localized display names and the `detectedLang` i18n key.

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
| `/dictionary` | Personal dictionary               |
| `/settings`   | Language, notifications, timezone |

## Skills (Public API / Key Functions)

```typescript
// Render a full translation card for Telegram (HTML)
// Dictionary context (if present) is NOT rendered — used only for AI prompt enrichment
function renderTranslation(output: TranslateOutput, interfaceLang?: string): string;

// Render a single topic word card (HTML)
function renderTopicWord(word: TopicWord): string;

// Build inline keyboard with per-language regenerate buttons + save/skip
function buildTranslationKeyboard(langCodes: string[], interfaceLang?: string): InlineKeyboard;

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

// Callback: Source language selection (Task 17)
async function handleSourceLangCallback(ctx: BotContext): Promise<void>;

// Build source language selection keyboard (Task 17)
// Returns null when user has ≤2 languages (auto-detect sufficient)
function buildSourceLangKeyboard(langs: LangOption[], currentSelection: string | null): InlineKeyboard | null;

// Build language option list from user settings (Task 17)
function buildLangOptions(nativeLang: string, learningLangs: string[], interfaceLang: SupportedLang): LangOption[];

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
  ├─ Resolve translation direction:
  │   ├─ If nextSourceLang set → use resolveDirectionFromSource() (explicit, no detection)
  │   ├─ If nextSourceLang invalid → reset to null, fall back to auto-detect
  │   └─ If nextSourceLang null → auto-detect via resolveTranslationDirection()
  ├─ Show "Translating..." indicator
  ├─ Call translateWithContext() with resolved direction + createContextLookup() + generateObject
  │   (context-enrichment layer handles dictionary lookup + fail-open internally)
  ├─ Render translation card (HTML format)
  ├─ Prepend "🔍 Detected: {lang}" when direction is reversed (detected ≠ native)
  ├─ Show inline keyboard: Save/Skip buttons
  └─ Store pendingTranslation in session for callback handling

[Save callback]
  ├─ Save to dictionary via wordRepository.create()
  ├─ Show "✅ Saved to dictionary!"
  ├─ Clear pending state
  └─ Show source language selection menu (or plain hint if ≤2 langs)

[Skip callback]
  ├─ Remove keyboard from card
  ├─ Clear pending state
  └─ Show source language selection menu (or plain hint if ≤2 langs)

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
│   ├── auth.ts                 # Auth middleware (user resolution + activeMode hydration from DB)
│   ├── auth.test.ts            # 7 tests (user resolution, activeMode hydration, fallback)
│   └── mode-router.ts          # ✅ Routes plain text to active mode handler (idle→translate fallback, DB persist)
├── commands/
│   ├── start.ts                # /start command (restores translate mode, persists to DB)
│   └── start.test.ts           # 4 tests (activeMode restore, DB persistence, onboarding entry, no user)
├── renderers/
│   ├── translation.renderer.ts # renderTranslation, renderTopicWord, buildTranslationKeyboard, buildSourceLangKeyboard
│   └── __tests__/
│       └── source-lang-menu.test.ts     # 8 tests (keyboard rendering, ✓ marks, suppression)
├── scenes/
│   ├── onboarding.scene.ts     # ✅ 3-step onboarding (BRD §5, BUG-01 fix, infers interface lang)
│   ├── translate.scene.ts      # ✅ implemented (mode-based: sets mode + confirmation, persists to DB)
│   ├── translate.scene.test.ts # 3 tests (mode activation, DB persistence, confirmation)
│   ├── helpers/
│   │   ├── translate-mode.helper.ts  # ✅ handleTranslateText (uses translateWithContext + resolveDirectionFromSource/resolveTranslationDirection), handleSaveCallback, handleSkipCallback, handleSourceLangCallback
│   │   ├── translate-mode.helper.test.ts # 4 tests (context enrichment wiring)
│   │   ├── __tests__/
│   │   │   ├── translate-mode-detection.test.ts      # 8 tests (auto-detect language direction)
│   │   │   ├── translate-mode-source-lang.test.ts    # 11 tests (explicit source lang override)
│   │   │   └── source-lang-callback.test.ts          # 7 tests (callback handling)
│   │   ├── regen.helper.ts           # ✅ regeneration loop helper (for onboarding)
│   │   └── regen.helper.test.ts      # 9 tests
│   ├── dictionary.scene.ts     # ❌ to be created
│   └── settings.scene.ts       # ❌ to be created
└── __tests__/
    ├── translate-mode.test.ts              # ✅ 11 tests (mode system tests, idle fallback, DB persistence)
    ├── translation.renderer.test.ts        # 50 tests (includes 7 alternatives tests)
    ├── dictionary-context-renderer.test.ts # 6 tests (dict context rendering, unified expression detection)
    └── onboarding.scene.test.ts            # 18 tests (3-step flow, back nav, interface lang inference, no Save/Skip)
```

## Reference

- Onboarding spec: `docs/tech-reqs/09-onboarding.md`
- Bot commands: `docs/tech-reqs/10-bot-commands.md`
- Architecture: `docs/tech-reqs/02-architecture.md`
- Agent contracts: `docs/tech-reqs/14-agents.md` (bot section)
