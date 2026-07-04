/**
 * AI generation functions — the concrete OpenRouter/Vercel-AI-SDK calls.
 *
 * The only module that knows about the AI SDK's `generateObject`/`generateText`.
 * All three public functions share one instrumentation scaffold
 * ({@link withInstrumentedCall}) so the timeout → call → cost → logging pipeline
 * lives in a single place instead of being copy-pasted per request kind.
 */

import { AITimeoutError, type ChatMessage, type ChatOptions, type GenerateOptions } from "@polyglot/core";
import { generateObject as aiGenerateObject, generateText as aiGenerateText } from "ai";
import type { ZodSchema } from "zod";
import { getModel } from "./client.js";
import { type GenerationParams, resolveGenerationParams } from "./generation-defaults.js";
import { logRequest } from "./logger.js";
import { resolveModelCost } from "./model-price.js";
import { createRequestTimeout, resolveRequestTimeoutMs } from "./timeout.js";
import type { AIRequestLog } from "./types.js";

/** Token usage as reported by the AI SDK (structural — avoids importing SDK types). */
interface CallUsage {
  inputTokens?: number;
  outputTokens?: number;
}

/** Resolved per-call context handed to the SDK-specific callback. */
interface CallContext {
  defaults: GenerationParams;
  maxRetries: number;
  signal: AbortSignal;
}

/**
 * Runs one AI call with the shared instrumentation scaffold: resolve generation
 * defaults + timeout budget, abort on budget, then log the request (with token
 * cost) on both success and failure. The SDK-specific work (which `ai` function
 * to call and how to read its result) is supplied by `fn`.
 */
async function withInstrumentedCall<R>(
  requestKind: AIRequestLog["requestKind"],
  model: string,
  options: GenerateOptions | undefined,
  fn: (ctx: CallContext) => Promise<{ value: R; usage?: CallUsage }>,
): Promise<R> {
  const defaults = await resolveGenerationParams();
  const maxRetries = options?.maxRetries ?? defaults.maxRetries;
  const budgetMs = await resolveRequestTimeoutMs();
  const timeout = createRequestTimeout(budgetMs);
  const start = Date.now();

  try {
    const { value, usage } = await fn({ defaults, maxRetries, signal: timeout.signal });

    const duration_ms = Date.now() - start;
    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;
    const cost_usd = await resolveModelCost(inputTokens, outputTokens, model);

    logRequest({
      model,
      requestKind,
      tokens: { input: inputTokens, output: outputTokens },
      cost_usd,
      duration_ms,
      success: true,
      userId: options?.userId,
    });

    return value;
  } catch (error) {
    const duration_ms = Date.now() - start;
    const normalizedError = timeout.timedOut() ? new AITimeoutError(budgetMs) : error;

    logRequest({
      model,
      requestKind,
      tokens: { input: 0, output: 0 },
      cost_usd: 0,
      duration_ms,
      success: false,
      userId: options?.userId,
      error: normalizedError instanceof Error ? normalizedError.message : String(normalizedError),
    });

    throw normalizedError;
  } finally {
    timeout.clear();
  }
}

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
  return withInstrumentedCall("object", model, options, async ({ defaults, maxRetries, signal }) => {
    const result = await aiGenerateObject({
      model: getModel(model),
      schema,
      prompt,
      maxRetries,
      maxTokens: options?.maxTokens ?? defaults.maxTokens,
      temperature: defaults.temperature,
      frequencyPenalty: options?.frequencyPenalty ?? defaults.frequencyPenalty,
      abortSignal: signal,
    });
    return { value: result.object, usage: result.usage };
  });
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
  return withInstrumentedCall("text", model, options, async ({ maxRetries, signal }) => {
    const result = await aiGenerateText({
      model: getModel(model),
      prompt,
      maxRetries,
      abortSignal: signal,
    });
    return { value: result.text, usage: result.usage };
  });
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
  return withInstrumentedCall("chat", model, options, async ({ maxRetries, signal }) => {
    const result = await aiGenerateText({
      model: getModel(model),
      messages,
      maxRetries,
      abortSignal: signal,
      ...(options?.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
    });
    return { value: result.text, usage: result.usage };
  });
}
