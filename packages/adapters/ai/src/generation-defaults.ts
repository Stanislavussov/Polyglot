import type { AIGenerationDefaults } from "@polyglot/core";

/**
 * AI generation parameters — the model-tuning knobs (`maxTokens`, `temperature`,
 * `frequencyPenalty`, `maxRetries`) applied to every AI call. These are
 * admin-managed (DB `system_settings` `ai.defaults` row, editable in the admin
 * panel's AI Defaults tab). Previously the adapter hardcoded them, so the whole
 * `AIGenerationDefaults` contract was dead except for the request timeout (Fable
 * T21/A4).
 *
 * The adapter must not depend on the settings service directly, so the
 * composition root injects a provider via {@link setAIGenerationDefaultsProvider}
 * — the same DI pattern as the request-timeout and model-price providers. The
 * request-timeout half of `AIGenerationDefaults` keeps its own provider
 * ({@link import("./timeout.js")}) because it drives the abort budget, not the
 * SDK call parameters; both read the same cached settings object.
 *
 * A per-call `options` override (e.g. a specific `maxTokens`) still wins over the
 * resolved default — the provider only supplies the baseline.
 */

/** The four generation knobs, resolved for a call. */
export interface GenerationParams {
  maxTokens: number;
  temperature: number;
  frequencyPenalty: number;
  maxRetries: number;
}

/** Resolves the current generation defaults. May be async (DB-backed, cached). */
export type AIGenerationDefaultsProvider = () => AIGenerationDefaults | Promise<AIGenerationDefaults>;

/** Built-in baseline used when no provider is wired or a field is invalid. */
export const DEFAULT_GENERATION_PARAMS: GenerationParams = {
  maxTokens: 4096,
  temperature: 0.3,
  frequencyPenalty: 0.5,
  maxRetries: 2,
};

let provider: AIGenerationDefaultsProvider | null = null;

/** Injects the source of generation defaults. Pass `null` to reset (e.g. between tests). */
export function setAIGenerationDefaultsProvider(next: AIGenerationDefaultsProvider | null): void {
  provider = next;
}

/**
 * Resolves the generation knobs, falling back to {@link DEFAULT_GENERATION_PARAMS}
 * when no provider is wired or it throws, and to the per-field default when a
 * single value is non-finite/negative — a misconfigured setting must never make
 * a call fail, only revert that knob to its safe baseline.
 */
export async function resolveGenerationParams(): Promise<GenerationParams> {
  if (!provider) return DEFAULT_GENERATION_PARAMS;
  try {
    const d = await provider();
    return {
      maxTokens: positive(d.maxTokens, DEFAULT_GENERATION_PARAMS.maxTokens),
      temperature: nonNegative(d.temperature, DEFAULT_GENERATION_PARAMS.temperature),
      frequencyPenalty: nonNegative(d.frequencyPenalty, DEFAULT_GENERATION_PARAMS.frequencyPenalty),
      maxRetries: nonNegativeInt(d.maxRetries, DEFAULT_GENERATION_PARAMS.maxRetries),
    };
  } catch {
    return DEFAULT_GENERATION_PARAMS;
  }
}

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegative(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function nonNegativeInt(value: number, fallback: number): number {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}
