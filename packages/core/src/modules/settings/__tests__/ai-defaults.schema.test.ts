/**
 * Spec for the `ai.defaults` read-boundary validator. It turns an untrusted DB
 * blob (unchecked JSONB cast) into a guaranteed-valid config: missing keys are
 * backfilled, invalid/partial blobs fall back to safe defaults. This is the
 * boundary that makes a non-finite `requestTimeoutMs` unreachable downstream.
 */
import { describe, expect, it } from "vitest";
import { AI_GENERATION_DEFAULTS, parseAIGenerationDefaults } from "../ai-defaults.schema.js";

describe("parseAIGenerationDefaults", () => {
  it("returns a complete, valid blob unchanged", () => {
    const stored = { maxTokens: 8192, temperature: 0.7, frequencyPenalty: 0.2, maxRetries: 1, requestTimeoutMs: 8_000 };
    expect(parseAIGenerationDefaults(stored)).toEqual(stored);
  });

  it("backfills a missing field from defaults while preserving stored values", () => {
    const result = parseAIGenerationDefaults({ maxTokens: 8192, temperature: 0.3, frequencyPenalty: 0.5, maxRetries: 2 });
    expect(result.requestTimeoutMs).toBe(AI_GENERATION_DEFAULTS.requestTimeoutMs); // 15_000
    expect(result.maxTokens).toBe(8192);
  });

  it("falls back to safe defaults for a present-but-invalid field (the outage shape)", () => {
    for (const bad of [null, Number.NaN, "15000", 500, 25_000, -1]) {
      const result = parseAIGenerationDefaults({
        maxTokens: 8192,
        temperature: 0.3,
        frequencyPenalty: 0.5,
        maxRetries: 2,
        requestTimeoutMs: bad,
      });
      expect(result).toEqual(AI_GENERATION_DEFAULTS);
    }
  });

  it("returns full defaults for null, undefined, or a non-object blob", () => {
    for (const raw of [null, undefined, [], "nope", 42]) {
      expect(parseAIGenerationDefaults(raw)).toEqual(AI_GENERATION_DEFAULTS);
    }
  });

  it("always yields a finite, in-range requestTimeoutMs", () => {
    for (const raw of [null, {}, { requestTimeoutMs: Number.NaN }, { requestTimeoutMs: Number.POSITIVE_INFINITY }]) {
      const { requestTimeoutMs } = parseAIGenerationDefaults(raw);
      expect(Number.isFinite(requestTimeoutMs)).toBe(true);
      expect(requestTimeoutMs).toBeGreaterThanOrEqual(1_000);
      expect(requestTimeoutMs).toBeLessThanOrEqual(20_000);
    }
  });
});
