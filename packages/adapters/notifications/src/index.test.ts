import { setLogger } from "@polyglot/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logNotificationSent } from "./index.js";

/**
 * The notification log goes through core's structured event stream, so the
 * logger is installed via `setLogger` — the same seam the composition root
 * uses — rather than by mocking the module. That keeps these tests honest about
 * the record a Grafana query would actually see.
 */
const mockInfo = vi.fn();
const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

beforeEach(() => {
  mockInfo.mockClear();
  setLogger({ info: mockInfo, warn: vi.fn(), error: vi.fn(), debug: vi.fn() });
});

afterEach(() => {
  setLogger(silent);
});

describe("logNotificationSent", () => {
  it("emits a notification.sent event carrying userId, type and wordId", () => {
    logNotificationSent({ userId: 42, type: "suggested", wordId: 7 });

    expect(mockInfo).toHaveBeenCalledOnce();
    const [data, msg] = mockInfo.mock.calls[0];
    expect(msg).toBe("notification.sent");
    expect(data).toMatchObject({ event: "notification.sent", userId: 42, type: "suggested", wordId: 7 });
  });

  it("does not throw on multiple calls", () => {
    expect(() => {
      logNotificationSent({ userId: 1, type: "suggested", wordId: 1 });
      logNotificationSent({ userId: 2, type: "suggested", wordId: 2 });
      logNotificationSent({ userId: 3, type: "suggested", wordId: 3 });
    }).not.toThrow();

    expect(mockInfo).toHaveBeenCalledTimes(3);
  });

  it("handles large userId and wordId values", () => {
    logNotificationSent({ userId: 999999999, type: "suggested", wordId: 2147483647 });

    const [data] = mockInfo.mock.calls[0];
    expect(data.userId).toBe(999999999);
    expect(data.wordId).toBe(2147483647);
  });

  // ─────────────────────────────────────────────
  // BUG-07: SRS notification type support
  // ─────────────────────────────────────────────

  it("accepts 'srs' notification type (BUG-07)", () => {
    logNotificationSent({ userId: 10, type: "srs", wordId: 42 });

    expect(mockInfo).toHaveBeenCalledOnce();
    const [data] = mockInfo.mock.calls[0];
    expect(data).toMatchObject({ type: "srs", userId: 10, wordId: 42 });
  });

  it("distinguishes 'suggested' from 'srs' across consecutive sends", () => {
    logNotificationSent({ userId: 1, type: "suggested", wordId: 100 });
    logNotificationSent({ userId: 2, type: "srs", wordId: 200 });

    expect(mockInfo).toHaveBeenCalledTimes(2);
    expect(mockInfo.mock.calls[0][0].type).toBe("suggested");
    expect(mockInfo.mock.calls[1][0].type).toBe("srs");
  });
});
