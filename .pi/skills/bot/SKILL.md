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
- `constants.ts` — temporary LANGUAGES, TEXTS, t() (to be replaced by i18n module)
- `middlewares/auth.ts` — resolves/creates user, attaches to ctx.user
- `commands/start.ts` — /start handler (onboarding or main menu)
- `scenes/onboarding.scene.ts` — 4-step onboarding conversation

Still needed:
- `scenes/translate.scene.ts` — translation flow
- `scenes/dictionary.scene.ts` — dictionary browsing
- `scenes/settings.scene.ts` — user settings
- Rendering functions for AI translation output
- Migration from `constants.ts` t() to proper i18n module

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
// Render a full translation card for Telegram (Markdown)
function renderTranslation(output: TranslateOutput): string;

// Render a single topic word card
function renderTopicWord(word: TopicWord): string;

// Scene: 4-step onboarding (implemented)
async function onboarding(conversation, ctx): Promise<void>;

// Scene: translation flow
async function handleTranslate(conversation, ctx): Promise<void>;

// Scene: dictionary browsing with pagination
async function handleDictionary(conversation, ctx): Promise<void>;

// Scene: user settings (language, timezone, notifications)
async function handleSettings(conversation, ctx): Promise<void>;
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
  // Use conversation.external() for side effects (DB calls)
  const data = await conversation.external(async () => {
    return someRepository.findSomething();
  });

  // Use conversation.waitFor() for user input
  const response = await conversation.waitFor("message:text");
}
```

## File Structure

```
apps/bot/src/
├── index.ts                    # Bot setup, middleware, start
├── types.ts                    # BotContext, ConversationContext
├── constants.ts                # LANGUAGES, temporary t() (to be replaced)
├── middlewares/
│   └── auth.ts                 # Auth middleware (user resolution)
├── commands/
│   └── start.ts                # /start command
└── scenes/
    ├── onboarding.scene.ts     # ✅ implemented
    ├── translate.scene.ts      # ❌ to be created
    ├── dictionary.scene.ts     # ❌ to be created
    └── settings.scene.ts       # ❌ to be created
```

## Reference

- Onboarding spec: `docs/tech-reqs/09-onboarding.md`
- Bot commands: `docs/tech-reqs/10-bot-commands.md`
- Architecture: `docs/tech-reqs/02-architecture.md`
- Agent contracts: `docs/tech-reqs/14-agents.md` (bot section)
