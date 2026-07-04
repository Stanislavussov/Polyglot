import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_COST_PER_1K, resolveModelCost, setAIModelPriceProvider } from "../model-price.js";

afterEach(() => {
  setAIModelPriceProvider(null);
});

describe("resolveModelCost", () => {
  it("prices a call from the injected provider's per-1k rates", async () => {
    setAIModelPriceProvider((id) =>
      id === "openai/gpt-4o" ? { costPer1kInput: 0.0025, costPer1kOutput: 0.01 } : null,
    );

    // 1000 in * 0.0025 + 500 out * 0.01/1000 = 0.0025 + 0.005 = 0.0075
    expect(await resolveModelCost(1000, 500, "openai/gpt-4o")).toBeCloseTo(0.0075, 10);
  });

  it("uses the DB price for a model the old hardcoded registry never knew (A8 regression)", async () => {
    // A model added via the admin panel — absent from any code registry.
    setAIModelPriceProvider((id) =>
      id === "vendor/brand-new-model" ? { costPer1kInput: 1, costPer1kOutput: 2 } : null,
    );

    // 1000 in * 1 + 1000 out * 2 = 1 + 2 = 3 (per 1k) → not the flat default.
    expect(await resolveModelCost(1000, 1000, "vendor/brand-new-model")).toBeCloseTo(3, 10);
  });

  it("falls back to the flat default when no provider is wired", async () => {
    expect(await resolveModelCost(1000, 1000, "any/model")).toBeCloseTo((2000 / 1000) * DEFAULT_COST_PER_1K, 10);
  });

  it("falls back to the flat default when the provider does not know the model", async () => {
    setAIModelPriceProvider(() => null);

    expect(await resolveModelCost(1000, 0, "unknown/model")).toBeCloseTo((1000 / 1000) * DEFAULT_COST_PER_1K, 10);
  });

  it("falls back to the flat default when the provider throws", async () => {
    setAIModelPriceProvider(() => {
      throw new Error("db down");
    });

    expect(await resolveModelCost(500, 500, "openai/gpt-4o")).toBeCloseTo((1000 / 1000) * DEFAULT_COST_PER_1K, 10);
  });

  it("returns zero for a zero-token call", async () => {
    setAIModelPriceProvider(() => ({ costPer1kInput: 0.5, costPer1kOutput: 0.5 }));

    expect(await resolveModelCost(0, 0, "openai/gpt-4o")).toBe(0);
  });
});
