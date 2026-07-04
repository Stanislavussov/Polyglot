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
  {
    id: "google/gemini-3.1-flash-lite",
    name: "Gemini 3.1 Flash Lite",
    provider: "google",
    maxTokens: 65_536,
    costPer1kInput: 0.00025,
    costPer1kOutput: 0.0015,
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
 * Calculate actual cost in USD from known input and output token counts.
 * Falls back to a default cost if the model is not in the registry.
 */
export function calculateCost(inputTokens: number, outputTokens: number, model: string): number {
  const entry = findModel(model);
  if (!entry) {
    return ((inputTokens + outputTokens) / 1000) * DEFAULT_COST_PER_1K;
  }
  return (inputTokens / 1000) * entry.costPer1kInput + (outputTokens / 1000) * entry.costPer1kOutput;
}

/**
 * Estimate cost in USD for a call, matching the {@link AIPort.estimateCost}
 * contract `(inputTokens, outputTokens, modelId)`. Delegates to
 * {@link calculateCost} — the two were previously separate functions with
 * mismatched signatures, which let a caller pass the output-token count where
 * the model id was expected and silently fall back to the default price (C3).
 */
export function estimateCost(inputTokens: number, outputTokens: number, modelId: string): number {
  return calculateCost(inputTokens, outputTokens, modelId);
}
