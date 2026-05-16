# AI Adapter (pattern)

Switching model without changing business logic.

Uses Vercel AI SDK (`ai`) with `@openrouter/ai-sdk-provider` — a single API key gives access to all providers (OpenAI, Anthropic, Google, etc.) via OpenRouter.

```tsx
// client.ts — single OpenRouter provider, model selected via env
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateObject } from "ai";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

// Model is just a string — switch via AI_MODEL env var
const result = await generateObject({
  model: openrouter(process.env.AI_MODEL ?? "openai/gpt-4o"),
  schema: zodSchema,
  prompt: prompt,
});
```

```tsx
// ai.interface.ts
interface AIAdapter {
  translateWord(params: TranslateParams): Promise<TranslationResult>;
  generateTopic(params: GenerateTopicParams): Promise<TopicResult>;
  suggestWord(params: SuggestWordParams): Promise<SuggestResult>;
  validateTranslation(params: ValidateParams): Promise<ValidationResult>; // only when flagged
}
```

No provider factory needed — OpenRouter handles routing. To switch models, change `AI_MODEL` env var (e.g. `openai/gpt-4o` → `anthropic/claude-sonnet-4-20250514`).
