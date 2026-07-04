import { AITimeoutError } from "@polyglot/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// Mock dependencies
const mockLogRequest = vi.fn();
vi.mock("../logger.js", () => ({
  logRequest: (...args: unknown[]) => mockLogRequest(...args),
}));

const mockModelInstance = { modelId: "openai/gpt-4o" };
vi.mock("../client.js", () => ({
  getModel: vi.fn(() => mockModelInstance),
}));

const mockAiGenerateObject = vi.fn();
const mockAiGenerateText = vi.fn();
vi.mock("ai", () => ({
  generateObject: (...args: unknown[]) => mockAiGenerateObject(...args),
  generateText: (...args: unknown[]) => mockAiGenerateText(...args),
}));

import { generateObject, generateText, setAIRequestTimeoutProvider } from "../index.js";

describe("generateObject", () => {
  const schema = z.object({ text: z.string() });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the parsed object from AI SDK", async () => {
    mockAiGenerateObject.mockResolvedValueOnce({
      object: { text: "hello" },
      usage: { inputTokens: 50, outputTokens: 20 },
    });

    const result = await generateObject("translate hello", schema, "openai/gpt-4o");
    expect(result).toEqual({ text: "hello" });
  });

  it("passes model, schema, prompt, and maxRetries to AI SDK", async () => {
    mockAiGenerateObject.mockResolvedValueOnce({
      object: { text: "hello" },
      usage: { inputTokens: 50, outputTokens: 20 },
    });

    await generateObject("test prompt", schema, "openai/gpt-4o", { maxRetries: 5, frequencyPenalty: 0 });

    expect(mockAiGenerateObject).toHaveBeenCalledWith({
      model: mockModelInstance,
      schema,
      prompt: "test prompt",
      maxRetries: 5,
      maxTokens: 4096,
      temperature: 0.3,
      frequencyPenalty: 0,
      abortSignal: expect.any(AbortSignal),
    });
  });

  it("uses default maxRetries of 2", async () => {
    mockAiGenerateObject.mockResolvedValueOnce({
      object: { text: "hello" },
      usage: { inputTokens: 50, outputTokens: 20 },
    });

    await generateObject("test prompt", schema, "openai/gpt-4o");

    expect(mockAiGenerateObject).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 2 }));
  });

  it("logs successful request", async () => {
    mockAiGenerateObject.mockResolvedValueOnce({
      object: { text: "hello" },
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    await generateObject("test", schema, "openai/gpt-4o");

    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai/gpt-4o",
        tokens: { input: 100, output: 50 },
        success: true,
      }),
    );
  });

  it("logs failed request and re-throws error", async () => {
    const error = new Error("API Error");
    mockAiGenerateObject.mockRejectedValueOnce(error);

    await expect(generateObject("test", schema, "openai/gpt-4o")).rejects.toThrow("API Error");

    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai/gpt-4o",
        tokens: { input: 0, output: 0 },
        cost_usd: 0,
        success: false,
        error: "API Error",
      }),
    );
  });

  it("handles missing usage data gracefully", async () => {
    mockAiGenerateObject.mockResolvedValueOnce({
      object: { text: "hello" },
      usage: { inputTokens: undefined, outputTokens: undefined },
    });

    const result = await generateObject("test", schema, "openai/gpt-4o");
    expect(result).toEqual({ text: "hello" });

    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        tokens: { input: 0, output: 0 },
        cost_usd: 0,
      }),
    );
  });

  it("threads userId through to logRequest on success", async () => {
    mockAiGenerateObject.mockResolvedValueOnce({
      object: { text: "hello" },
      usage: { inputTokens: 50, outputTokens: 20 },
    });

    await generateObject("test", schema, "openai/gpt-4o", { userId: 42 });

    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 42,
        success: true,
      }),
    );
  });

  it("threads userId through to logRequest on failure", async () => {
    mockAiGenerateObject.mockRejectedValueOnce(new Error("fail"));

    await expect(generateObject("test", schema, "openai/gpt-4o", { userId: 42 })).rejects.toThrow("fail");

    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 42,
        success: false,
      }),
    );
  });

  it("passes undefined userId when not provided", async () => {
    mockAiGenerateObject.mockResolvedValueOnce({
      object: { text: "hello" },
      usage: { inputTokens: 50, outputTokens: 20 },
    });

    await generateObject("test", schema, "openai/gpt-4o");

    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: undefined,
      }),
    );
  });
});

