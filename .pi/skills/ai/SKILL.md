---
name: ai
description: AI adapter using Vercel AI SDK with OpenRouter/multi-provider support. Provides generateObject, generateText, model listing, and cost estimation. Use when implementing or modifying AI request handling, model configuration, or response processing.
---

# ai Agent Skill

## Module Location

`packages/adapters/ai/src/`

## Architecture Context

- **Layer:** Adapter (platform-dependent)
- **Dependencies:** `validation` agent (validates responses before returning)
- **Dependents:** `translation` agent calls generateObject/generateText

## Current State

`packages/adapters/ai/src/index.ts` is empty (`export {}`). Everything needs to be implemented.

## Rules

1. Has no knowledge of domain logic — only sends requests and returns responses
2. All requests are logged: `model`, `tokens`, `cost_usd`, `duration_ms`
3. Model is always a parameter, never hardcoded internally
4. `maxRetries` is configurable from outside

## Provider Configuration

Provider is selected via `AI_PROVIDER` env var (`"openai" | "claude" | "gemini"`).
API keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`.
Config is loaded via `loadConfig()` from `@polyglot/infra`.

## Skills (Public API)

```typescript
// Generate a typed object from AI using Zod schema
async function generateObject<T>(
  prompt: string,
  schema: ZodSchema<T>,
  model: string,
  options?: { maxRetries?: number }
): Promise<T>;

// Generate free-form text
async function generateText(
  prompt: string,
  model: string,
  options?: { maxRetries?: number }
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
  error?: string;
}
```

## File Structure

```
packages/adapters/ai/src/
├── index.ts          # Re-exports: generateObject, generateText, getAvailableModels, estimateCost
├── types.ts          # AIModel, AIRequestLog
├── client.ts         # Vercel AI SDK client setup per provider
├── models.ts         # Model registry and cost data
└── logger.ts         # Request logging (model, tokens, cost, duration)
```

## Vercel AI SDK Usage Pattern

```typescript
import { generateObject as aiGenerateObject } from "ai";
import { openai } from "@ai-sdk/openai";  // or anthropic, google

const result = await aiGenerateObject({
  model: openai("gpt-4o"),
  schema: zodSchema,
  prompt: prompt,
});
```

## Reference

- AI adapter pattern: `docs/tech-reqs/06-ai-adapter.md`
- Validation pipeline: `docs/tech-reqs/07-ai-validation.md`
- Architecture: `docs/tech-reqs/02-architecture.md`
- Agent contracts: `docs/tech-reqs/14-agents.md` (ai section)
- Env config: `docs/tech-reqs/13-env.md`
