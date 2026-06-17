# Mentor Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/mentor` bot mode where the user chats with an AI language-learning coach that helps them translate and learn words through guided conversation — never translating immediately, always keeping responses short.

**Architecture:** Mentor mode plugs into the existing extensible `UserMode` system (same pattern as `translate` mode). A new `generateChat` method is added to the AI adapter to support chat-style calls with a system prompt and `maxTokens` cap. The mentor system prompt is a pure function in `@polyglot/core` that takes the user's language settings and returns a coaching-oriented prompt. Conversation history is kept in grammY session (in-memory, same as flashcard/srs sessions) and trimmed to a fixed window.

**Tech Stack:** TypeScript, grammY (Telegram bot), Vercel AI SDK + OpenRouter (`@polyglot/adapter-ai`), Drizzle ORM (`@polyglot/adapter-db`), Vitest, pnpm monorepo, Biome linter.

---

## File Structure

### New Files

| File | Responsibility |
|------|----------------|
| `packages/core/src/modules/mentor/prompt.builder.ts` | Pure function `buildMentorSystemPrompt(opts)` + `MAX_MENTOR_HISTORY` constant |
| `packages/core/src/modules/mentor/prompt.builder.test.ts` | Unit tests for the prompt builder |
| `packages/adapters/ai/src/__tests__/chat.test.ts` | Unit tests for the new `generateChat` adapter method |
| `apps/bot/src/scenes/mentor.scene.ts` | `/mentor` command handler — sets `activeMode = "mentor"`, clears history, confirms to user |
| `apps/bot/src/scenes/mentor.scene.test.ts` | Tests for the command handler |
| `apps/bot/src/scenes/helpers/mentor-mode.helper.ts` | `handleMentorText(ctx, text)` — builds messages, calls `generateChat`, manages history, replies |
| `apps/bot/src/scenes/helpers/mentor-mode.helper.test.ts` | Tests for the message handler |

### Modified Files

| File | Change |
|------|--------|
| `packages/core/src/ports/ai.port.ts` | Add `ChatMessage`, `ChatOptions` types + `generateChat` to `AIPort` interface |
| `packages/core/src/index.ts` | Export `buildMentorSystemPrompt`, `MAX_MENTOR_HISTORY`, `MentorPromptOptions`, `ChatMessage`, `ChatOptions` |
| `packages/adapters/ai/src/index.ts` | Add `generateChat(messages, model, options?)` function |
| `apps/bot/src/container.ts` | Wire `generateChat` into the `ai` object of `ServiceContainer` |
| `apps/bot/src/types.ts` | Add `"mentor"` to `UserMode`; add `mentor?` session field |
| `apps/bot/src/bot-factory.ts` | Import `handleMentorCommand`; register `bot.command("mentor", ...)`; add `mentor: undefined` to `createInitialSession` |
| `apps/bot/src/middlewares/auth.ts` | Add `"mentor"` to `VALID_MODES` set |
| `apps/bot/src/middlewares/mode-router.ts` | Import `handleMentorText`; add `case "mentor"` to the switch |
| `apps/bot/src/commands/commands.ts` | Add `{ command: "mentor", description: t("cmdDescMentor", lang) }` to the command list |
| `apps/bot/src/metrics.ts` | Add `mentorCounter` + `mentorDuration` Prometheus metrics |
| `packages/core/src/modules/i18n/locales/en.json` | Add mentor i18n keys |
| `packages/core/src/modules/i18n/locales/ru.json` | Add mentor i18n keys |
| `packages/core/src/modules/i18n/locales/cs.json` | Add mentor i18n keys |
| `CHANGELOG.md` | Add entry under `## [Unreleased]` |

### No Database Migration Needed

The `active_mode` column is `text` (no enum constraint) and the schema comment at `schema.ts:98` already says `"translate" | "mentor" | "quiz"`. Adding `"mentor"` is purely a TypeScript type change — no `pnpm db:generate` or `pnpm db:push` schema migration is required.

---

## Task 1: Core — Mentor System Prompt Builder

**Files:**
- Create: `packages/core/src/modules/mentor/prompt.builder.ts`
- Test: `packages/core/src/modules/mentor/prompt.builder.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/modules/mentor/prompt.builder.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { buildMentorSystemPrompt, MAX_MENTOR_HISTORY } from "./prompt.builder.js";

describe("buildMentorSystemPrompt", () => {
  const opts = {
    nativeLang: "en",
    learningLangs: ["cs", "ru"],
    interfaceLang: "en",
  };

  it("includes the native language in the prompt", () => {
    const prompt = buildMentorSystemPrompt(opts);
    expect(prompt).toContain("en");
  });

  it("includes all learning languages", () => {
    const prompt = buildMentorSystemPrompt(opts);
    expect(prompt).toContain("cs");
    expect(prompt).toContain("ru");
  });

  it("instructs the AI not to translate immediately", () => {
    const prompt = buildMentorSystemPrompt(opts);
    expect(prompt).toMatch(/not.*translate.*immediately/i);
  });

  it("instructs the AI to keep responses short", () => {
    const prompt = buildMentorSystemPrompt(opts);
    expect(prompt).toMatch(/short|2.?4 sentences/i);
  });

  it("includes the interface language so the AI responds in the right language", () => {
    const prompt = buildMentorSystemPrompt({ ...opts, interfaceLang: "ru" });
    expect(prompt).toContain("ru");
  });

  it("handles empty learning languages gracefully", () => {
    const prompt = buildMentorSystemPrompt({ ...opts, learningLangs: [] });
    expect(prompt).toBeTypeOf("string");
    expect(prompt.length).toBeGreaterThan(50);
  });
});

describe("MAX_MENTOR_HISTORY", () => {
  it("is a positive even number (full user+assistant turns)", () => {
    expect(MAX_MENTOR_HISTORY).toBeGreaterThan(0);
    expect(MAX_MENTOR_HISTORY % 2).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @polyglot/core test -- --run packages/core/src/modules/mentor/prompt.builder.test.ts`
Expected: FAIL — `Cannot find module './prompt.builder.js'`

- [ ] **Step 3: Write minimal implementation**

