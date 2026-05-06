/**
 * Tests for notification scheduler — cron-based, timezone-aware delivery.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationUser, ReEngagementSendFn, SchedulerDeps, SendFn, SuggestedWord } from "./types.js";

// ─────────────────────────────────────────────
// Mock logger (hoisted to avoid TDZ issues)
// ─────────────────────────────────────────────

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("@polyglot/core", () => ({
  getLogger: vi.fn(() => mockLogger),
}));

// Mock node-cron
const { mockSchedule, mockStop } = vi.hoisted(() => ({
  mockSchedule: vi.fn(),
  mockStop: vi.fn(),
}));

vi.mock("node-cron", () => ({
  default: {
    schedule: mockSchedule.mockReturnValue({ stop: mockStop }),
  },
}));

import {
  buildNotificationPayload,
  checkAndSend,
  processInactiveUsers,
  startScheduler,
  stopScheduler,
} from "./scheduler.js";

// ─────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────

const mockUser: NotificationUser = {
  userId: 1,
  telegramId: 12345,
  interfaceLang: "en",
  nativeLang: "en",
  learningLangs: ["cs", "de"],
  timezone: "Europe/Prague",
  notificationTime: "8",
  notificationType: "both",
};

const mockUser2: NotificationUser = {
  userId: 2,
  telegramId: 67890,
  interfaceLang: "ru",
  nativeLang: "ru",
  learningLangs: ["en"],
  timezone: "America/New_York",
  notificationTime: "20",
  notificationType: "suggested",
};

const mockSuggestedWord: SuggestedWord = {
  original: "apple",
  emoji: "🍕",
  translations: { cs: "jablko", de: "Apfel" },
  source: "suggested",
};

const mockDictWord: SuggestedWord = {
  original: "house",
  emoji: "🏠",
  translations: { cs: "dům", de: "Haus" },
  source: "srs",
};

const mockT = vi.fn((key: string, _lang: string, _params?: Record<string, string>) => {
  const keys: Record<string, string> = {
    notifTitle: "Word of the day",
    notifWordFromDict: "From your dictionary",
    notifAiSuggested: "AI suggestion",
    notifPaused: "We paused your notifications. Use /settings to re-enable.",
  };
  return keys[key] ?? key;
});

function buildSchedulerDeps(overrides: Partial<SchedulerDeps> = {}): SchedulerDeps {
  return {
    getUsersForWindow: vi.fn().mockResolvedValue([mockUser]),
    getInactiveUsers: vi.fn().mockResolvedValue([]),
    disableNotifications: vi.fn().mockResolvedValue(undefined),
    pickSuggestedWord: vi.fn().mockResolvedValue(mockSuggestedWord),
    pickDictionaryWord: vi.fn().mockResolvedValue(mockDictWord),
    t: mockT,
    ...overrides,
  };
}

// ─────────────────────────────────────────────
// Tests: buildNotificationPayload
// ─────────────────────────────────────────────

describe("buildNotificationPayload", () => {
  it("builds a payload with user's preferred hour", () => {
    const payload = buildNotificationPayload(mockUser, mockSuggestedWord, mockT);

    expect(payload.hour).toBe(8);
    expect(payload.word).toBe(mockSuggestedWord);
    expect(payload.message).toContain("🍕");
    expect(payload.message).toContain("<b>apple</b>");
    expect(payload.message).toContain("AI suggestion");
    expect(payload.message).toContain("jablko");
    expect(payload.message).toContain("Apfel");
  });

  it("builds a payload with custom hour (20:00)", () => {
    const eveningUser = { ...mockUser, notificationTime: "20" };
    const payload = buildNotificationPayload(eveningUser, mockDictWord, mockT);

    expect(payload.hour).toBe(20);
    expect(payload.message).toContain("From your dictionary");
  });

  it("defaults to hour 8 for invalid notificationTime", () => {
    const badUser = { ...mockUser, notificationTime: "invalid" };
    const payload = buildNotificationPayload(badUser, mockSuggestedWord, mockT);

    expect(payload.hour).toBe(8);
  });

  it("uses user's interface language for i18n", () => {
    buildNotificationPayload(mockUser, mockSuggestedWord, mockT);

    expect(mockT).toHaveBeenCalledWith("notifTitle", "en");
    expect(mockT).toHaveBeenCalledWith("notifAiSuggested", "en");
  });

  it("uses notifWordFromDict label for srs source", () => {
    const payload = buildNotificationPayload(mockUser, mockDictWord, mockT);

    expect(payload.message).toContain("From your dictionary");
  });
});

// ─────────────────────────────────────────────
// Tests: checkAndSend
// ─────────────────────────────────────────────

describe("checkAndSend", () => {
  let mockSendFn: SendFn;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSendFn = vi.fn().mockResolvedValue(undefined);
  });

  it("sends notifications to eligible users", async () => {
    const deps = buildSchedulerDeps();
    const result = await checkAndSend(mockSendFn, deps);

    expect(mockSendFn).toHaveBeenCalledOnce();
    expect(mockSendFn).toHaveBeenCalledWith(12345, expect.objectContaining({ hour: 8 }));
    expect(result.sent).toBe(1);
    expect(result.errors).toBe(0);
  });

  it("handles multiple users", async () => {
    const deps = buildSchedulerDeps({
      getUsersForWindow: vi.fn().mockResolvedValue([mockUser, mockUser2]),
    });
    const result = await checkAndSend(mockSendFn, deps);

    expect(mockSendFn).toHaveBeenCalledTimes(2);
    expect(result.sent).toBe(2);
  });

  it("returns zero sent when no users are eligible", async () => {
    const deps = buildSchedulerDeps({
      getUsersForWindow: vi.fn().mockResolvedValue([]),
    });
    const result = await checkAndSend(mockSendFn, deps);

    expect(mockSendFn).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
    expect(result.errors).toBe(0);
  });

  it("logs and continues on send error", async () => {
    const failSend = vi.fn().mockRejectedValue(new Error("Telegram API error"));
    const deps = buildSchedulerDeps({
      getUsersForWindow: vi.fn().mockResolvedValue([mockUser, mockUser2]),
    });

    const result = await checkAndSend(failSend, deps);

    expect(result.errors).toBe(2);
    expect(result.sent).toBe(0);
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it("skips user when no word could be picked", async () => {
    const deps = buildSchedulerDeps({
      pickSuggestedWord: vi.fn().mockResolvedValue(null),
      pickDictionaryWord: vi.fn().mockResolvedValue(null),
    });

    const result = await checkAndSend(mockSendFn, deps);

    expect(mockSendFn).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1 }),
      expect.stringContaining("Could not pick a word"),
    );
  });

  it("returns error when getUsersForWindow throws", async () => {
    const deps = buildSchedulerDeps({
      getUsersForWindow: vi.fn().mockRejectedValue(new Error("DB down")),
    });

    const result = await checkAndSend(mockSendFn, deps);

    expect(result.errors).toBe(1);
    expect(result.sent).toBe(0);
  });

  describe("word picking strategy", () => {
    it("uses pickSuggestedWord for 'suggested' type users", async () => {
      const suggestedUser = { ...mockUser, notificationType: "suggested" };
      const deps = buildSchedulerDeps({
        getUsersForWindow: vi.fn().mockResolvedValue([suggestedUser]),
      });

      await checkAndSend(mockSendFn, deps);

      expect(deps.pickSuggestedWord).toHaveBeenCalledWith(1);
      expect(deps.pickDictionaryWord).not.toHaveBeenCalled();
    });

    it("uses pickDictionaryWord for 'srs' type users", async () => {
      const srsUser = { ...mockUser, notificationType: "srs" };
      const deps = buildSchedulerDeps({
        getUsersForWindow: vi.fn().mockResolvedValue([srsUser]),
      });

      await checkAndSend(mockSendFn, deps);

      expect(deps.pickDictionaryWord).toHaveBeenCalledWith(1);
    });

    it("falls back to suggested when srs has no words", async () => {
      const srsUser = { ...mockUser, notificationType: "srs" };
      const deps = buildSchedulerDeps({
        getUsersForWindow: vi.fn().mockResolvedValue([srsUser]),
        pickDictionaryWord: vi.fn().mockResolvedValue(null),
      });

      await checkAndSend(mockSendFn, deps);

      expect(deps.pickDictionaryWord).toHaveBeenCalledWith(1);
      expect(deps.pickSuggestedWord).toHaveBeenCalledWith(1);
    });

    it("alternates between strategies for 'both' type", async () => {
      const bothUser = { ...mockUser, notificationType: "both" };
      const deps = buildSchedulerDeps({
        getUsersForWindow: vi.fn().mockResolvedValue([bothUser]),
      });

      // Mock random to pick SRS (< 0.5)
      vi.spyOn(Math, "random").mockReturnValue(0.3);
      await checkAndSend(mockSendFn, deps);

      expect(deps.pickDictionaryWord).toHaveBeenCalledWith(1);
    });

    it("falls back to other strategy for 'both' when primary returns null", async () => {
      const bothUser = { ...mockUser, notificationType: "both" };
      const deps = buildSchedulerDeps({
        getUsersForWindow: vi.fn().mockResolvedValue([bothUser]),
        pickDictionaryWord: vi.fn().mockResolvedValue(null),
      });

      // Mock random to pick SRS first (< 0.5), but it returns null → falls back to suggested
      vi.spyOn(Math, "random").mockReturnValue(0.3);
      await checkAndSend(mockSendFn, deps);

      expect(deps.pickDictionaryWord).toHaveBeenCalled();
      expect(deps.pickSuggestedWord).toHaveBeenCalled();
      expect(mockSendFn).toHaveBeenCalled();
    });
  });
});

// ─────────────────────────────────────────────
// Tests: processInactiveUsers
// ─────────────────────────────────────────────

describe("processInactiveUsers", () => {
  let mockReEngagementSend: ReEngagementSendFn;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReEngagementSend = vi.fn().mockResolvedValue(undefined);
  });

  it("sends re-engagement message and disables notifications", async () => {
    const deps = buildSchedulerDeps({
      getInactiveUsers: vi.fn().mockResolvedValue([mockUser]),
    });

    const result = await processInactiveUsers(mockReEngagementSend, deps);

    expect(mockReEngagementSend).toHaveBeenCalledWith(
      12345,
      "We paused your notifications. Use /settings to re-enable.",
    );
    expect(deps.disableNotifications).toHaveBeenCalledWith(1);
    expect(result.processed).toBe(1);
    expect(result.errors).toBe(0);
  });

  it("processes multiple inactive users", async () => {
    const deps = buildSchedulerDeps({
      getInactiveUsers: vi.fn().mockResolvedValue([mockUser, mockUser2]),
    });

    const result = await processInactiveUsers(mockReEngagementSend, deps);

    expect(mockReEngagementSend).toHaveBeenCalledTimes(2);
    expect(deps.disableNotifications).toHaveBeenCalledTimes(2);
    expect(result.processed).toBe(2);
  });

  it("returns zero when no inactive users", async () => {
    const deps = buildSchedulerDeps();
    const result = await processInactiveUsers(mockReEngagementSend, deps);

    expect(mockReEngagementSend).not.toHaveBeenCalled();
    expect(result.processed).toBe(0);
  });

  it("logs and continues on send error", async () => {
    const failSend = vi.fn().mockRejectedValue(new Error("Telegram error"));
    const deps = buildSchedulerDeps({
      getInactiveUsers: vi.fn().mockResolvedValue([mockUser]),
    });

    const result = await processInactiveUsers(failSend, deps);

    expect(result.errors).toBe(1);
    expect(result.processed).toBe(0);
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it("returns error when getInactiveUsers throws", async () => {
    const deps = buildSchedulerDeps({
      getInactiveUsers: vi.fn().mockRejectedValue(new Error("DB error")),
    });

    const result = await processInactiveUsers(mockReEngagementSend, deps);

    expect(result.errors).toBe(1);
    expect(result.processed).toBe(0);
  });

  it("uses user interface language for re-engagement message", async () => {
    const deps = buildSchedulerDeps({
      getInactiveUsers: vi.fn().mockResolvedValue([mockUser2]),
    });

    await processInactiveUsers(mockReEngagementSend, deps);

    expect(mockT).toHaveBeenCalledWith("notifPaused", "ru");
  });
});

// ─────────────────────────────────────────────
// Tests: startScheduler / stopScheduler
// ─────────────────────────────────────────────

describe("startScheduler / stopScheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset internal state by stopping any existing scheduler
    stopScheduler();
  });

  afterEach(() => {
    stopScheduler();
  });

  it("registers a cron job with hourly schedule", () => {
    const sendFn = vi.fn();
    const reEngagementSendFn = vi.fn();
    const deps = buildSchedulerDeps();

    startScheduler(sendFn, reEngagementSendFn, deps);

    expect(mockSchedule).toHaveBeenCalledWith("0 * * * *", expect.any(Function));
  });

  it("does not register duplicate cron jobs", () => {
    const sendFn = vi.fn();
    const reEngagementSendFn = vi.fn();
    const deps = buildSchedulerDeps();

    startScheduler(sendFn, reEngagementSendFn, deps);
    startScheduler(sendFn, reEngagementSendFn, deps);

    // First call creates the cron, second is ignored
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("already running"),
    );
  });

  it("stopScheduler stops the cron task", () => {
    const sendFn = vi.fn();
    const reEngagementSendFn = vi.fn();
    const deps = buildSchedulerDeps();

    startScheduler(sendFn, reEngagementSendFn, deps);
    stopScheduler();

    expect(mockStop).toHaveBeenCalledOnce();
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.anything(),
      "Notification scheduler stopped",
    );
  });

  it("stopScheduler is safe to call when not running", () => {
    expect(() => stopScheduler()).not.toThrow();
  });
});
