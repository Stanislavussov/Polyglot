/**
 * AI Adapter Types
 * Platform-specific types for the AI adapter layer.
 */

/** Describes an available AI model with pricing info */
export interface AIModel {
  id: string;
  name: string;
  provider: string;
  maxTokens: number;
  costPer1kInput: number;
  costPer1kOutput: number;
}

/** Logged after every AI request */
export interface AIRequestLog {
  model: string;
  tokens: { input: number; output: number };
  cost_usd: number;
  duration_ms: number;
  success: boolean;
  userId?: number;
  error?: string;
}

/** Options for AI generation calls */
export interface GenerateOptions {
  maxRetries?: number;
  userId?: number;
}