describe("generateText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the generated text from AI SDK", async () => {
    mockAiGenerateText.mockResolvedValueOnce({
      text: "Hello world",
      usage: { inputTokens: 30, outputTokens: 10 },
    });

    const result = await generateText("say hello", "openai/gpt-4o");
    expect(result).toBe("Hello world");
  });

  it("passes model, prompt, and maxRetries to AI SDK", async () => {
    mockAiGenerateText.mockResolvedValueOnce({
      text: "result",
      usage: { inputTokens: 30, outputTokens: 10 },
    });

    await generateText("test prompt", "openai/gpt-4o", { maxRetries: 3 });

    expect(mockAiGenerateText).toHaveBeenCalledWith({
      model: mockModelInstance,
      prompt: "test prompt",
      maxRetries: 3,
      abortSignal: expect.any(AbortSignal),
    });
  });

  it("uses default maxRetries of 2", async () => {
    mockAiGenerateText.mockResolvedValueOnce({
      text: "result",
      usage: { inputTokens: 30, outputTokens: 10 },
    });

    await generateText("test prompt", "openai/gpt-4o");

    expect(mockAiGenerateText).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 2 }));
  });

  it("logs successful request", async () => {
    mockAiGenerateText.mockResolvedValueOnce({
      text: "result",
      usage: { inputTokens: 80, outputTokens: 40 },
    });

    await generateText("test", "openai/gpt-4o");

    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai/gpt-4o",
        tokens: { input: 80, output: 40 },
        success: true,
      }),
    );
  });

  it("logs failed request and re-throws error", async () => {
    const error = new Error("Timeout");
    mockAiGenerateText.mockRejectedValueOnce(error);

    await expect(generateText("test", "openai/gpt-4o")).rejects.toThrow("Timeout");

    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: "Timeout",
      }),
    );
  });

  it("logs duration_ms for every request", async () => {
    mockAiGenerateText.mockResolvedValueOnce({
      text: "ok",
      usage: { inputTokens: 10, outputTokens: 5 },
    });

    await generateText("test", "openai/gpt-4o");

    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        duration_ms: expect.any(Number),
      }),
    );
    const logArg = mockLogRequest.mock.calls[0][0];
    expect(logArg.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("threads userId through to logRequest on success", async () => {
    mockAiGenerateText.mockResolvedValueOnce({
      text: "result",
      usage: { inputTokens: 30, outputTokens: 10 },
    });

    await generateText("test", "openai/gpt-4o", { userId: 77 });

    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 77,
        success: true,
      }),
    );
  });

  it("threads userId through to logRequest on failure", async () => {
    mockAiGenerateText.mockRejectedValueOnce(new Error("oops"));

    await expect(generateText("test", "openai/gpt-4o", { userId: 77 })).rejects.toThrow("oops");

    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 77,
        success: false,
      }),
    );
  });
});

describe("request timeout / abort", () => {
  const schema = z.object({ text: z.string() });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    setAIRequestTimeoutProvider(null);
  });

  /** Mock that honours the abort signal like the real SDK: rejects once aborted. */
  function rejectOnAbort(opts: { abortSignal?: AbortSignal }): Promise<never> {
    return new Promise((_, reject) => {
      opts.abortSignal?.addEventListener("abort", () => reject(new Error("The operation was aborted")));
    });
  }

  it("aborts a hung generateObject at the injected budget and throws AITimeoutError", async () => {
    setAIRequestTimeoutProvider(() => 20);
    mockAiGenerateObject.mockImplementationOnce(rejectOnAbort);

    await expect(generateObject("test", schema, "openai/gpt-4o")).rejects.toBeInstanceOf(AITimeoutError);
  });

  it("aborts a hung generateText at the injected budget and throws AITimeoutError", async () => {
    setAIRequestTimeoutProvider(() => 20);
    mockAiGenerateText.mockImplementationOnce(rejectOnAbort);

    await expect(generateText("test", "openai/gpt-4o")).rejects.toBeInstanceOf(AITimeoutError);
  });

  it("resolves the budget from an async (DB-backed) provider", async () => {
    setAIRequestTimeoutProvider(async () => 20);
    mockAiGenerateObject.mockImplementationOnce(rejectOnAbort);

    await expect(generateObject("test", schema, "openai/gpt-4o")).rejects.toBeInstanceOf(AITimeoutError);
  });

  it("logs a timed-out request as a failure", async () => {
    setAIRequestTimeoutProvider(() => 20);
    mockAiGenerateObject.mockImplementationOnce(rejectOnAbort);

    await expect(generateObject("test", schema, "openai/gpt-4o")).rejects.toBeInstanceOf(AITimeoutError);

    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: "AI request timed out after 20ms",
      }),
    );
  });

  it("falls back to the default budget when the provider yields an invalid value", async () => {
    setAIRequestTimeoutProvider(() => 0);
    const original = new Error("provider 500");
    mockAiGenerateObject.mockRejectedValueOnce(original);

    // Budget falls back to 15 s (won't fire in-test); the original error passes through.
    await expect(generateObject("test", schema, "openai/gpt-4o")).rejects.toBe(original);
  });

  it("passes through a non-timeout rejection unchanged", async () => {
    setAIRequestTimeoutProvider(() => 10_000);
    const original = new Error("provider 500");
    mockAiGenerateObject.mockRejectedValueOnce(original);

    await expect(generateObject("test", schema, "openai/gpt-4o")).rejects.toBe(original);
  });
});