Create `packages/core/src/modules/mentor/prompt.builder.ts`:

```typescript
/**
 * Mentor mode — system prompt builder.
 *
 * The mentor is a language-learning coach that helps the user translate and
 * learn words through guided conversation. It does NOT translate immediately;
 * instead it coaches, hints, and explains — only revealing translations after
 * the user has attempted to figure out the word themselves.
 */

export interface MentorPromptOptions {
  /** User's native language (ISO 639-1 code, e.g. "en"). */
  nativeLang: string;
  /** Languages the user is learning (ISO 639-1 codes). */
  learningLangs: string[];
  /** User's interface language — the AI responds in this language. */
  interfaceLang: string;
}

/**
 * Maximum number of messages (user + assistant combined) to keep in
 * conversation history. Must be even so we always have complete turns.
 */
export const MAX_MENTOR_HISTORY = 20;

/**
 * Builds the system prompt for mentor mode.
 *
 * The prompt instructs the AI to:
 * - Not translate immediately — coach the user instead
 * - Keep responses short (2-4 sentences)
 * - Respond in the user's interface language
 * - Help discover words in learning languages, not just translate to native
 */
export function buildMentorSystemPrompt(opts: MentorPromptOptions): string {
  const { nativeLang, learningLangs, interfaceLang } = opts;
  const learningList = learningLangs.length > 0 ? learningLangs.join(", ") : "(not yet set)";

  return [
    "You are Polyglot Mentor — a language-learning coach inside a Telegram bot.",
    `The user's native language is: ${nativeLang}.`,
    `The user is learning: ${learningList}.`,
    `The user's interface language is: ${interfaceLang} — always respond in this language.`,
    "",
    "Your goal: HELP the user learn and translate words — do NOT just translate for them.",
    "When the user asks about a word or phrase:",
    "- Do NOT translate immediately. Coach the user instead.",
    "- Ask what they think it means, hint at cognates or word roots, explain context and usage.",
    "- If the user is stuck after 2-3 attempts, you may reveal the translation with a brief explanation.",
    "- Keep the tone conversational and encouraging — this is a chat, not a quiz.",
    "",
    "Rules:",
    "- Keep responses SHORT: 2-4 sentences maximum. Never write long paragraphs.",
    "- If the user sends a word in their native language, help them discover it in their learning languages.",
    "- If the user sends a word in a learning language, help them understand it without just translating to native.",
    "- Stay in the mentor role — do not switch to direct translation mode.",
  ].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @polyglot/core test -- --run packages/core/src/modules/mentor/prompt.builder.test.ts`
Expected: PASS — all tests green

- [ ] **Step 5: Export from core root index**

Modify `packages/core/src/index.ts` — add after line 83 (`export * from "./modules/translation/index.js";`):

```typescript
export { buildMentorSystemPrompt, MAX_MENTOR_HISTORY } from "./modules/mentor/prompt.builder.js";
export type { MentorPromptOptions } from "./modules/mentor/prompt.builder.js";
```

- [ ] **Step 6: Run full core test suite to verify no regressions**

Run: `pnpm --filter @polyglot/core test -- --run`
Expected: PASS — all existing tests still pass

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/modules/mentor/prompt.builder.ts packages/core/src/modules/mentor/prompt.builder.test.ts packages/core/src/index.ts
git commit -m "feat(core): add mentor system prompt builder"
```

---

## Task 2: Core — Add ChatMessage and ChatOptions Types to AIPort

**Files:**
- Modify: `packages/core/src/ports/ai.port.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add the types and update AIPort interface**

Modify `packages/core/src/ports/ai.port.ts` — replace the full file content:

```typescript
/**
 * AI Port.
 */
import type { ZodSchema } from "zod";

export interface AIModel {
  id: string;
  name: string;
  provider: string;
  maxTokens: number;
  costPer1kInput: number;
  costPer1kOutput: number;
}

export interface GenerateOptions {
  maxRetries?: number;
  userId?: number;
}

/** A single chat message with a role (system/user/assistant) and content. */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Options for generateChat — extends GenerateOptions with a maxTokens cap. */
export interface ChatOptions extends GenerateOptions {
  /** Maximum output tokens. When omitted, uses the AI SDK default. */
  maxTokens?: number;
}

export interface AIPort {
  generateObject<T>(prompt: string, schema: ZodSchema<T>, model: string, options?: GenerateOptions): Promise<T>;
  generateText(prompt: string, model: string, options?: GenerateOptions): Promise<string>;
  generateChat(messages: ChatMessage[], model: string, options?: ChatOptions): Promise<string>;
  getAvailableModels(): AIModel[];
  estimateCost(inputTokens: number, outputTokens: number, modelId: string): number;
}
```

- [ ] **Step 2: Export the new types from core root index**

Modify `packages/core/src/index.ts` — change line 3 from:

```typescript
export type { AIModel, AIPort, GenerateOptions } from "./ports/ai.port.js";
```

to:

```typescript
export type { AIModel, AIPort, ChatMessage, ChatOptions, GenerateOptions } from "./ports/ai.port.js";
```

- [ ] **Step 3: Run core type check and tests**

Run: `pnpm --filter @polyglot/core build && pnpm --filter @polyglot/core test -- --run`
Expected: PASS — build succeeds, all tests pass. The new types compile but are not yet used by any implementation (that's fine — they're type-only exports).

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/ports/ai.port.ts packages/core/src/index.ts
git commit -m "feat(core): add ChatMessage, ChatOptions types and generateChat to AIPort"
```

---

## Task 3: AI Adapter — Add generateChat Method

