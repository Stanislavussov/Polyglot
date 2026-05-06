/**
 * AI Port.
 */
import type { ZodSchema } from "zod";

export interface AIModel {
  id: string;
  name: string;
  provider: string;
  maxTokens: number;
}

export interface GenerateOptions {
  maxRetries?: number;
  userId?: number;
}

export interface AIPort {
  generateObject<T>(prompt: string, schema: ZodSchema<T>, model: string, options?: GenerateOptions): Promise<T>;
  generateText(prompt: string, model: string, options?: GenerateOptions): Promise<string>;
  getAvailableModels(): AIModel[];
  estimateCost(inputTokens: number, outputTokens: number, modelId: string): number;
}
