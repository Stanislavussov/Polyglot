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
- `index.ts` — grammY bot setup, middleware registration, graceful shutdown
- `types.ts` — BotContext, ConversationContext
- `constants.ts` — LANGUAGES display data, langDisplay() (no business text — all i18n via core)
- `middlewares/auth.ts` — resolves/creates user, attaches to ctx.user
- `commands/start.ts` — /start handler (onboarding or main menu)
- `scenes/onboarding.scene.ts` — 4-step onboarding conversation
- `scenes/translate.scene.ts` — translation flow (enter word → AI translate → save to dict)
- `renderers/translation.renderer.ts` — renderTranslation (HTML), renderTopicWord (HTML)

Still needed:
- `scenes/dictionary.scene.ts` — dictionary browsing
- `scenes/settings.scene.ts` — user settings

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
function renderTranslation(output: TranslateOutput, interfaceLang?: string): string;

// Render a single topic word card (HTML)
function renderTopicWord(word: TopicWord): string;

// Scene: 4-step onboarding (implemented)
async function onboarding(conversation, ctx): Promise<void>;

// Scene: translation flow (implemented)
async function handleTranslate(conversation, ctx): Promise<void>;

// Scene: dictionary browsing (not yet implemented)
async function handleDictionary(conversation, ctx): Promise<void>;

// Scene: user settings (not yet implemented)
async function handleSettings(conversation, ctx): Promise<void>;
```

## Translation Flow

```
/translate
  ├─ Get user settings (interfaceLang, nativeLang, learningLangs)
  ├─ Prompt: "Enter a word or phrase to translate"
  ├─ Show "Translating..." indicator
  ├─ Call translate() with generateObject from AI adapter
  ├─ Render translation card (HTML format)
  ├─ Show "Save to dictionary?" inline keyboard
  └─ Save to wordRepository or dismiss
```

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

## File Structure

```
apps/bot/src/
├── index.ts                    # Bot setup, middleware, start
├── types.ts                    # BotContext, ConversationContext
├── constants.ts                # LANGUAGES display data, langDisplay()
├── middlewares/
│   └── auth.ts                 # Auth middleware (user resolution)
├── commands/
│   └── start.ts                # /start command
├── renderers/
│   └── translation.renderer.ts # renderTranslation, renderTopicWord
├── scenes/
│   ├── onboarding.scene.ts     # ✅ implemented
│   ├── translate.scene.ts      # ✅ implemented
│   ├── dictionary.scene.ts     # ❌ to be created
│   └── settings.scene.ts       # ❌ to be created
└── __tests__/
    └── translation.renderer.test.ts # 24 tests
```

## Reference

- Onboarding spec: `docs/tech-reqs/09-onboarding.md`
- Bot commands: `docs/tech-reqs/10-bot-commands.md`
- Architecture: `docs/tech-reqs/02-architecture.md`
- Agent contracts: `docs/tech-reqs/14-agents.md` (bot section)
