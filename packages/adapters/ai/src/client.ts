/**
 * AI Client — OpenRouter provider setup.
 *
 * Creates a single OpenRouter client that routes to any model
 * (OpenAI, Anthropic, Google, etc.) via one API key.
 *
 * The client is a process-wide singleton, but its lifecycle is the composition
 * root's job (Fable T29/A17): the app injects the API key via
 * {@link setAIApiKey}. When no key is injected the client falls back to
 * `OPENROUTER_API_KEY` from the environment, so tools and tests that rely on the
 * env var keep working.
 */
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateObject as aiGenerateObject } from "ai";

let _client: ReturnType<typeof createOpenRouter> | null = null;
let _apiKey: string | null = null;

/**
 * Injects the OpenRouter API key from the composition root. Pass `null` to reset
 * (e.g. between tests). Rebuilds the singleton on the next {@link getClient} so a
 * new key takes effect.
 */
export function setAIApiKey(apiKey: string | null): void {
  _apiKey = apiKey;
  _client = null;
}

/**
 * Returns the singleton OpenRouter client.
 * The API key is resolved lazily: the injected key wins, otherwise it falls back
 * to `OPENROUTER_API_KEY` from the environment (so tests can set env vars).
 */
export function getClient(): ReturnType<typeof createOpenRouter> {
  if (!_client) {
    const apiKey = _apiKey ?? process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY is not set. Configure it in your .env file.");
    }
    _client = createOpenRouter({ apiKey });
  }
  return _client;
}

/**
 * Returns the resolved OpenRouter API key, applying the same precedence as
 * {@link getClient} (injected key wins, then `OPENROUTER_API_KEY`).
 *
 * Exists for the endpoints the AI SDK provider does not cover — currently
 * `/audio/speech`, which is called with a plain `fetch` — so those calls read the
 * key from one place rather than reaching for `process.env` on their own.
 */
export function getApiKey(): string {
  const apiKey = _apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set. Configure it in your .env file.");
  }
  return apiKey;
}

/**
 * Returns a Vercel AI SDK model instance for the given model ID.
 * @param modelId — OpenRouter model ID, e.g. "openai/gpt-4o"
 */
export function getModel(modelId: string): Parameters<typeof aiGenerateObject>[0]["model"] {
  return getClient()(modelId) as Parameters<typeof aiGenerateObject>[0]["model"];
}

/**
 * Reset the client singleton and any injected key (useful for tests).
 */
export function resetClient(): void {
  _client = null;
  _apiKey = null;
}
