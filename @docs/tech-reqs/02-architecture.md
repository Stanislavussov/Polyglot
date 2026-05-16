# Project Architecture

Three layers: **core** (platform-independent), **adapters** (platform-dependent), **apps** (applications).
Core modules are unaware of Telegram — pure business logic only.

```
polyglot/
├── packages/
│   │
│   ├── 📦 core/                           # Platform-independent modules
│   │   ├── modules/
│   │   │   ├── translation/               # Agent: translation
│   │   │   │   ├── index.ts
│   │   │   │   ├── types.ts
│   │   │   │   ├── translation.service.ts
│   │   │   │   ├── prompt.builder.ts
│   │   │   │   └── schemas/
│   │   │   │       └── translation.schema.ts
│   │   │   │
│   │   │   ├── topics/                    # Agent: topics and datasets
│   │   │   │   ├── index.ts
│   │   │   │   ├── types.ts
│   │   │   │   ├── topic.service.ts
│   │   │   │   └── datasets/
│   │   │   │       ├── food.json
│   │   │   │       ├── travel.json
│   │   │   │       └── it-terms.json
│   │   │   │
│   │   │   ├── validation/                # Agent: AI response validation
│   │   │   │   ├── index.ts
│   │   │   │   ├── types.ts
│   │   │   │   ├── semantic.validator.ts
│   │   │   │   └── language.validator.ts
│   │   │   │
│   │   │   └── i18n/                      # Agent: internationalization
│   │   │       ├── index.ts
│   │   │       ├── types.ts
│   │   │       └── locales/
│   │   │           ├── ru.json
│   │   │           ├── en.json
│   │   │           └── cs.json
│   │   │
│   │   └── shared/
│   │       └── errors.ts                  # Base error classes
│   │
│   ├── 📦 adapters/                       # Platform-dependent adapters
│   │   │
│   │   ├── ai/                            # Agent: AI client (OpenRouter)
│   │   │   ├── index.ts                   # createAIClient()
│   │   │   ├── types.ts                   # AIRequest, AIResponse, AIModel
│   │   │   └── client.ts                  # Vercel AI SDK + OpenRouter
│   │   │
│   │   ├── db/                            # Agent: database (Drizzle)
│   │   │   ├── index.ts                   # getDb()
│   │   │   ├── types.ts
│   │   │   ├── schema.ts                  # Drizzle schemas
│   │   │   ├── migrations/
│   │   │   └── repositories/
│   │   │       ├── user.repository.ts
│   │   │       ├── word.repository.ts
│   │   │       └── topic.repository.ts
│   │   │
│   │   └── notifications/                 # Agent: notifications
│   │       ├── index.ts                   # startScheduler(sendFn)
│   │       ├── types.ts
│   │       ├── scheduler.ts               # node-cron
│   │       └── notification.service.ts
│   │
│   └── 📦 apps/
│       │
│       ├── bot/                           # Telegram bot
│       │   ├── index.ts                   # grammY initialization
│       │   ├── middlewares/
│       │   ├── scenes/
│       │   │   ├── onboarding.scene.ts
│       │   │   ├── translate.scene.ts
│       │   │   ├── dictionary.scene.ts
│       │   │   ├── topics.scene.ts
│       │   │   └── dictionary.scene.ts
│       │   └── commands/
│
├── shared/
│   ├── logger.ts                          # Pino + Betterstack
│   └── config.ts                          # ENV configuration (Zod validation)
│
└── package.json                           # monorepo (pnpm workspaces)
```

---

## Platform Separation

```
                    ┌─────────────────────────────┐
                    │         packages/core       │
                    │       translation           │
                    │  topics / validation / i18n │
                    │     (pure business logic)   │
                    └──────────────┬──────────────┘
                                   │ imported by
                                   │
                       ┌───────────▼──────────┐
                       │   packages/adapters  │
                       │    db (Drizzle/PG)   │
                       │    ai (OpenRouter)   │
                       │  notifications (cron)│
                       └───────────┬──────────┘
                                   │
                       ┌───────────▼──────────┐
                       │    apps/bot          │
                       │  (grammY, Node.js)   │
                       └──────────────────────┘
```