**Files:**
- Modify: `packages/adapters/ai/src/index.ts`
- Test: `packages/adapters/ai/src/__tests__/chat.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/adapters/ai/src/__tests__/chat.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("ai", () => ({
  generateText: vi.fn(),
  generateObject: vi.fn(),
}));

vi.mock("../logger.js", () => ({
  logRequest: vi.fn(),
}));

vi.mock("../client.js", () => ({
  getModel: vi.fn().mockReturnValue("test-model"),
}));

vi.mock("../models.js", () => ({
  calculateCost: vi.fn().mockReturnValue(0.001),
  getAvailableModels: vi.fn().mockReturnValue([]),
  estimateCost: vi.fn().mockReturnValue(0.001),
}));

import { generateText as aiGenerateText } from "ai";
import { generateChat } from "../index.js";
import { logRequest } from "../logger.js";

describe("generateChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls Vercel AI SDK generateText with messages array and maxTokens", async () => {
    vi.mocked(aiGenerateText).mockResolvedValue({
      text: "What do you think it means?",
      usage: { inputTokens: 50, outputTokens: 10 },
    } as never);

    const messages = [
      { role: "system" as const, content: "You are a mentor" },
      { role: "user" as const, content: "What does 'banka' mean?" },
    ];

    const result = await generateChat(messages, "openai/gpt-4o", {
      maxTokens: 300,
      userId: 1,
    });

    expect(result).toBe("What do you think it means?");
    expect(aiGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        messages,
        maxTokens: 300,
        maxRetries: 2,
      }),
    );
  });

  it("defaults maxRetries to 2 when not specified", async () => {
    vi.mocked(aiGenerateText).mockResolvedValue({
      text: "Hi",
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    await generateChat([{ role: "user", content: "hi" }], "openai/gpt-4o");

    expect(aiGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({ maxRetries: 2 }),
    );
  });

  it("passes maxTokens through to the SDK when provided", async () => {
    vi.mocked(aiGenerateText).mockResolvedValue({
      text: "Short reply",
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    await generateChat([{ role: "user", content: "hi" }], "openai/gpt-4o", {
      maxTokens: 512,
    });

    expect(aiGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({ maxTokens: 512 }),
    );
  });

  it("omits maxTokens from SDK call when not provided", async () => {
    vi.mocked(aiGenerateText).mockResolvedValue({
      text: "Reply",
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    await generateChat([{ role: "user", content: "hi" }], "openai/gpt-4o");

    const callArgs = vi.mocked(aiGenerateText).mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs).not.toHaveProperty("maxTokens");
  });

  it("logs the request on success with requestKind 'chat'", async () => {
    vi.mocked(aiGenerateText).mockResolvedValue({
      text: "Hi",
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    await generateChat(
      [{ role: "user", content: "hi" }],
      "openai/gpt-4o",
      { userId: 42 },
    );

    expect(logRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai/gpt-4o",
        requestKind: "chat",
        success: true,
        userId: 42,
      }),
    );
  });

  it("logs the request on failure and rethrows the error", async () => {
    const error = new Error("API down");
    vi.mocked(aiGenerateText).mockRejectedValue(error);

    await expect(
      generateChat([{ role: "user", content: "hi" }], "openai/gpt-4o", { userId: 1 }),
    ).rejects.toThrow("API down");

    expect(logRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai/gpt-4o",
        requestKind: "chat",
        success: false,
        error: "API down",
        userId: 1,
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @polyglot/adapter-ai test -- --run packages/adapters/ai/src/__tests__/chat.test.ts`
Expected: FAIL — `generateChat` is not exported from `../index.js`

- [ ] **Step 3: Implement generateChat in the AI adapter**

Modify `packages/adapters/ai/src/index.ts` — add the import for `ChatMessage`/`ChatOptions` types and the `generateChat` function. Change line 14 from:

```typescript
import type { GenerateOptions } from "@polyglot/core";
```

to:

```typescript
import type { ChatMessage, ChatOptions, GenerateOptions } from "@polyglot/core";
```

Then add the following function at the end of the file (after the `generateText` function, after line 137):

```typescript
/**
 * Generate a chat-style response from AI using a messages array with roles.
 *
 * Unlike generateText (which takes a single prompt string), generateChat
 * supports a system prompt and multi-turn conversation history via the
 * messages array. An optional maxTokens cap limits response length.
 *
 * @param messages - Array of { role, content } messages (system/user/assistant)
 * @param model    - OpenRouter model ID (e.g. "openai/gpt-4o")
 * @param options  - Optional: { maxRetries, userId, maxTokens }
 * @returns The generated text
 */
export async function generateChat(
  messages: ChatMessage[],
  model: string,
  options?: ChatOptions,
): Promise<string> {
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const start = Date.now();

  try {
    const result = await aiGenerateText({
      model: getModel(model),
      messages,
      maxRetries,
      ...(options?.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
    });

    const duration_ms = Date.now() - start;
    const inputTokens = result.usage?.inputTokens ?? 0;
    const outputTokens = result.usage?.outputTokens ?? 0;
    const cost_usd = calculateCost(inputTokens, outputTokens, model);

    logRequest({
      model,
      requestKind: "chat",
      tokens: { input: inputTokens, output: outputTokens },
      cost_usd,
      duration_ms,
      success: true,
      userId: options?.userId,
    });

    return result.text;
  } catch (error) {
    const duration_ms = Date.now() - start;

    logRequest({
      model,
      requestKind: "chat",
      tokens: { input: 0, output: 0 },
      cost_usd: 0,
      duration_ms,
      success: false,
      userId: options?.userId,
      error: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @polyglot/adapter-ai test -- --run packages/adapters/ai/src/__tests__/chat.test.ts`
Expected: PASS — all 6 tests green

- [ ] **Step 5: Run full AI adapter test suite to verify no regressions**

Run: `pnpm --filter @polyglot/adapter-ai test -- --run`
Expected: PASS — all existing tests still pass

- [ ] **Step 6: Commit**

```bash
git add packages/adapters/ai/src/index.ts packages/adapters/ai/src/__tests__/chat.test.ts
git commit -m "feat(adapter-ai): add generateChat method with system prompt and maxTokens support"
```

---

## Task 4: Bot — Wire generateChat into DI Container

**Files:**
- Modify: `apps/bot/src/container.ts`

- [ ] **Step 1: Add generateChat to the container's ai object**

Modify `apps/bot/src/container.ts` — change the import from `@polyglot/adapter-ai` (lines 8-14) from:

```typescript
import {
  estimateCost,
  generateObject,
  generateText,
  getAvailableModels,
  setAIRequestMetricSink,
} from "@polyglot/adapter-ai";
```

to:

