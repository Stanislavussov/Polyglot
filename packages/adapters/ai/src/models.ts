/**
 * Model Registry — known models with cost data.
 *
 * Costs are per 1 000 tokens (OpenRouter pricing, approximate).
 * This list is not exhaustive; any model ID accepted by OpenRouter works.
 */
import type { AIModel } from "./types.js";

const MODEL_REGISTRY: AIModel[] = [
  {
    id: "openai/gpt-4o",
    name: "GPT-4o",
    provider: "openai",
    maxTokens: 16_384,
    costPer1kInput: 0.0025,
    costPer1kOutput: 0.01,
  },
  {
    id: "openai/gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "openai",
    maxTokens: 16_384,
    costPer1kInput: 0.00015,
    costPer1kOutput: 0.0006,
  },
  {
    id: "openai/gpt-5-nano",
    name: "GPT-5 Nano",
    provider: "openai",
    maxTokens: 16_384,
    costPer1kInput: 0.0001,
    costPer1kOutput: 0.0004,
  },
  {
    id: "anthropic/claude-sonnet-4-20250514",
    name: "Claude Sonnet 4",
    provider: "anthropic",
    maxTokens: 8_192,
    costPer1kInput: 0.003,
    costPer1kOutput: 0.015,
  },
  {
    id: "anthropic/claude-haiku-3.5",
    name: "Claude 3.5 Haiku",
    provider: "anthropic",
    maxTokens: 8_192,
    costPer1kInput: 0.0008,
    costPer1kOutput: 0.004,
  },
  {
    id: "google/gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "google",
    maxTokens: 65_536,
    costPer1kInput: 0.00125,
    costPer1kOutput: 0.01,
  },
  {
    id: "google/gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "google",
    maxTokens: 65_536,
    costPer1kInput: 0.00015,
    costPer1kOutput: 0.0006,
  },
];

/** Default cost if model is not in registry */
const DEFAULT_COST_PER_1K = 0.002;

/**
 * Returns all known models with their cost data.
 */
export function getAvailableModels(): AIModel[] {
  return [...MODEL_REGISTRY];
}

/**
 * Look up a model by ID. Returns undefined if not in registry.
 */
export function findModel(modelId: string): AIModel | undefined {
  return MODEL_REGISTRY.find((m) => m.id === modelId);
}

/**
 * Estimate cost in USD for a given number of tokens and model.
 * Uses average of input/output cost if direction is unknown.
 * Falls back to a default cost if the model is not in registry.
 */
export function estimateCost(tokens: number, model: string): number {
  const entry = findModel(model);
  if (!entry) {
    return (tokens / 1000) * DEFAULT_COST_PER_1K;
  }
  // Use average of input and output costs
  const avgCost = (entry.costPer1kInput + entry.costPer1kOutput) / 2;
  return (tokens / 1000) * avgCost;
}

/**
 * Calculate actual cost from known input and output token counts.
 */
export function calculateCost(inputTokens: number, outputTokens: number, model: string): number {
  const entry = findModel(model);
  if (!entry) {
    return ((inputTokens + outputTokens) / 1000) * DEFAULT_COST_PER_1K;
  }
  return (inputTokens / 1000) * entry.costPer1kInput + (outputTokens / 1000) * entry.costPer1kOutput;
}
