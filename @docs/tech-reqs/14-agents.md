# Subagents — Dependency Graph & Contracts

## Dependency Graph

```
apps/bot
  │
  ├── adapter/db (PG)
  ├── adapter/ai
  ├── adapter/notifications
  │     (node-cron)
  │
  └──────────┬──────────
             │ uses
             ▼
        packages/core
   translation
   topics / validation / i18n
      (no platform, no I/O)
```

Each module is managed by a subagent with clear rules and a set of skills. An agent knows only its own module and communicates with others only through a contract (`index.ts`).

---

## 🤖 Agent: `bot`

**Role:** Manages all user interaction via Telegram. The only module that knows about grammY.

**Rules:**

- Never contains business logic — only calls to other agents
- Never accesses the DB directly — only through the `db` agent
- All texts only through the `i18n` agent — no hardcoded strings
- Each scene is a separate file, max 100 lines

**Skills:**

```
- renderTranslation(output: TranslateOutput)     → formats AI response for Telegram
- renderTopicWord(word: TopicWord)               → renders a word from a topic
- handleOnboarding()                             → 4-step onboarding
- handleTranslate()                              → translation scene
- handleDictionary()                             → dictionary scene
- handleSettings()                               → user settings
```

---

## 🤖 Agent: `translation`

**Role:** Translates words and phrases via AI. Knows about prompts and response structure.

**Rules:**

- One method `translate()` — the single entry point
- Does not save results — only returns them
- Knows nothing about the user — works only with text and languages
- Always calls the `validation` agent before returning a result

**Skills:**

```
- translate(input: TranslateInput): TranslateOutput        → main translation
- translateBatch(words: string[], ...): TranslateOutput[]  → batch for topics
- buildPrompt(input: TranslateInput): string               → prompt assembly
- parseResponse(raw: unknown): TranslateOutput             → parsing + Zod
```

---

## 🤖 Agent: `ai`

**Role:** The only module that knows about OpenRouter and Vercel AI SDK. All other agents receive AI responses through it exclusively.

**Rules:**

- Has no knowledge of domain logic — only sends requests and returns responses
- All requests are logged: `model`, `tokens`, `cost_usd`, `duration_ms`
- Model is always a parameter, never hardcoded internally
- `maxRetries` is configurable from outside

**Skills:**

```
- generateObject<T>(prompt, schema, model): T   → typed response via Zod
- generateText(prompt, model): string           → free-form text
- getAvailableModels(): AIModel[]               → list of OpenRouter models
- estimateCost(tokens, model): number           → request cost estimate
```

---

## 🤖 Agent: `validation`

**Role:** Checks AI response quality. Leaf agent — no dependencies on other modules.

**Rules:**

- Pure functions only — no side effects, no I/O
- Never calls AI — only deterministic checks
- Each rule is a separate function named `validate*`
- Always returns a failure reason — always explains what went wrong

**Skills:**

```
- validateSchema(raw, schema): ValidationResult     → Zod structural validation
- validateSemantic(original, translation): Result   → translation ≠ original, no hallucinations
- validateLanguage(text, expectedLang): Result      → franc language check
- validateExamples(examples, word): Result          → examples contain the word
- validate(all above, orchestrated): ValidationResult → full validation
```

---

## 🤖 Agent: `db`

**Role:** The only module that knows about Drizzle and PostgreSQL. All other agents get data only through repositories.

**Rules:**

- No business logic — CRUD operations only
- All queries typed via Drizzle — no raw SQL
- Single connection instance — singleton `getDb()`
- Each repository is a separate file with a single responsibility

**Skills:**

```
UserRepository:
- findByTelegramId(telegramId): User | null
- create(data: NewUser): User
- updateSettings(userId, settings): User

WordRepository:
- create(userId, word: NewWord): Word
- findByUser(userId): Word[]
- findById(wordId): Word | null
- search(userId, query): Word[]
- delete(wordId): void

TopicRepository:
- getCached(topicId, original, sourceLang, targetLang): TopicTranslation | null
- setCached(data: NewTopicTranslation): TopicTranslation
- markInvalid(id, reason): void
```

---

## 🤖 Agent: `topics`

**Role:** Manages topics and caching of dataset translations.

**Rules:**

- Always checks cache before calling the `translation` agent
- Calls `translation` in batch only — never one word at a time
- Knows nothing about the user — works with language pairs
- Built-in datasets are loaded once at startup

**Skills:**

```
- getBuiltinTopics(): TopicMeta[]                              → list of built-in topics
- getTopicWords(topicId, sourceLang, targetLangs): TopicWord[] → words with translations (cache + AI)
- generateCustomTopic(prompt, sourceLang, targetLangs): Topic  → AI-generated topic
- getCacheStatus(topicId, sourceLang, targetLangs): CacheStatus → hit / miss / partial
```

---

## 🤖 Agent: `notifications`

**Role:** Manages notification scheduling and delivery. Isolated from the bot via injection.

**Rules:**

- Does not import the `bot` agent — receives `sendFn` as a parameter at startup
- One cron job for the entire schedule — do not create a job per user
- On send error — log and continue, do not stop the entire scheduler
- Respect user timezone when sending

**Skills:**

```
- startScheduler(sendFn: SendFn): void          → start cron, inject send function
- stopScheduler(): void                         → graceful shutdown
- getUsersForNotification(time): User[]         → users by time and timezone
- buildNotificationPayload(user): Payload       → word + translations for notification
- pickSuggestedWord(userId): Word | null        → AI suggestion based on topics
```

---

## 🤖 Agent: `i18n`

**Role:** Internationalization of all bot texts. Leaf agent — no dependencies.

**Rules:**

- Only `t(key, lang)` — no direct locale file imports from other modules
- On missing key — fallback to `en`, never throw an error
- Keys are a strict enum — TypeScript won't allow passing a non-existent key
- Interpolation parameters are typed: `t("welcome", lang, { name: string })`

**Skills:**

```
- t(key: I18nKey, lang: SupportedLang, params?): string   → string translation
- getSupportedLangs(): SupportedLang[]                    → list of interface languages
- isSupported(lang: string): lang is SupportedLang        → type guard
```