```typescript
import {
  estimateCost,
  generateChat,
  generateObject,
  generateText,
  getAvailableModels,
  setAIRequestMetricSink,
} from "@polyglot/adapter-ai";
```

Then change the `ai` object in the container (lines 83-88) from:

```typescript
    ai: {
      generateObject,
      generateText,
      getAvailableModels,
      estimateCost,
    },
```

to:

```typescript
    ai: {
      generateObject,
      generateText,
      generateChat,
      getAvailableModels,
      estimateCost,
    },
```

- [ ] **Step 2: Run type check to verify the container compiles**

Run: `pnpm --filter bot build`
Expected: PASS — `ServiceContainer.ai` now includes `generateChat` from the `AIPort` interface (added in Task 2), and the implementation provides it. No type errors.

- [ ] **Step 3: Commit**

```bash
git add apps/bot/src/container.ts
git commit -m "feat(bot): wire generateChat into DI container"
```

---

## Task 5: Bot — Add "mentor" to UserMode and SessionData

**Files:**
- Modify: `apps/bot/src/types.ts`
- Modify: `apps/bot/src/bot-factory.ts`

- [ ] **Step 1: Add "mentor" to UserMode and add mentor session field**

Modify `apps/bot/src/types.ts` — change line 20 from:

```typescript
export type UserMode = "idle" | "translate";
```

to:

```typescript
export type UserMode = "idle" | "translate" | "mentor";
```

Then add a `mentor` field to `SessionData`. Add this after the `srs` field block (after line 156, before the `technicalMessages` field):

```typescript
  /**
   * Mentor mode conversation history (Task 66).
   * Stores the chat messages between user and AI mentor.
   * Session-only — does not persist across bot restarts.
   * The active mode itself persists in DB; history resets on restart.
   * Cleared when the user re-enters /mentor.
   */
  mentor?: {
    history: Array<{ role: "user" | "assistant"; content: string }>;
  };
```

- [ ] **Step 2: Add mentor to createInitialSession**

Modify `apps/bot/src/bot-factory.ts` — in the `createInitialSession` function (around line 133-153), add `mentor: undefined,` after the `srs: undefined,` line. The function should look like:

```typescript
export function createInitialSession(): SessionData {
  return {
    activeMode: "translate",
    pendingTranslation: undefined,
    pendingCardMsgId: undefined,
    nextSourceLang: null,
    lastTranslation: undefined,
    lastInputType: undefined,
    savedWordId: undefined,
    translationMap: {},
    needsTranslateReminder: true,
    templateWizard: undefined,
    dictionary: undefined,
    dictionaryWizard: undefined,
    flashcard: undefined,
    srs: undefined,
    mentor: undefined,
    pendingDetectedLang: undefined,
    pendingWord: undefined,
    pendingDirection: undefined,
  };
}
```

- [ ] **Step 3: Run type check to verify compilation**

Run: `pnpm --filter bot build`
Expected: PASS — the new `UserMode` value and `SessionData` field compile. Existing code that switches on `activeMode` will need a `mentor` case (added in Task 9), but the `default` branch in `mode-router.ts` prevents a type error for now since the switch has a default.

- [ ] **Step 4: Commit**

```bash
git add apps/bot/src/types.ts apps/bot/src/bot-factory.ts
git commit -m "feat(bot): add 'mentor' to UserMode and SessionData"
```

---

## Task 6: Bot — Add "mentor" to VALID_MODES in Auth Middleware

**Files:**
- Modify: `apps/bot/src/middlewares/auth.ts`
- Modify: `apps/bot/src/middlewares/auth.test.ts`

- [ ] **Step 1: Read the existing auth test to understand the mock pattern**

Read `apps/bot/src/middlewares/auth.test.ts` to understand the test structure and mocking strategy used for the auth middleware. Pay attention to how `VALID_MODES` hydration is tested (the explore agent found a test at line 136 using `activeMode: "mentor"` as a future mode mock).

- [ ] **Step 2: Add "mentor" to VALID_MODES**

Modify `apps/bot/src/middlewares/auth.ts` — change line 7 from:

```typescript
const VALID_MODES = new Set<string>(["idle", "translate"]);
```

to:

```typescript
const VALID_MODES = new Set<string>(["idle", "translate", "mentor"]);
```

- [ ] **Step 3: Update the existing test that mocks "mentor" as a future mode**

In `apps/bot/src/middlewares/auth.test.ts`, the test at line 136 uses `activeMode: "mentor"` with a comment `// future mode not yet in UserMode type`. Now that `"mentor"` is a valid mode, update that test to assert that `"mentor"` is hydrated correctly (not fallen back to `"translate"`). Read the surrounding test context and update the assertion to verify `ctx.session.activeMode` becomes `"mentor"` when the DB returns `"mentor"`.

If the test currently asserts fallback to `"translate"` for unknown modes, add a new test case instead:

```typescript
it("hydrates mentor mode from DB without falling back", async () => {
  // Setup: mock userRepository.getSettings to return { activeMode: "mentor" }
  // Assert: ctx.session.activeMode === "mentor"
});
```

Follow the exact mock pattern already used in the file for the `"translate"` hydration test.

- [ ] **Step 4: Run auth tests to verify**

Run: `pnpm --filter bot test -- --run apps/bot/src/middlewares/auth.test.ts`
Expected: PASS — the mentor mode is now recognized as valid and hydrated from DB

- [ ] **Step 5: Commit**

```bash
git add apps/bot/src/middlewares/auth.ts apps/bot/src/middlewares/auth.test.ts
git commit -m "feat(bot): add mentor to VALID_MODES in auth middleware"
```

---

## Task 7: Bot — Add Mentor Metrics

**Files:**
- Modify: `apps/bot/src/metrics.ts`

- [ ] **Step 1: Add mentorCounter and mentorDuration**

Modify `apps/bot/src/metrics.ts` — add after the `translationDuration` Histogram (after line 24):

```typescript
export const mentorCounter = new Counter({
  name: "bot_mentor_requests_total",
  help: "Total mentor chat requests",
  labelNames: ["status"] as const,
});

export const mentorDuration = new Histogram({
  name: "bot_mentor_duration_seconds",
  help: "Mentor chat request duration in seconds",
  buckets: [0.5, 1, 2, 5, 10, 30],
});
```

