import { beforeEach, describe, expect, it, vi } from "vitest";

// Must use vi.hoisted to avoid the TDZ issue with vi.mock hoisting
const { mockInfo, mockError, mockChild } = vi.hoisted(() => ({
  mockInfo: vi.fn(),
  mockError: vi.fn(),
  mockChild: vi.fn(() => ({
    info: mockInfo,
    error: mockError,
  })),
}));

vi.mock("@polyglot/core", () => ({
  getLogger: vi.fn(() => ({
    info: mockInfo,
    error: mockError,
    child: mockChild,
  })),
}));

import { logRequest } from "../logger.js";

describe("logger", () => {
  beforeEach(() => {
    mockInfo.mockClear();
    mockError.mockClear();
  });

  it("logs successful requests with info level", () => {
    logRequest({
      model: "openai/gpt-4o",
      tokens: { input: 100, output: 50 },
      cost_usd: 0.000525,
      duration_ms: 1200,
      success: true,
    });

    expect(mockInfo).toHaveBeenCalledOnce();
    const [data, msg] = mockInfo.mock.calls[0];
    expect(msg).toBe("AI request completed");
    expect(data.model).toBe("openai/gpt-4o");
    expect(data.inputTokens).toBe(100);
    expect(data.outputTokens).toBe(50);
    expect(data.duration_ms).toBe(1200);
    expect(data.cost_usd).toBeDefined();
  });

  it("logs failed requests with error level", () => {
    logRequest({
      model: "openai/gpt-4o",
      tokens: { input: 0, output: 0 },
      cost_usd: 0,
      duration_ms: 500,
      success: false,
      error: "Rate limit exceeded",
    });

    expect(mockError).toHaveBeenCalledOnce();
    const [data, msg] = mockError.mock.calls[0];
    expect(msg).toBe("AI request failed");
    expect(data.error).toBe("Rate limit exceeded");
    expect(data.model).toBe("openai/gpt-4o");
  });

  it("rounds cost_usd to 6 decimal places", () => {
    logRequest({
      model: "openai/gpt-4o",
      tokens: { input: 100, output: 50 },
      cost_usd: 0.00052500001,
      duration_ms: 1000,
      success: true,
    });

    const [data] = mockInfo.mock.calls[0];
    expect(data.cost_usd).toBe(0.000525);
  });

  it("does not call error logger for successful requests", () => {
    logRequest({
      model: "openai/gpt-4o",
      tokens: { input: 10, output: 5 },
      cost_usd: 0.001,
      duration_ms: 100,
      success: true,
    });

    expect(mockError).not.toHaveBeenCalled();
  });

  it("does not call info logger for failed requests", () => {
    logRequest({
      model: "openai/gpt-4o",
      tokens: { input: 0, output: 0 },
      cost_usd: 0,
      duration_ms: 100,
      success: false,
      error: "Some error",
    });

    expect(mockInfo).not.toHaveBeenCalled();
  });

  it("includes userId in log when provided", () => {
    logRequest({
      model: "openai/gpt-4o",
      tokens: { input: 100, output: 50 },
      cost_usd: 0.001,
      duration_ms: 1000,
      success: true,
      userId: 42,
    });

    const [data] = mockInfo.mock.calls[0];
    expect(data.userId).toBe(42);
  });

  it("omits userId from log when not provided", () => {
    logRequest({
      model: "openai/gpt-4o",
      tokens: { input: 100, output: 50 },
      cost_usd: 0.001,
      duration_ms: 1000,
      success: true,
    });

    const [data] = mockInfo.mock.calls[0];
    expect(data).not.toHaveProperty("userId");
  });

  it("includes userId in error log when provided", () => {
    logRequest({
      model: "openai/gpt-4o",
      tokens: { input: 0, output: 0 },
      cost_usd: 0,
      duration_ms: 500,
      success: false,
      userId: 99,
      error: "Timeout",
    });

    const [data] = mockError.mock.calls[0];
    expect(data.userId).toBe(99);
  });
});
