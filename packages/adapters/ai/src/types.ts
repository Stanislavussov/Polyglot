import type { AIModel, GenerateOptions } from "@polyglot/core";

export type { AIModel, GenerateOptions };

/** Logged after every AI request */
export interface AIRequestLog {
  model: string;
  requestKind: "object" | "text" | "chat";
  tokens: { input: number; output: number };
  cost_usd: number;
  duration_ms: number;
  success: boolean;
  userId?: number;
  error?: string;
  /** Wall-clock budget this call was given, in ms. */
  budgetMs?: number;
  /** True when the budget — not the provider — ended the call. */
  timedOut?: boolean;
}

export type AIRequestMetricSink = (log: AIRequestLog) => void | Promise<void>;
