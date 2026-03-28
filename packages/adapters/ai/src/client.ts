/**
 * AI Client — OpenRouter provider setup.
 *
 * Creates a single OpenRouter client that routes to any model
 * (OpenAI, Anthropic, Google, etc.) via one API key.
 */
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateObject as aiGenerateObject } from "ai";

let _client: ReturnType<typeof createOpenRouter> | null = null;

/**
 * Returns the singleton OpenRouter client.
 * The API key is resolved lazily so tests can set env vars before first call.
 */
export function getClient(): ReturnType<typeof createOpenRouter> {
  if (!_client) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY is not set. Configure it in your .env file.");
    }
    _client = createOpenRouter({ apiKey });
  }
  return _client;
}

/**
 * Returns a Vercel AI SDK model instance for the given model ID.
 * @param modelId — OpenRouter model ID, e.g. "openai/gpt-4o"
 */
export function getModel(modelId: string): Parameters<typeof aiGenerateObject>[0]["model"] {
  return getClient()(modelId) as Parameters<typeof aiGenerateObject>[0]["model"];
}

/**
 * Reset the client singleton (useful for tests).
 */
export function resetClient(): void {
  _client = null;
}
