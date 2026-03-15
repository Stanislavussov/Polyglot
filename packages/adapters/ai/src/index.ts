/**
 * AI Adapter — public API
 *
 * The only module that knows about OpenRouter and Vercel AI SDK.
 * All other modules receive AI responses through this adapter exclusively.
 *
 * Exports: generateObject, generateText, getAvailableModels, estimateCost
 */
export { getAvailableModels, estimateCost } from "./models.js";
export type { AIModel, AIRequestLog, GenerateOptions } from "./types.js";

import {
  generateObject as aiGenerateObject,
  generateText as aiGenerateText,
} from "ai";
import type { ZodSchema } from "zod";
import { getModel } from "./client.js";
import { calculateCost } from "./models.js";
import { logRequest } from "./logger.js";
import type { GenerateOptions } from "./types.js";

const DEFAULT_MAX_RETRIES = 2;

/**
 * Generate a typed object from AI using a Zod schema.
 *
 * @param prompt  - The prompt to send to the AI
 * @param schema  - Zod schema that defines the expected response structure
 * @param model   - OpenRouter model ID (e.g. "openai/gpt-4o")
 * @param options - Optional: { maxRetries }
 * @returns The validated, typed object
 */
export async function generateObject<T>(
  prompt: string,
  schema: ZodSchema<T>,
  model: string,
  options?: GenerateOptions,
): Promise<T> {
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const start = Date.now();

  try {
    const result = await aiGenerateObject({
      model: getModel(model),
      schema,
      prompt,
      maxRetries,
      maxTokens: 4096,
    });

    const duration_ms = Date.now() - start;
    const inputTokens = result.usage?.inputTokens ?? 0;
    const outputTokens = result.usage?.outputTokens ?? 0;
    const cost_usd = calculateCost(inputTokens, outputTokens, model);

    logRequest({
      model,
      tokens: { input: inputTokens, output: outputTokens },
      cost_usd,
      duration_ms,
      success: true,
      userId: options?.userId,
    });

    return result.object;
  } catch (error) {
    const duration_ms = Date.now() - start;

    logRequest({
      model,
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

/**
 * Generate free-form text from AI.
 *
 * @param prompt  - The prompt to send to the AI
 * @param model   - OpenRouter model ID (e.g. "openai/gpt-4o")
 * @param options - Optional: { maxRetries, userId }
 * @returns The generated text
 */
export async function generateText(
  prompt: string,
  model: string,
  options?: GenerateOptions,
): Promise<string> {
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const start = Date.now();

  try {
    const result = await aiGenerateText({
      model: getModel(model),
      prompt,
      maxRetries,
    });

    const duration_ms = Date.now() - start;
    const inputTokens = result.usage?.inputTokens ?? 0;
    const outputTokens = result.usage?.outputTokens ?? 0;
    const cost_usd = calculateCost(inputTokens, outputTokens, model);

    logRequest({
      model,
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
