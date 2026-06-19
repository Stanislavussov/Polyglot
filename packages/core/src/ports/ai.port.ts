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

export interface GenerateOptions {
  maxRetries?: number;
  userId?: number;
  frequencyPenalty?: number;
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
  getAvailableModels(): AIModel[];
  estimateCost(inputTokens: number, outputTokens: number, modelId: string): number;
}
