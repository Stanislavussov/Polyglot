/**
 * Runtime validation for the `ai.defaults` settings blob at the DB read boundary.
 *
 * `systemSettingsRepository.get<T>()` is an UNCHECKED cast over a JSONB column —
 * the static type is an assumption, not a guarantee. A legacy row written before
 * a field existed (e.g. `requestTimeoutMs`, added Fable T27), or any hand-edited /
 * partial blob, is still typed `AIGenerationDefaults` while carrying `undefined`
 * or garbage at runtime. That is exactly how a non-finite `requestTimeoutMs`
 * reached `setTimeout` and caused the "timed out after NaNms" total outage.
 *
 * {@link parseAIGenerationDefaults} turns the untrusted blob into a value whose
 * type is *earned*: it backfills missing keys from {@link AI_GENERATION_DEFAULTS}
 * and validates every field, falling back to the safe defaults (loudly logged) on
 * any invalid value. Downstream code can then trust the numbers instead of
 * re-checking them at every use site.
 */
import { z } from "zod";
import { getLogger } from "../../logger-interface.js";
import type { AIGenerationDefaults } from "../../ports/settings.port.js";

/** Canonical AI generation defaults — the single source of truth reused by the settings service and the read-boundary validator. */
export const AI_GENERATION_DEFAULTS: AIGenerationDefaults = {
  maxTokens: 4096,
  temperature: 0.3,
  frequencyPenalty: 0.5,
  maxRetries: 2,
  requestTimeoutMs: 15_000,
};

/**
 * Field constraints for a stored `ai.defaults` blob. `requestTimeoutMs` is capped
 * at 20_000 (below the bot's 20 s loader guard) and floored at 1_000, matching the
 * admin panel's write-side schema (`@polyglot/admin-contracts`).
 */
const aiGenerationDefaultsSchema = z.object({
  maxTokens: z.number().int().positive(),
  temperature: z.number().min(0).max(2),
  frequencyPenalty: z.number().min(0).max(2),
  maxRetries: z.number().int().min(0).max(10),
  requestTimeoutMs: z.number().int().min(1_000).max(20_000),
});

/**
 * Validates a raw `ai.defaults` blob read from the DB. Missing keys are backfilled
 * from {@link AI_GENERATION_DEFAULTS}; if any field is then still invalid (e.g.
 * `requestTimeoutMs: null`), the whole config falls back to the safe defaults and
 * the anomaly is logged (Loki-visible) so a broken blob is repaired by re-saving,
 * never silently limped along. Guarantees a finite, in-range result.
 */
export function parseAIGenerationDefaults(raw: unknown): AIGenerationDefaults {
  const merged =
    raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? { ...AI_GENERATION_DEFAULTS, ...raw }
      : AI_GENERATION_DEFAULTS;
  const parsed = aiGenerationDefaultsSchema.safeParse(merged);
  if (parsed.success) return parsed.data;
  getLogger().warn(
    { issues: parsed.error.issues },
    "ai.defaults settings blob is invalid — using safe defaults (re-save AI Defaults in the admin panel)",
  );
  return AI_GENERATION_DEFAULTS;
}
