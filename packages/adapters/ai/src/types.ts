import type { AIModel, GenerateOptions } from "@polyglot/core";

export type { AIModel, GenerateOptions };

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
