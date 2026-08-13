/**
 * AI generation functions — the concrete OpenRouter/Vercel-AI-SDK calls.
 *
 * The only module that knows about the AI SDK's `generateObject`/`generateText`.
 * All three public functions share one instrumentation scaffold
 * ({@link withInstrumentedCall}) so the timeout → call → cost → logging pipeline
 * lives in a single place instead of being copy-pasted per request kind.
 */

import {
  AITimeoutError,
  type ChatMessage,
  type ChatOptions,
  type GenerateOptions,
  isFinitePositive,
} from "@polyglot/core";
import { generateObject as aiGenerateObject, generateText as aiGenerateText } from "ai";
import type { ZodSchema } from "zod";
import { getModel } from "./client.js";
import { withModelFailover } from "./failover.js";
import { type GenerationParams, resolveGenerationParams } from "./generation-defaults.js";
import { logRequest } from "./logger.js";
import { resolveModelCost } from "./model-price.js";
import { createRequestTimeout, resolveRequestTimeoutMs } from "./timeout.js";
import type { AIRequestLog } from "./types.js";

/**
 * When failover is configured the fallback model IS the retry strategy, so the
 * primary attempt should not also burn the AI SDK's internal retries inside its
 * tighter budget. Cap retries here unless the caller set an explicit value.
 */
const FAILOVER_MAX_RETRIES = 1;

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
  /** The model this attempt runs on — may be the fallback when failover kicked in. */
  model: string;
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
  // N1a: an injected budget (e.g. a failover attempt's split) overrides the
  // self-resolved request budget; when omitted OR non-finite it falls back to the
  // guarded resolver. A plain `??` would let an injected NaN/Infinity through
  // (nullish only traps null/undefined), and `setTimeout(NaN)` fires immediately —
  // the root of the "timed out after NaNms" outage. This is the last-line guard so
  // no budget path (direct or failover) can ever mint a non-finite timeout.
  const injectedBudgetMs = options?.budgetMs;
  const budgetMs = isFinitePositive(injectedBudgetMs) ? injectedBudgetMs : await resolveRequestTimeoutMs();
  const timeout = createRequestTimeout(budgetMs);
  const start = Date.now();

  try {
    const { value, usage } = await fn({ defaults, maxRetries, signal: timeout.signal, model });

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
      budgetMs,
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
      budgetMs,
      timedOut: timeout.timedOut(),
      error: normalizedError instanceof Error ? normalizedError.message : String(normalizedError),
    });

    throw normalizedError;
  } finally {
    timeout.clear();
  }
}

/**
 * Dispatches one generate call, optionally through fallback-model failover.
 *
 * With no `options.failover` it is exactly {@link withInstrumentedCall} — unchanged
 * single-model behavior. With failover configured it routes through
 * {@link withModelFailover}, which runs the primary bounded by `primaryBudgetMs`
 * and, on a retriable failure, the fallback bounded by `reservedFallbackMs`. Each
 * attempt is a full instrumented call (own abort budget, cost + logging) with its
 * split budget injected as `options.budgetMs` and the failover config stripped so
 * the inner call never recurses.
 */
function runGenerate<R>(
  requestKind: AIRequestLog["requestKind"],
  model: string,
  options: GenerateOptions | undefined,
  fn: (ctx: CallContext) => Promise<{ value: R; usage?: CallUsage }>,
): Promise<R> {
  const failover = options?.failover;
  if (!failover) {
    return withInstrumentedCall(requestKind, model, options, fn);
  }

  const base: GenerateOptions = { ...options, maxRetries: options?.maxRetries ?? FAILOVER_MAX_RETRIES };
  base.failover = undefined;

  return withModelFailover(
    {
      primaryModel: model,
      fallbackModel: failover.fallbackModel,
      primaryBudgetMs: failover.primaryBudgetMs,
      reservedFallbackMs: failover.reservedFallbackMs,
    },
    (attemptModel, { budgetMs }) => withInstrumentedCall(requestKind, attemptModel, { ...base, budgetMs }, fn),
  );
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
  return runGenerate("object", model, options, async ({ defaults, maxRetries, signal, model: attemptModel }) => {
    const result = await aiGenerateObject({
      model: getModel(attemptModel),
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
  return runGenerate("text", model, options, async ({ maxRetries, signal, model: attemptModel }) => {
    const result = await aiGenerateText({
      model: getModel(attemptModel),
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
  return runGenerate("chat", model, options, async ({ maxRetries, signal, model: attemptModel }) => {
    const result = await aiGenerateText({
      model: getModel(attemptModel),
      messages,
      maxRetries,
      abortSignal: signal,
      ...(options?.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
    });
    return { value: result.text, usage: result.usage };
  });
}
