import type { AIGenerationDefaults } from "@polyglot/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_GENERATION_PARAMS,
  resolveGenerationParams,
  setAIGenerationDefaultsProvider,
} from "../generation-defaults.js";

const admin: AIGenerationDefaults = {
  maxTokens: 8192,
  temperature: 0.9,
  frequencyPenalty: 0.2,
  maxRetries: 4,
  requestTimeoutMs: 12_000,
};

afterEach(() => {
  setAIGenerationDefaultsProvider(null);
});

describe("resolveGenerationParams", () => {
  it("returns the built-in baseline when no provider is wired", async () => {
    expect(await resolveGenerationParams()).toEqual(DEFAULT_GENERATION_PARAMS);
  });

  it("uses the admin-configured knobs from the provider", async () => {
    setAIGenerationDefaultsProvider(() => admin);

    expect(await resolveGenerationParams()).toEqual({
      maxTokens: 8192,
      temperature: 0.9,
      frequencyPenalty: 0.2,
      maxRetries: 4,
    });
  });

  it("allows temperature 0 (deterministic) and maxRetries 0 (no retry)", async () => {
    setAIGenerationDefaultsProvider(() => ({ ...admin, temperature: 0, maxRetries: 0 }));

    const params = await resolveGenerationParams();
    expect(params.temperature).toBe(0);
    expect(params.maxRetries).toBe(0);
  });

  it("reverts a single invalid knob to its baseline, keeping the valid ones", async () => {
    setAIGenerationDefaultsProvider(() => ({
      ...admin,
      maxTokens: Number.NaN,
      maxRetries: -1,
      temperature: 1.1,
    }));

    const params = await resolveGenerationParams();
    expect(params.maxTokens).toBe(DEFAULT_GENERATION_PARAMS.maxTokens); // NaN → baseline
    expect(params.maxRetries).toBe(DEFAULT_GENERATION_PARAMS.maxRetries); // negative → baseline
    expect(params.temperature).toBe(1.1); // valid non-negative → kept
  });

  it("falls back to the full baseline when the provider throws", async () => {
    setAIGenerationDefaultsProvider(() => {
      throw new Error("db down");
    });

    expect(await resolveGenerationParams()).toEqual(DEFAULT_GENERATION_PARAMS);
  });
});
