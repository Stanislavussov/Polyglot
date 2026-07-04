import { describe, expect, it } from "vitest";
import { calculateCost, estimateCost, findModel, getAvailableModels } from "../models.js";

describe("models", () => {
  describe("getAvailableModels", () => {
    it("returns a non-empty array of models", () => {
      const models = getAvailableModels();
      expect(models.length).toBeGreaterThan(0);
    });

    it("each model has required fields", () => {
      const models = getAvailableModels();
      for (const m of models) {
        expect(m.id).toBeTruthy();
        expect(m.name).toBeTruthy();
        expect(m.provider).toBeTruthy();
        expect(m.maxTokens).toBeGreaterThan(0);
        expect(m.costPer1kInput).toBeGreaterThanOrEqual(0);
        expect(m.costPer1kOutput).toBeGreaterThanOrEqual(0);
      }
    });

    it("returns a copy (not mutable reference)", () => {
      const a = getAvailableModels();
      const b = getAvailableModels();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });
  });

  describe("findModel", () => {
    it("finds known model by ID", () => {
      const model = findModel("openai/gpt-4o");
      expect(model).toBeDefined();
      expect(model!.provider).toBe("openai");
    });

    it("returns undefined for unknown model", () => {
      expect(findModel("unknown/model")).toBeUndefined();
    });
  });

  describe("estimateCost", () => {
    // Signature now matches AIPort.estimateCost(inputTokens, outputTokens, modelId) (T03/C3).
    it("computes the cost by the actual model — not the default fallback price", () => {
      const model = findModel("openai/gpt-4o")!;
      const cost = estimateCost(1000, 500, "openai/gpt-4o");
      const expected = (1000 / 1000) * model.costPer1kInput + (500 / 1000) * model.costPer1kOutput;
      expect(cost).toBeCloseTo(expected);
      // The default fallback price would be (1500/1000)*0.002 = 0.003 — must differ.
      expect(cost).not.toBe((1500 / 1000) * 0.002);
    });

    it("uses the default cost only for an unknown model", () => {
      const cost = estimateCost(1000, 1000, "unknown/model");
      expect(cost).toBe((2000 / 1000) * 0.002);
    });

    it("returns 0 for 0 tokens", () => {
      expect(estimateCost(0, 0, "openai/gpt-4o")).toBe(0);
    });

    it("matches calculateCost for the same inputs", () => {
      expect(estimateCost(1234, 567, "anthropic/claude-sonnet-4-20250514")).toBe(
        calculateCost(1234, 567, "anthropic/claude-sonnet-4-20250514"),
      );
    });
  });

  describe("calculateCost", () => {
    it("calculates cost for known model with input/output split", () => {
      const model = findModel("openai/gpt-4o")!;
      const cost = calculateCost(1000, 500, "openai/gpt-4o");
      const expected = (1000 / 1000) * model.costPer1kInput + (500 / 1000) * model.costPer1kOutput;
      expect(cost).toBeCloseTo(expected);
    });

    it("uses default cost for unknown model", () => {
      const cost = calculateCost(1000, 1000, "unknown/model");
      expect(cost).toBe((2000 / 1000) * 0.002);
    });

    it("returns 0 for 0 tokens", () => {
      expect(calculateCost(0, 0, "openai/gpt-4o")).toBe(0);
    });
  });
});
