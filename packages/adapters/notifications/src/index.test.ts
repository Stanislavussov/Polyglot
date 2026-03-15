import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockInfo } = vi.hoisted(() => ({
  mockInfo: vi.fn(),
}));

vi.mock("@polyglot/infra", () => ({
  logger: {
    info: mockInfo,
  },
}));

import { logNotificationSent } from "./index.js";

describe("logNotificationSent", () => {
  beforeEach(() => {
    mockInfo.mockClear();
  });

  it("logs notification-sent with userId, type, and wordId", () => {
    logNotificationSent({ userId: 42, type: "suggested", wordId: 7 });

    expect(mockInfo).toHaveBeenCalledOnce();
    const [data, msg] = mockInfo.mock.calls[0];
    expect(msg).toBe("Notification sent");
    expect(data.userId).toBe(42);
    expect(data.type).toBe("suggested");
    expect(data.wordId).toBe(7);
  });

  it("passes params object directly to logger.info", () => {
    const params = { userId: 100, type: "suggested" as const, wordId: 999 };
    logNotificationSent(params);

    const [data] = mockInfo.mock.calls[0];
    expect(data).toEqual(params);
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
});
