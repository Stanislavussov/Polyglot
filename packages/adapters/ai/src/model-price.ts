/**
 * AI model pricing — resolved from the single DB-backed source (the `ai_models`
 * table, managed in the admin panel) rather than a hardcoded registry (Fable
 * T21/A8). Previously a `MODEL_REGISTRY` in this adapter carried its own prices;
 * a model added through the admin panel was absent from that registry and its
 * cost silently fell back to a flat default — so cost accounting lied for every
 * admin-managed model.
 *
 * The adapter must not depend on the settings service directly, so the
 * composition root injects a provider via {@link setAIModelPriceProvider} — the
 * same dependency-injection pattern as the request-timeout and metric-sink
 * providers. When no provider is wired (tests, benchmark CLI) or a model id is
 * unknown, the flat {@link DEFAULT_COST_PER_1K} keeps cost logging non-zero
 * instead of throwing.
 */

/** Per-1k-token price of a model, as stored in `ai_models`. */
export interface AIModelPrice {
  costPer1kInput: number;
  costPer1kOutput: number;
}

/** Resolves a model's price by id. May be async (DB-backed, cached). `null` = unknown model. */
export type AIModelPriceProvider = (modelId: string) => AIModelPrice | null | Promise<AIModelPrice | null>;

/** Flat per-1k-token price used when no provider is wired or the model is unknown. */
export const DEFAULT_COST_PER_1K = 0.002;

let provider: AIModelPriceProvider | null = null;

/**
 * Injects the source of model prices. Pass `null` to reset to the built-in
 * default (e.g. between tests).
 */
export function setAIModelPriceProvider(next: AIModelPriceProvider | null): void {
  provider = next;
}

/**
 * Computes the USD cost of a call from its token counts, pricing the model via
 * the injected provider. Falls back to {@link DEFAULT_COST_PER_1K} when no
 * provider is wired, it throws, or the model id is unknown — a missing price
 * must never crash a completed AI call, only make its logged cost approximate.
 */
export async function resolveModelCost(inputTokens: number, outputTokens: number, modelId: string): Promise<number> {
  const price = await resolvePrice(modelId);
  if (!price) {
    return ((inputTokens + outputTokens) / 1000) * DEFAULT_COST_PER_1K;
  }
  return (inputTokens / 1000) * price.costPer1kInput + (outputTokens / 1000) * price.costPer1kOutput;
}

async function resolvePrice(modelId: string): Promise<AIModelPrice | null> {
  if (!provider) return null;
  try {
    return await provider(modelId);
  } catch {
    return null;
  }
}
