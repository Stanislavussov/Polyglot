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

/**
 * Fixed budget split for AI fallback-model failover (bot self-healing Phase 2).
 *
 * This is a QUALITY UPGRADE, not a freeze fix: the adapter's per-call abort budget
 * already bounds a hung provider and surfaces an `AITimeoutError`. Failover turns
 * that surfaced error (or a 429/5xx) into a successful reply on a second model.
 *
 * The split is fixed up front — no shared-remaining-budget arithmetic. The primary
 * attempt runs bounded by `primaryBudgetMs`; on a retriable failure the fallback
 * model runs bounded by `reservedFallbackMs`. Both together stay inside the outer
 * op guard: `primaryBudgetMs + reservedFallbackMs <= B` (the clamped request
 * budget), so a hung primary can be aborted with time still left for the fallback.
 */
export interface AIFailover {
  /** Distinct fallback model tried when the primary fails retriably. */
  fallbackModel: string;
  /** Abort budget (ms) for the primary attempt — `B - reservedFallbackMs`. */
  primaryBudgetMs: number;
  /** Abort budget (ms) reserved for the fallback attempt. */
  reservedFallbackMs: number;
}

export interface GenerateOptions {
  maxRetries?: number;
  userId?: number;
  frequencyPenalty?: number;
  /** Maximum output tokens. When omitted, the adapter uses its default cap. */
  maxTokens?: number;
  /**
   * Overrides the adapter's resolved per-request abort budget for this single
   * attempt (ms). When omitted the adapter self-resolves it (unchanged behavior).
   * Used by failover to bound the primary and fallback attempts independently.
   */
  budgetMs?: number;
  /**
   * When present, the adapter routes the call through fallback-model failover
   * (Phase 2). Omit for unchanged single-model behavior.
   */
  failover?: AIFailover;
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
}

/**
 * Canonical signature of the AI "generate typed object" function, injected into
 * core modules so they never import the AI adapter directly. This is the single
 * source of truth — modules import it from here rather than redeclaring it.
 */
export type GenerateObjectFn = AIPort["generateObject"];
