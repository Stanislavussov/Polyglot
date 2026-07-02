/**
 * Tests for the update metrics middleware: latency observability for
 * every incoming Telegram update (handling duration, delivery lag).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>("@polyglot/core");
  return {
    ...actual,
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
  };
});

import { logger } from "@polyglot/core";
import type { Counter, Histogram } from "prom-client";
import { telegramMessagesCounter, updateDeliveryLag, updateHandlingDuration } from "../metrics.js";
import { updateMetricsMiddleware } from "./update-metrics.js";

type LabelFilter = Record<string, string>;
type MetricSample = { metricName?: string; labels: Partial<Record<string, string | number>>; value: number };

async function metricValue(
  metric: Histogram<string> | Counter<string>,
  suffix: string,
  labels: LabelFilter = {},
): Promise<number> {
  const { values } = await metric.get();
  const match = (values as MetricSample[]).find(
    (v) =>
      (v.metricName === undefined || v.metricName.endsWith(suffix)) &&
      Object.entries(labels).every(([key, value]) => v.labels[key] === value),
  );
  return match?.value ?? 0;
}

function makeCtx(update: Record<string, unknown>): never {
  return { update: { update_id: 7 }, ...update } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  updateHandlingDuration.reset();
  updateDeliveryLag.reset();
  telegramMessagesCounter.reset();
});

describe("updateMetricsMiddleware", () => {
  it("records handling duration and delivery lag for a text message update", async () => {
    const ctx = makeCtx({ message: { date: Math.floor(Date.now() / 1000) - 5, text: "hello" } });
    const next = vi.fn().mockResolvedValue(undefined);

    await updateMetricsMiddleware(ctx, next);

    expect(next).toHaveBeenCalledOnce();
    expect(await metricValue(updateHandlingDuration, "_count", { update_type: "message" })).toBe(1);
    expect(await metricValue(telegramMessagesCounter, "_total", { type: "message" })).toBe(1);
    const lagSum = await metricValue(updateDeliveryLag, "_sum");
    expect(lagSum).toBeGreaterThanOrEqual(4);
    expect(lagSum).toBeLessThan(8);
  });

  it("records a callback tap without delivery lag (Telegram does not timestamp taps)", async () => {
    const ctx = makeCtx({ callbackQuery: { data: "notif:reveal:42" } });

    await updateMetricsMiddleware(ctx, vi.fn().mockResolvedValue(undefined));

    expect(await metricValue(updateHandlingDuration, "_count", { update_type: "callback" })).toBe(1);
    expect(await metricValue(updateDeliveryLag, "_count")).toBe(0);
  });

  it("classifies updates that are neither message nor callback as other", async () => {
    const ctx = makeCtx({});

    await updateMetricsMiddleware(ctx, vi.fn().mockResolvedValue(undefined));

    expect(await metricValue(updateHandlingDuration, "_count", { update_type: "other" })).toBe(1);
  });

  it("re-throws handler failures while still recording the duration", async () => {
    const ctx = makeCtx({ message: { date: Math.floor(Date.now() / 1000) } });
    const next = vi.fn().mockRejectedValue(new Error("boom"));

    await expect(updateMetricsMiddleware(ctx, next)).rejects.toThrow("boom");

    expect(await metricValue(updateHandlingDuration, "_count", { update_type: "message" })).toBe(1);
  });

  it("warns about slow updates so they are visible in Loki", async () => {
    vi.useFakeTimers();
    const ctx = makeCtx({ message: { date: Math.floor(Date.now() / 1000) } });
    const next = vi.fn(async () => {
      vi.advanceTimersByTime(4000);
    });

    await updateMetricsMiddleware(ctx, next);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ updateType: "message", durationMs: 4000 }),
      "Slow update handling",
    );
  });

  it("does not warn about fast updates", async () => {
    const ctx = makeCtx({ message: { date: Math.floor(Date.now() / 1000) } });

    await updateMetricsMiddleware(ctx, vi.fn().mockResolvedValue(undefined));

    expect(logger.warn).not.toHaveBeenCalled();
  });
});
