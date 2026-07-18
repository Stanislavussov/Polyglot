import { AITimeoutError, resetBreakerRegistry } from "@polyglot/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRetriableProviderError, retriableReason, setAIFallbackObserver, withModelFailover } from "../failover.js";

describe("retriableReason", () => {
  it("classifies the adapter's own AITimeoutError as timeout", () => {
    expect(retriableReason(new AITimeoutError(10_000))).toBe("timeout");
  });

  it("classifies a 429 status as rate_limit", () => {
    expect(retriableReason({ statusCode: 429 })).toBe("rate_limit");
  });

  it("classifies 5xx / 408 statuses as server_error / timeout", () => {
    expect(retriableReason({ statusCode: 500 })).toBe("server_error");
    expect(retriableReason({ statusCode: 502 })).toBe("server_error");
    expect(retriableReason({ statusCode: 503 })).toBe("server_error");
    expect(retriableReason({ statusCode: 504 })).toBe("server_error");
    expect(retriableReason({ statusCode: 408 })).toBe("timeout");
  });

  it("classifies AbortError / TimeoutError by name as timeout", () => {
    const abort = new Error("The operation was aborted");
    abort.name = "AbortError";
    expect(retriableReason(abort)).toBe("timeout");
    const timeoutErr = new Error("timed out");
    timeoutErr.name = "TimeoutError";
    expect(retriableReason(timeoutErr)).toBe("timeout");
  });

  it("classifies transient messages by content (rate limit / server / network)", () => {
    expect(retriableReason(new Error("Provider returned 429 Too Many Requests"))).toBe("rate_limit");
    expect(retriableReason(new Error("503 service unavailable"))).toBe("server_error");
    expect(retriableReason(new Error("fetch failed"))).toBe("network");
    expect(retriableReason(new Error("socket hang up"))).toBe("network");
  });

  it("returns null for client errors and validation failures (never masked)", () => {
    expect(retriableReason({ statusCode: 400 })).toBeNull();
    expect(retriableReason({ statusCode: 401 })).toBeNull();
    expect(retriableReason({ statusCode: 404 })).toBeNull();
    expect(retriableReason(new Error("schema validation failed at field topic"))).toBeNull();
    expect(retriableReason(null)).toBeNull();
    expect(isRetriableProviderError({ statusCode: 404 })).toBe(false);
  });
});

describe("withModelFailover", () => {
  const observer = vi.fn();
  const config = {
    primaryModel: "primary/model",
    fallbackModel: "fallback/model",
    primaryBudgetMs: 10_000,
    reservedFallbackMs: 5_000,
  };

  beforeEach(() => {
    // The Phase 3 breaker gate is default-ON and its registry is a process-wide
    // singleton, so reset it between cases to keep these Phase 2 specs isolated.
    resetBreakerRegistry();
    observer.mockClear();
    setAIFallbackObserver(observer);
  });

  afterEach(() => {
    setAIFallbackObserver(null);
    resetBreakerRegistry();
  });

  it("runs the primary once with primaryBudgetMs and never falls back on success", async () => {
    const call = vi.fn().mockResolvedValue("primary-reply");

    const result = await withModelFailover(config, call);

    expect(result).toBe("primary-reply");
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith("primary/model", { budgetMs: 10_000 });
    expect(observer).not.toHaveBeenCalled();
  });

  it("fast-path: an instant 429 on the primary triggers the fallback and counts the metric", async () => {
    const call = vi.fn().mockRejectedValueOnce({ statusCode: 429 }).mockResolvedValueOnce("fallback-reply");

    const result = await withModelFailover(config, call);

    expect(result).toBe("fallback-reply");
    expect(call).toHaveBeenNthCalledWith(1, "primary/model", { budgetMs: 10_000 });
    // Budget injection (N1a): the fallback attempt is bounded by the reserved window.
    expect(call).toHaveBeenNthCalledWith(2, "fallback/model", { budgetMs: 5_000 });
    expect(observer).toHaveBeenCalledTimes(1);
    expect(observer).toHaveBeenCalledWith({
      fromModel: "primary/model",
      toModel: "fallback/model",
      reason: "rate_limit",
    });
  });

  it("N2 dedup: identical primary/fallback runs once, no fallback attempt, no metric", async () => {
    const call = vi.fn().mockRejectedValue({ statusCode: 429 });
    const dedupConfig = { ...config, fallbackModel: config.primaryModel };

    await expect(withModelFailover(dedupConfig, call)).rejects.toEqual({ statusCode: 429 });

    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith("primary/model", { budgetMs: 10_000 });
    expect(observer).not.toHaveBeenCalled();
  });

  it("anti-masking: a non-retriable 4xx is rethrown with no fallback", async () => {
    const err = { statusCode: 400 };
    const call = vi.fn().mockRejectedValue(err);

    await expect(withModelFailover(config, call)).rejects.toBe(err);

    expect(call).toHaveBeenCalledTimes(1);
    expect(observer).not.toHaveBeenCalled();
  });
});