- [ ] **Step 2: Run type check**

Run: `pnpm --filter bot build`
Expected: PASS — the new metrics compile and are exported

- [ ] **Step 3: Commit**

```bash
git add apps/bot/src/metrics.ts
git commit -m "feat(bot): add mentorCounter and mentorDuration metrics"
```

---

## Task 8: Bot — Mentor Scene (/mentor Command Handler)

**Files:**
- Create: `apps/bot/src/scenes/mentor.scene.ts`
- Test: `apps/bot/src/scenes/mentor.scene.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/bot/src/scenes/mentor.scene.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUserRepository } = vi.hoisted(() => ({
  mockUserRepository: {
    updateActiveMode: vi.fn().mockResolvedValue({ activeMode: "mentor" }),
    getSettings: vi.fn().mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "en",
      learningLangs: ["cs"],
    }),
  },
}));

vi.mock("@polyglot/adapter-db", () => ({
  userRepository: mockUserRepository,
  getLangDisplay: vi.fn((lang: string) => lang),
}));

vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>("@polyglot/core");
  return { ...actual };
});

import { handleMentorCommand } from "./mentor.scene.js";
import type { BotContext, SessionData } from "../types.js";

function createMockCtx(overrides?: Partial<SessionData>): BotContext {
  const session: SessionData = {
    activeMode: "translate",
    mentor: undefined,
    ...overrides,
  } as SessionData;
  return {
    from: { id: 123456789 },
    chat: { id: 123456789 },
    session,
    reply: vi.fn().mockResolvedValue({ message_id: 1 }),
    user: { id: 1, telegramId: 123456789, onboarded: true },
  } as unknown as BotContext;
}

describe("handleMentorCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets session activeMode to 'mentor'", async () => {
    const ctx = createMockCtx();
    await handleMentorCommand(ctx);
    expect(ctx.session.activeMode).toBe("mentor");
  });

  it("persists mode to DB via updateActiveMode", async () => {
    const ctx = createMockCtx();
    await handleMentorCommand(ctx);
    expect(mockUserRepository.updateActiveMode).toHaveBeenCalledWith(1, "mentor");
  });

  it("clears existing mentor history on entry", async () => {
    const ctx = createMockCtx({
      mentor: { history: [{ role: "user", content: "old message" }] },
    });
    await handleMentorCommand(ctx);
    expect(ctx.session.mentor).toBeUndefined();
  });

  it("replies with a confirmation message", async () => {
    const ctx = createMockCtx();
    await handleMentorCommand(ctx);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const replyText = vi.mocked(ctx.reply).mock.calls[0][0];
    expect(replyText).toBeTypeOf("string");
    expect(replyText.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter bot test -- --run apps/bot/src/scenes/mentor.scene.test.ts`
Expected: FAIL — `Cannot find module './mentor.scene.js'`

- [ ] **Step 3: Implement the command handler**

Create `apps/bot/src/scenes/mentor.scene.ts`:

```typescript
/**
 * Mentor scene — activates mentor mode.
 *
 * In mentor mode, the user chats with an AI language-learning coach.
 * The coach helps the user translate and learn words through guided
 * conversation — it does NOT translate immediately.
 * Persists mode change to DB so it survives bot restarts.
 */
import { userRepository } from "@polyglot/adapter-db";
import { isSupported, type SupportedLang, t } from "@polyglot/core";
import type { BotContext } from "../types.js";

/**
 * Handles /mentor command — activates mentor mode.
 * Clears any existing conversation history (fresh start).
 * Persists mode change to DB.
 */
export async function handleMentorCommand(ctx: BotContext): Promise<void> {
  // Set active mode to mentor (session + DB)
  ctx.session.activeMode = "mentor";
  await userRepository.updateActiveMode(ctx.user.id, "mentor");

  // Clear any existing mentor history — each /mentor entry starts fresh
  ctx.session.mentor = undefined;

  // Get user's settings for language display
  const settings = await userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;

  // Send confirmation message
  await ctx.reply(t("mentorModeOn", lang));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter bot test -- --run apps/bot/src/scenes/mentor.scene.test.ts`
Expected: PASS — all 4 tests green

- [ ] **Step 5: Commit**

```bash
git add apps/bot/src/scenes/mentor.scene.ts apps/bot/src/scenes/mentor.scene.test.ts
git commit -m "feat(bot): add /mentor command handler"
```

---

## Task 9: Bot — Mentor Mode Message Handler

