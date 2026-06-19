import { describe, expect, it } from "vitest";
import type { AIModel, AIRequestLog, GenerateOptions } from "../types.js";

describe("types", () => {
  it("AIModel interface is structurally correct", () => {
    const model: AIModel = {
      id: "openai/gpt-4o",
      name: "GPT-4o",
      provider: "openai",
      maxTokens: 16_384,
      costPer1kInput: 0.0025,
      costPer1kOutput: 0.01,
    };
    expect(model.id).toBe("openai/gpt-4o");
    expect(model.provider).toBe("openai");
    expect(model.maxTokens).toBe(16_384);
  });

  it("AIRequestLog interface supports success and failure", () => {
    const successLog: AIRequestLog = {
      model: "openai/gpt-4o",
      requestKind: "object",
      tokens: { input: 100, output: 50 },
      cost_usd: 0.001,
      duration_ms: 1200,
      success: true,
    };
    expect(successLog.success).toBe(true);
    expect(successLog.error).toBeUndefined();

    const failLog: AIRequestLog = {
      model: "openai/gpt-4o",
      requestKind: "object",
      tokens: { input: 0, output: 0 },
      cost_usd: 0,
      duration_ms: 500,
      success: false,
      error: "Rate limit",
    };
    expect(failLog.success).toBe(false);
    expect(failLog.error).toBe("Rate limit");
  });

  it("GenerateOptions interface has optional maxRetries", () => {
    const opts1: GenerateOptions = {};
    expect(opts1.maxRetries).toBeUndefined();

    const opts2: GenerateOptions = { maxRetries: 5 };
    expect(opts2.maxRetries).toBe(5);
  });

  it("AIRequestLog supports optional userId", () => {
    const withUser: AIRequestLog = {
      model: "openai/gpt-4o",
      requestKind: "text",
      tokens: { input: 100, output: 50 },
      cost_usd: 0.001,
      duration_ms: 1200,
      success: true,
      userId: 42,
    };
    expect(withUser.userId).toBe(42);

    const withoutUser: AIRequestLog = {
      model: "openai/gpt-4o",
      requestKind: "object",
      tokens: { input: 100, output: 50 },
      cost_usd: 0.001,
      duration_ms: 1200,
      success: true,
    };
    expect(withoutUser.userId).toBeUndefined();
  });

  it("GenerateOptions supports optional userId", () => {
    const opts: GenerateOptions = { maxRetries: 3, userId: 123 };
    expect(opts.userId).toBe(123);

    const noUser: GenerateOptions = { maxRetries: 3 };
    expect(noUser.userId).toBeUndefined();
  });

  it("GenerateOptions supports a request-specific frequency penalty", () => {
    const opts: GenerateOptions = { frequencyPenalty: 0 };

    expect(opts.frequencyPenalty).toBe(0);
  });
});
