/**
 * AI Adapter — public API
 *
 * The only module that knows about OpenRouter and Vercel AI SDK.
 * All other modules receive AI responses through this adapter exclusively.
 *
 * Exports: generateObject, generateText, getAvailableModels, estimateCost
 */

export { setAIRequestMetricSink } from "./logger.js";
export { estimateCost, getAvailableModels } from "./models.js";
export type { AIModel, AIRequestLog, AIRequestMetricSink, GenerateOptions } from "./types.js";

import type { ChatMessage, ChatOptions, GenerateOptions } from "@polyglot/core";
import { generateObject as aiGenerateObject, generateText as aiGenerateText } from "ai";
import type { ZodSchema } from "zod";
import { getModel } from "./client.js";
import { logRequest } from "./logger.js";
import { calculateCost } from "./models.js";

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
      temperature: 0.3,
      frequencyPenalty: 0.5,
    });

    const duration_ms = Date.now() - start;
    const inputTokens = result.usage?.inputTokens ?? 0;
    const outputTokens = result.usage?.outputTokens ?? 0;
    const cost_usd = calculateCost(inputTokens, outputTokens, model);

    logRequest({
      model,
      requestKind: "object",
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
      requestKind: "object",
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
export async function generateText(prompt: string, model: string, options?: GenerateOptions): Promise<string> {
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
      requestKind: "text",
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
      requestKind: "text",
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
export async function generateChat(messages: ChatMessage[], model: string, options?: ChatOptions): Promise<string> {
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