**Files:**
- Create: `apps/bot/src/scenes/helpers/mentor-mode.helper.ts`
- Test: `apps/bot/src/scenes/helpers/mentor-mode.helper.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/bot/src/scenes/helpers/mentor-mode.helper.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockUserRepository,
  mockAi,
  mockSettings,
} = vi.hoisted(() => ({
  mockUserRepository: {
    getSettings: vi.fn().mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "en",
      learningLangs: ["cs"],
    }),
  },
  mockAi: {
    generateChat: vi.fn().mockResolvedValue("What do you think it means?"),
  },
  mockSettings: {
    getDefaultAIModel: vi.fn().mockResolvedValue("openai/gpt-4o"),
    getDefaultAIModelForPlan: vi.fn().mockResolvedValue("openai/gpt-4o"),
  },
}));

vi.mock("@polyglot/adapter-db", () => ({
  userRepository: mockUserRepository,
}));

vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>("@polyglot/core");
  return { ...actual };
});

vi.mock("../../metrics.js", () => ({
  mentorCounter: { inc: vi.fn() },
  mentorDuration: { startTimer: vi.fn().mockReturnValue(() => undefined) },
}));

import { handleMentorText } from "./mentor-mode.helper.js";
import { mentorCounter, mentorDuration } from "../../metrics.js";
import { MAX_MENTOR_HISTORY, buildMentorSystemPrompt } from "@polyglot/core";
import type { BotContext, SessionData } from "../../types.js";

function createMockCtx(overrides?: Partial<SessionData>): BotContext {
  const session: SessionData = {
    activeMode: "mentor",
    mentor: undefined,
    ...overrides,
  } as SessionData;
  return {
    from: { id: 123456789 },
    chat: { id: 123456789 },
    session,
    reply: vi.fn().mockResolvedValue({ message_id: 100 }),
    user: { id: 1, telegramId: 123456789, onboarded: true, subscriptionPlan: "free" },
    services: {
      userRepository: mockUserRepository,
      ai: mockAi,
      settings: mockSettings,
    },
    api: {
      deleteMessage: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as BotContext;
}

describe("handleMentorText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls generateChat with system prompt, history, and user message", async () => {
    const ctx = createMockCtx();
    await handleMentorText(ctx, "What does banka mean?");

    expect(mockAi.generateChat).toHaveBeenCalledTimes(1);
    const args = vi.mocked(mockAi.generateChat).mock.calls[0];
    const messages = args[0];
    // First message is the system prompt
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("Polyglot Mentor");
    // Last message is the user's text
    expect(messages[messages.length - 1]).toEqual({
      role: "user",
      content: "What does banka mean?",
    });
  });

  it("passes maxTokens to limit response length", async () => {
    const ctx = createMockCtx();
    await handleMentorText(ctx, "hello");

    const options = vi.mocked(mockAi.generateChat).mock.calls[0][2];
    expect(options?.maxTokens).toBeTypeOf("number");
    expect(options?.maxTokens).toBeLessThanOrEqual(500);
  });

  it("replies with the AI response text", async () => {
    const ctx = createMockCtx();
    await handleMentorText(ctx, "hello");

    // First reply is the loading indicator, second is the actual response
    const replies = vi.mocked(ctx.reply).mock.calls;
    expect(replies.length).toBe(2);
    expect(replies[1][0]).toBe("What do you think it means?");
  });

  it("deletes the loading indicator after success", async () => {
    const ctx = createMockCtx();
    await handleMentorText(ctx, "hello");

    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(123456789, 100);
  });

  it("stores user and assistant messages in session history", async () => {
    const ctx = createMockCtx();
    await handleMentorText(ctx, "What does banka mean?");

    expect(ctx.session.mentor?.history).toEqual([
      { role: "user", content: "What does banka mean?" },
      { role: "assistant", content: "What do you think it means?" },
    ]);
  });

  it("includes previous history in the messages array", async () => {
    const ctx = createMockCtx({
      mentor: {
        history: [
          { role: "user", content: "previous question" },
          { role: "assistant", content: "previous answer" },
        ],
      },
    });
    await handleMentorText(ctx, "new question");

    const messages = vi.mocked(mockAi.generateChat).mock.calls[0][0];
    // system + 2 history + 1 new user message = 4 messages
    expect(messages.length).toBe(4);
    expect(messages[1]).toEqual({ role: "user", content: "previous question" });
    expect(messages[2]).toEqual({ role: "assistant", content: "previous answer" });
    expect(messages[3]).toEqual({ role: "user", content: "new question" });
  });

  it("trims history to MAX_MENTOR_HISTORY entries", async () => {
    // Pre-fill history with more than MAX_MENTOR_HISTORY entries
    const oldHistory = Array.from({ length: MAX_MENTOR_HISTORY + 4 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `msg ${i}`,
    }));
    const ctx = createMockCtx({ mentor: { history: oldHistory } });
    await handleMentorText(ctx, "new message");

    expect(ctx.session.mentor?.history.length).toBe(MAX_MENTOR_HISTORY);
    // The oldest entries should be trimmed, newest kept
    expect(ctx.session.mentor?.history[ctx.session.mentor!.history.length - 1]).toEqual({
      role: "assistant",
      content: "What do you think it means?",
    });
  });

  it("increments mentorCounter with success status on success", async () => {
    const ctx = createMockCtx();
    await handleMentorText(ctx, "hello");

    expect(mentorCounter.inc).toHaveBeenCalledWith({ status: "success" });
  });

  it("replies with an error message when AI call fails", async () => {
    mockAi.generateChat.mockRejectedValueOnce(new Error("API down"));
    const ctx = createMockCtx();
    await handleMentorText(ctx, "hello");

    // Loading indicator + error message
    const replies = vi.mocked(ctx.reply).mock.calls;
    expect(replies.length).toBe(2);
    expect(replies[1][0]).toMatch(/error|failed/i);
  });

  it("increments mentorCounter with error status on failure", async () => {
    mockAi.generateChat.mockRejectedValueOnce(new Error("API down"));
    const ctx = createMockCtx();
    await handleMentorText(ctx, "hello");

    expect(mentorCounter.inc).toHaveBeenCalledWith({ status: "error" });
  });

  it("rejects input longer than the max character limit", async () => {
    const ctx = createMockCtx();
    const longText = "a".repeat(2000);
    await handleMentorText(ctx, longText);

    // Should NOT call AI
    expect(mockAi.generateChat).not.toHaveBeenCalled();
    // Should reply with a warning
    const replies = vi.mocked(ctx.reply).mock.calls;
    expect(replies.length).toBe(1);
    expect(replies[0][0]).toMatch(/short|long|character|limit/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter bot test -- --run apps/bot/src/scenes/helpers/mentor-mode.helper.test.ts`
Expected: FAIL — `Cannot find module './mentor-mode.helper.js'`

- [ ] **Step 3: Implement the mentor message handler**

Create `apps/bot/src/scenes/helpers/mentor-mode.helper.ts`:

```typescript
/**
 * Mentor mode helper — handles plain text messages when activeMode === "mentor".
 *
 * The user chats with an AI language-learning coach. The coach helps the user
 * translate and learn words through guided conversation — it does NOT translate
 * immediately. Conversation history is kept in session and trimmed to
 * MAX_MENTOR_HISTORY entries to prevent unbounded growth.
 */
import {
  buildMentorSystemPrompt,
  isSupported,
  logger,
  MAX_MENTOR_HISTORY,
  t,
  type ChatMessage,
  type SupportedLang,
} from "@polyglot/core";
import type { BotContext } from "../../types.js";
import { resolveDefaultAIModel } from "../../utils/ai-model.js";
import { mentorCounter, mentorDuration } from "../../metrics.js";

/** Maximum output tokens for mentor responses — keeps replies short. */
const MENTOR_MAX_TOKENS = 300;

/** Maximum input message length in characters. */
const MENTOR_MAX_INPUT_LENGTH = 1000;

/**
 * Handles a plain text message in mentor mode.
 * Builds the system prompt + conversation history, calls generateChat,
 * and replies with the AI's coaching response.
 */
export async function handleMentorText(ctx: BotContext, text: string): Promise<void> {
  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;

  // Validate input length
  if (text.length > MENTOR_MAX_INPUT_LENGTH) {
    await ctx.reply(t("mentorInputTooLong", lang, { max: MENTOR_MAX_INPUT_LENGTH }));
    return;
  }

  // Resolve AI model
  const plan = ctx.user.subscriptionPlan;
  const model = await resolveDefaultAIModel(ctx.services.settings, plan);

  // Build system prompt from user's language settings
  const systemPrompt = buildMentorSystemPrompt({
    nativeLang: settings?.nativeLang ?? "en",
    learningLangs: settings?.learningLangs ?? [],
    interfaceLang: lang,
  });

  // Build messages: system prompt + conversation history + current user message
  const history = ctx.session.mentor?.history ?? [];
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: text },
  ];

  // Show loading indicator
  const loadingMsg = await ctx.reply(t("mentorThinking", lang));

  const stopTimer = mentorDuration.startTimer();
  try {
    const response = await ctx.services.ai.generateChat(messages, model, {
      maxTokens: MENTOR_MAX_TOKENS,
      userId: ctx.user.id,
    });

    stopTimer();
    mentorCounter.inc({ status: "success" });

    // Delete loading indicator (ignore errors if already deleted)
    await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => {});

    // Reply with the AI response
    await ctx.reply(response);

    // Update session history with the new turn, trimmed to MAX_MENTOR_HISTORY
    const newHistory = [
      ...history,
      { role: "user" as const, content: text },
      { role: "assistant" as const, content: response },
    ];
    const trimmed = newHistory.slice(-MAX_MENTOR_HISTORY);
    ctx.session.mentor = { history: trimmed };
  } catch (err) {
    stopTimer();
    mentorCounter.inc({ status: "error" });
    logger.error({ err, userId: ctx.user.id, text: text.slice(0, 50) }, "Mentor chat failed");

    // Delete loading indicator and show error
    await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => {});
    await ctx.reply(t("mentorError", lang));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter bot test -- --run apps/bot/src/scenes/helpers/mentor-mode.helper.test.ts`
Expected: PASS — all 11 tests green

- [ ] **Step 5: Commit**

```bash
git add apps/bot/src/scenes/helpers/mentor-mode.helper.ts apps/bot/src/scenes/helpers/mentor-mode.helper.test.ts
git commit -m "feat(bot): add mentor mode message handler with chat history and maxTokens cap"
```

---

## Task 10: Bot — Add Mentor Case to Mode Router

**Files:**
- Modify: `apps/bot/src/middlewares/mode-router.ts`

- [ ] **Step 1: Import handleMentorText**

Modify `apps/bot/src/middlewares/mode-router.ts` — add the import after line 14 (the `handleTranslateText` import):

```typescript
import { handleMentorText } from "../scenes/helpers/mentor-mode.helper.js";
```

- [ ] **Step 2: Add the mentor case to the switch statement**

In the same file, change the switch statement (lines 90-93) from:

```typescript
  switch (mode) {
    case "translate":
      await handleTranslateText(ctx, text);
      return; // Don't call next() — we handled it
    default: {
```

to:

```typescript
  switch (mode) {
    case "translate":
      await handleTranslateText(ctx, text);
      return; // Don't call next() — we handled it
    case "mentor":
      await handleMentorText(ctx, text);
      return;
    default: {
```

- [ ] **Step 3: Run mode-router tests (if any) and type check**

Run: `pnpm --filter bot build && pnpm --filter bot test -- --run`
Expected: PASS — the mode router compiles with the new case. The switch is now exhaustive for all `UserMode` values (`"idle"` falls into `default`).

- [ ] **Step 4: Commit**

```bash
git add apps/bot/src/middlewares/mode-router.ts
git commit -m "feat(bot): route mentor mode messages to handleMentorText"
```

---

## Task 11: Bot — Register /mentor Command in Bot Factory

**Files:**
- Modify: `apps/bot/src/bot-factory.ts`

- [ ] **Step 1: Import handleMentorCommand**

Modify `apps/bot/src/bot-factory.ts` — add the import after line 91 (the `handleTranslateCommand` import):

```typescript
import { handleMentorCommand } from "./scenes/mentor.scene.js";
```

- [ ] **Step 2: Register the bot.command handler**

In the same file, add the command registration after line 187 (`bot.command("translate", handleTranslateCommand);`):

```typescript
  bot.command("mentor", handleMentorCommand);
```

- [ ] **Step 3: Run type check**

Run: `pnpm --filter bot build`
Expected: PASS — the command is registered and the handler type matches

- [ ] **Step 4: Commit**

```bash
git add apps/bot/src/bot-factory.ts
git commit -m "feat(bot): register /mentor command in bot factory"
```

---

## Task 12: Bot — Add Mentor to Telegram Command List

**Files:**
- Modify: `apps/bot/src/commands/commands.ts`

- [ ] **Step 1: Add mentor to the localized command list**

Modify `apps/bot/src/commands/commands.ts` — in the `getLocalizedCommands` function, add the mentor command to the array. Add after the `translate` entry (after line 21):

```typescript
    { command: "mentor", description: t("cmdDescMentor", lang) },
```

The full array should look like:

```typescript
  const commands = [
    { command: "start", description: t("cmdDescStart", lang) },
    { command: "translate", description: t("cmdDescTranslate", lang) },
    { command: "mentor", description: t("cmdDescMentor", lang) },
    { command: "flashcard", description: t("cmdDescFlashcard", lang) },
    { command: "review", description: t("cmdDescReview", lang) },
    { command: "dictionary", description: t("cmdDescDictionary", lang) },
    { command: "template", description: t("cmdDescTemplate", lang) },
    { command: "settings", description: t("cmdDescSettings", lang) },
    { command: "report", description: t("cmdDescReport", lang) },
  ];
```

