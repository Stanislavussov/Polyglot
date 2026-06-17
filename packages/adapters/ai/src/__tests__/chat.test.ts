import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("ai", () => ({
  generateText: vi.fn(),
  generateObject: vi.fn(),
}));

vi.mock("../logger.js", () => ({
  logRequest: vi.fn(),
}));

vi.mock("../client.js", () => ({
  getModel: vi.fn().mockReturnValue("test-model"),
}));

vi.mock("../models.js", () => ({
  calculateCost: vi.fn().mockReturnValue(0.001),
  getAvailableModels: vi.fn().mockReturnValue([]),
  estimateCost: vi.fn().mockReturnValue(0.001),
}));

import { generateText as aiGenerateText } from "ai";
import { generateChat } from "../index.js";
import { logRequest } from "../logger.js";

describe("generateChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls Vercel AI SDK generateText with messages array and maxTokens", async () => {
    vi.mocked(aiGenerateText).mockResolvedValue({
      text: "What do you think it means?",
      usage: { inputTokens: 50, outputTokens: 10 },
    } as never);

    const messages = [
      { role: "system" as const, content: "You are a mentor" },
      { role: "user" as const, content: "What does 'banka' mean?" },
    ];

    const result = await generateChat(messages, "openai/gpt-4o", {
      maxTokens: 300,
      userId: 1,
    });

    expect(result).toBe("What do you think it means?");
    expect(aiGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        messages,
        maxTokens: 300,
        maxRetries: 2,
      }),
    );
  });

  it("defaults maxRetries to 2 when not specified", async () => {
    vi.mocked(aiGenerateText).mockResolvedValue({
      text: "Hi",
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    await generateChat([{ role: "user", content: "hi" }], "openai/gpt-4o");

    expect(aiGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({ maxRetries: 2 }),
    );
  });

  it("passes maxTokens through to the SDK when provided", async () => {
    vi.mocked(aiGenerateText).mockResolvedValue({
      text: "Short reply",
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    await generateChat([{ role: "user", content: "hi" }], "openai/gpt-4o", {
      maxTokens: 512,
    });

    expect(aiGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({ maxTokens: 512 }),
    );
  });

  it("omits maxTokens from SDK call when not provided", async () => {
    vi.mocked(aiGenerateText).mockResolvedValue({
      text: "Reply",
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    await generateChat([{ role: "user", content: "hi" }], "openai/gpt-4o");

    const callArgs = vi.mocked(aiGenerateText).mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs).not.toHaveProperty("maxTokens");
  });

  it("logs the request on success with requestKind 'chat'", async () => {
    vi.mocked(aiGenerateText).mockResolvedValue({
      text: "Hi",
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    await generateChat(
      [{ role: "user", content: "hi" }],
      "openai/gpt-4o",
      { userId: 42 },
    );

    expect(logRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai/gpt-4o",
        requestKind: "chat",
        success: true,
        userId: 42,
      }),
    );
  });

  it("logs the request on failure and rethrows the error", async () => {
    const error = new Error("API down");
    vi.mocked(aiGenerateText).mockRejectedValue(error);

    await expect(
      generateChat([{ role: "user", content: "hi" }], "openai/gpt-4o", { userId: 1 }),
    ).rejects.toThrow("API down");

    expect(logRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai/gpt-4o",
        requestKind: "chat",
        success: false,
        error: "API down",
        userId: 1,
      }),
    );
  });
});