---
name: ai
description: AI adapter using Vercel AI SDK with OpenRouter/multi-provider support. Provides generateObject, generateText, model listing, and cost estimation. Use when implementing or modifying AI request handling, model configuration, or response processing.
---

# ai Agent Skill

## Module Location

`packages/adapters/ai/src/`

## Architecture Context

- **Layer:** Adapter (platform-dependent)
- **Dependencies:** `@polyglot/infra` (logger, config), `ai` (Vercel AI SDK), `@openrouter/ai-sdk-provider`
- **Dependents:** `translation` agent calls generateObject/generateText

## Current State

Fully implemented. All 4 source files + 5 test files in place. 47 tests passing.
`userId` support added to `AIRequestLog`, `GenerateOptions`, and threaded through `generateObject`/`generateText` → `logRequest` → pino output (Task 05 — structured logging). `GenerateOptions.frequencyPenalty` allows callers to override the structured-generation default per request; translation requests use `0` while other callers retain the adapter default.

## Boundary

- **Mode:** role — when this skill is active, you ARE the AI adapter agent. Only modify the AI adapter layer.
- **Produces:** AI adapter source code and tests in `packages/adapters/ai/src/`
- **Never:** modify code outside `packages/adapters/ai/src/`
- **Never:** contain domain/business logic — only send requests and return responses
- **Never:** hardcode model IDs or API keys
- **Allowed tools:** `read`, `bash`, `edit`, `write`
- **Allowed write paths:** `packages/adapters/ai/src/**`

## Rules

1. Has no knowledge of domain logic — only sends requests and returns responses
2. All requests are logged: `model`, `tokens`, `cost_usd`, `duration_ms`, `userId` (when provided)
3. Model is always a parameter, never hardcoded internally
4. `maxRetries` is configurable from outside (default: 2)

## Provider Configuration

Uses OpenRouter as the single AI provider — one API key for all models (OpenAI, Anthropic, Google, etc.).

- `OPENROUTER_API_KEY` — single API key for all providers
- `AI_MODEL` — OpenRouter model ID (e.g. `openai/gpt-4o`, `anthropic/claude-sonnet-4-20250514`, `google/gemini-2.5-pro`)

## Skills (Public API)

```typescript
// Generate a typed object from AI using Zod schema
async function generateObject<T>(
  prompt: string,
  schema: ZodSchema<T>,
  model: string,
  options?: { maxRetries?: number; userId?: number; frequencyPenalty?: number }
): Promise<T>;

// Generate free-form text
async function generateText(
  prompt: string,
  model: string,
  options?: { maxRetries?: number; userId?: number }
): Promise<string>;

// List available models for the configured provider
function getAvailableModels(): AIModel[];

// Estimate cost for a given token count and model
function estimateCost(tokens: number, model: string): number;
```

## Types

```typescript
interface AIModel {
  id: string;
  name: string;
  provider: string;
  maxTokens: number;
  costPer1kInput: number;
  costPer1kOutput: number;
}

interface AIRequestLog {
  model: string;
  tokens: { input: number; output: number };
  cost_usd: number;
  duration_ms: number;
  success: boolean;
  userId?: number;
  error?: string;
}

interface GenerateOptions {
  maxRetries?: number;
  userId?: number;
  frequencyPenalty?: number;
}
```

## File Structure

```
packages/adapters/ai/src/
├── index.ts          # Re-exports: generateObject, generateText, getAvailableModels, estimateCost
├── types.ts          # AIModel, AIRequestLog, GenerateOptions
├── client.ts         # OpenRouter client singleton (lazy init, resetClient for tests)
├── models.ts         # Model registry, getAvailableModels, findModel, estimateCost, calculateCost
├── logger.ts         # Request logging via pino child logger (module: "ai-adapter")
└── __tests__/
    ├── index.test.ts   # 17 tests: generateObject + generateText with mocked AI SDK, userId threading
    ├── client.test.ts  # 5 tests: singleton, API key validation, reset
    ├── models.test.ts  # 12 tests: registry, findModel, estimateCost, calculateCost
    ├── logger.test.ts  # 8 tests: info/error logging, cost rounding, userId inclusion/omission
    └── types.test.ts   # 5 tests: type interface validation, userId support
```

## Internal Functions (not exported from index.ts)

```typescript
// client.ts
function getClient(): OpenRouterClient;   // Singleton, lazy init
function getModel(modelId: string): Model; // Returns AI SDK model instance
function resetClient(): void;             // Reset singleton (for tests)

// models.ts
function findModel(modelId: string): AIModel | undefined;
function calculateCost(inputTokens: number, outputTokens: number, model: string): number;
```

## Vercel AI SDK Usage Pattern

```typescript
import { generateObject as aiGenerateObject } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });

const result = await aiGenerateObject({
  model: openrouter("openai/gpt-4o"),
  schema: zodSchema,
  prompt: prompt,
  maxRetries: 2,
});
```

## Reference

- AI adapter pattern: `docs/tech-reqs/06-ai-adapter.md`
- Validation pipeline: `docs/tech-reqs/07-ai-validation.md`
- Architecture: `docs/tech-reqs/02-architecture.md`
- Agent contracts: `docs/tech-reqs/14-agents.md` (ai section)
- Env config: `docs/tech-reqs/13-env.md`