- [ ] **Step 2: Commit (i18n keys are added in Task 13 before running tests)**

```bash
git add apps/bot/src/commands/commands.ts
git commit -m "feat(bot): add /mentor to Telegram command list"
```

---

## Task 13: i18n — Add Mentor Keys to All Locales

**Files:**
- Modify: `packages/core/src/modules/i18n/locales/en.json`
- Modify: `packages/core/src/modules/i18n/locales/ru.json`
- Modify: `packages/core/src/modules/i18n/locales/cs.json`

- [ ] **Step 1: Add keys to English locale**

Modify `packages/core/src/modules/i18n/locales/en.json` — add the following keys. Place `cmdDescMentor` after `cmdDescTranslate` (after line 90), and place the rest near the end of the file (before the closing `}`):

```json
  "cmdDescMentor": "Chat with AI mentor to learn words",
```

And near the end (before the last closing brace):

```json
  "mentorModeOn": "🧑‍🏫 Mentor mode active! Ask me about any word and I'll help you learn it — I won't just translate, I'll coach you.",
  "mentorThinking": "🧠 Thinking...",
  "mentorError": "❌ Mentor chat failed. Please try again later.",
  "mentorInputTooLong": "⚠️ Please keep your message under {max} characters.",
```

- [ ] **Step 2: Add keys to Russian locale**

Modify `packages/core/src/modules/i18n/locales/ru.json` — add the same keys with Russian translations. Place `cmdDescMentor` after `cmdDescTranslate` (after line 90):

```json
  "cmdDescMentor": "Общаться с ИИ-наставником для изучения слов",
```

And near the end:

```json
  "mentorModeOn": "🧑‍🏫 Режим наставника активен! Спросите меня о любом слове, и я помогу вам его выучить — я не просто переведу, я буду вас направлять.",
  "mentorThinking": "🧠 Думаю...",
  "mentorError": "❌ Ошибка чата с наставником. Попробуйте позже.",
  "mentorInputTooLong": "⚠️ Пожалуйста, сократите сообщение до {max} символов.",
```

- [ ] **Step 3: Add keys to Czech locale**

Modify `packages/core/src/modules/i18n/locales/cs.json` — add the same keys with Czech translations. Place `cmdDescMentor` after `cmdDescTranslate` (after line 90):

```json
  "cmdDescMentor": "Chatovat s AI mentorem a učit se slova",
```

And near the end:

```json
  "mentorModeOn": "🧑‍🏫 Režim mentora aktivní! Zeptejte se mě na jakékoli slovo a pomůžu vám se ho naučit — nepřeložím ho jen tak, budu vás provázet.",
  "mentorThinking": "🧠 Přemýšlím...",
  "mentorError": "❌ Chat s mentorem selhal. Zkuste to prosím později.",
  "mentorInputTooLong": "⚠️ Zkraťte prosím zprávu na maximum {max} znaků.",
```

- [ ] **Step 4: Run i18n tests to verify keys are valid**

Run: `pnpm --filter @polyglot/core test -- --run`
Expected: PASS — the i18n module tests should pass with the new keys. Verify that `t("mentorModeOn", "en")` returns a non-empty string.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/i18n/locales/en.json packages/core/src/modules/i18n/locales/ru.json packages/core/src/modules/i18n/locales/cs.json
git commit -m "feat(i18n): add mentor mode keys for en, ru, cs locales"
```

---

## Task 14: CHANGELOG and Full Quality Gate

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add CHANGELOG entry**

Modify `CHANGELOG.md` — add under `## [Unreleased]`:

```markdown
### Added

- **Mentor mode** (`/mentor` command) — chat with an AI language-learning coach that helps you translate and learn words through guided conversation. The mentor coaches you instead of translating immediately, keeps responses short, and remembers conversation context within a session. Responses are capped at 300 tokens to stay concise.
```

- [ ] **Step 2: Run the full quality gate**

Run:
```bash
pnpm build && pnpm lint && pnpm lint:deps && pnpm lint:knip && pnpm test && pnpm db:push
```

Expected: ALL PASS
- `pnpm build` — compiles with zero type errors
- `pnpm lint` — Biome lint passes
- `pnpm lint:deps` — dependency-cruiser passes (no circular imports, no invalid deps)
- `pnpm lint:knip` — no unused exports
- `pnpm test` — all Vitest tests pass
- `pnpm db:push` — no schema drift (no migration needed, `active_mode` is already `text`)

If any step fails, fix the issue before proceeding. Do not defer fixes.

- [ ] **Step 3: Commit the changelog**

```bash
git add CHANGELOG.md
git commit -m "docs: add mentor mode to CHANGELOG"
```

---

## Summary of Behavior

### User Flow

1. User sends `/mentor` → bot sets `activeMode = "mentor"` (session + DB), clears any previous mentor history, replies with `mentorModeOn` confirmation.
2. User sends any plain text message → mode router dispatches to `handleMentorText`:
   - Validates input length (max 1000 chars)
   - Builds system prompt from user's native/learning/interface languages
   - Assembles messages: `[system, ...history, userMessage]`
   - Shows "🧠 Thinking..." loading indicator
   - Calls `generateChat(messages, model, { maxTokens: 300, userId })`
   - Deletes loading indicator, replies with AI response
   - Appends `[user, assistant]` to session history, trims to 20 entries
3. User can switch modes anytime: `/translate`, `/dictionary`, `/settings`, etc. — the mode router handles the switch.
4. Re-entering `/mentor` clears history and starts a fresh conversation.
5. Bot restart: `activeMode` persists from DB ("mentor" is now in `VALID_MODES`), but in-memory history is lost (same pattern as flashcard/srs sessions).

### System Prompt Behavior

The mentor system prompt instructs the AI to:
- **NOT translate immediately** — coach the user instead
- Ask what they think a word means, hint at cognates/roots, explain context
- Reveal the translation only after 2-3 failed attempts
- Keep responses to 2-4 sentences (enforced by both the prompt and `maxTokens: 300`)
- Respond in the user's interface language
- Help discover words in learning languages, not just translate to native
