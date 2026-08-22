/**
 * Tests for notification scheduler — cron-based, timezone-aware delivery.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationUser, ReEngagementSendFn, SchedulerDeps, SendFn, SuggestedWord } from "./types.js";

// ─────────────────────────────────────────────
// Mock Temporal API (for Node < 26 environments)
// ─────────────────────────────────────────────

const mockTemporalNow = { hour: 8, minute: 0 };

vi.stubGlobal("Temporal", {
  Now: {
    zonedDateTimeISO: (tz?: string) => {
      // Mirror Temporal throwing on an invalid IANA zone (used to test the payload-hour fallback).
      if (tz === "Invalid/TZ") throw new Error("invalid timezone");
      return mockTemporalNow;
    },
  },
});

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

vi.mock("@polyglot/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@polyglot/core")>()),
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
  interfaceLang: "en",
  nativeLang: "en",
  learningLangs: ["cs", "de"],
  timezone: "Europe/Prague",
  notificationEnabled: true,
  notificationTimes: ["08:00"],
  notificationType: "srs",
  notificationContext: null,
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
    notifTypeContextual: "AI + Context",
    notifContextualSentence: "Contextual sentence:",
    notifPaused: "We paused your notifications. Use /settings to re-enable.",
  };
  return keys[key] ?? key;
});

function buildSchedulerDeps(overrides: Partial<SchedulerDeps> = {}): SchedulerDeps {
  return {
    getUsersForWindow: vi.fn().mockResolvedValue([mockUser]),
    getInactiveUsers: vi.fn().mockResolvedValue([]),
    disableNotifications: vi.fn().mockResolvedValue(undefined),
    getSentWordsSince: vi.fn().mockResolvedValue([]),
    getLastSentWord: vi.fn().mockResolvedValue(null),
    recordSentWord: vi.fn().mockResolvedValue(undefined),
    pickDictionaryWord: vi.fn().mockResolvedValue(mockDictWord),
    pickPresetWord: vi.fn().mockResolvedValue(null),
    pickContextualWord: vi.fn().mockResolvedValue(mockDictWord),
    sendDictionaryEmptyPrompt: vi.fn().mockResolvedValue(undefined),
    t: mockT,
    ...overrides,
  };
}

// ─────────────────────────────────────────────
// Tests: buildNotificationPayload
// ─────────────────────────────────────────────

describe("buildNotificationPayload", () => {
  it("carries the picked word through unchanged", () => {
    const payload = buildNotificationPayload(mockUser, mockDictWord);

    expect(payload.hour).toBe(8);
    // Data only. Rendering — and the language order it is rendered in — belongs
    // to the channel adapter, which derives the order from the user's settings
    // at send time. See notification.formatter.test.ts for that guarantee.
    expect(payload.word).toEqual(mockDictWord);
  });

  it("derives the hour from the current local time", () => {
    mockTemporalNow.hour = 20;
    const payload = buildNotificationPayload(mockUser, mockDictWord);

    expect(payload.hour).toBe(20);
    mockTemporalNow.hour = 8;
  });

  it("defaults to hour 8 when the timezone is invalid", () => {
    const badUser = { ...mockUser, timezone: "Invalid/TZ" };
    const payload = buildNotificationPayload(badUser, mockDictWord);

    expect(payload.hour).toBe(8);
  });
});

// ─────────────────────────────────────────────
// Tests: checkAndSend
// ─────────────────────────────────────────────

describe("layered word selection", () => {
  let mockSendFn: SendFn;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSendFn = vi.fn().mockResolvedValue(undefined);
  });

  it("prefers the user's own dictionary and never reaches for a preset", async () => {
    const deps = buildSchedulerDeps();

    await checkAndSend(mockSendFn, deps);

    expect(deps.pickPresetWord).not.toHaveBeenCalled();
    expect(mockSendFn).toHaveBeenCalledWith(1, expect.objectContaining({ word: mockDictWord }));
  });

  it("falls back to a curated preset when the dictionary has nothing to offer", async () => {
    const preset: SuggestedWord = {
      original: "Backpfeifengesicht",
      emoji: "🎯",
      translations: { ru: "лицо, просящее кирпича" },
      source: "preset",
    };
    const deps = buildSchedulerDeps({
      pickDictionaryWord: vi.fn().mockResolvedValue(null),
      pickPresetWord: vi.fn().mockResolvedValue(preset),
    });

    const result = await checkAndSend(mockSendFn, deps);

    expect(mockSendFn).toHaveBeenCalledWith(1, expect.objectContaining({ word: preset }));
    expect(deps.sendDictionaryEmptyPrompt).not.toHaveBeenCalled();
    expect(result.sent).toBe(1);
  });

  it("shows the empty-dictionary prompt only when no layer can supply a word", async () => {
    const deps = buildSchedulerDeps({
      pickDictionaryWord: vi.fn().mockResolvedValue(null),
      pickPresetWord: vi.fn().mockResolvedValue(null),
    });

    const result = await checkAndSend(mockSendFn, deps);

    expect(deps.sendDictionaryEmptyPrompt).toHaveBeenCalledWith(1, mockUser.interfaceLang);
    expect(mockSendFn).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
  });

  it("excludes the previous notification's word even after it aged out of the de-dup window", async () => {
    // A one-word dictionary would otherwise send that word every single time
    // once the rolling window rolled over.
    const deps = buildSchedulerDeps({
      getSentWordsSince: vi.fn().mockResolvedValue([]),
      getLastSentWord: vi.fn().mockResolvedValue("house"),
    });

    await checkAndSend(mockSendFn, deps);

    expect(deps.pickDictionaryWord).toHaveBeenCalledWith(1, ["house"]);
  });

  it("does not duplicate the last word when it is already inside the window", async () => {
    const deps = buildSchedulerDeps({
      getSentWordsSince: vi.fn().mockResolvedValue(["house"]),
      getLastSentWord: vi.fn().mockResolvedValue("house"),
    });

    await checkAndSend(mockSendFn, deps);

    expect(deps.pickDictionaryWord).toHaveBeenCalledWith(1, ["house"]);
  });

  it("still sends when the last-sent lookup fails, rather than dropping the notification", async () => {
    const deps = buildSchedulerDeps({
      getLastSentWord: vi.fn().mockRejectedValue(new Error("db down")),
    });

    const result = await checkAndSend(mockSendFn, deps);

    expect(result.sent).toBe(1);
  });

  it("records a preset send under its own source, so the layers stay distinguishable in history", async () => {
    const preset: SuggestedWord = {
      original: "sobremesa",
      emoji: "🎯",
      translations: { ru: "застольная беседа" },
      source: "preset",
    };
    const deps = buildSchedulerDeps({
      pickDictionaryWord: vi.fn().mockResolvedValue(null),
      pickPresetWord: vi.fn().mockResolvedValue(preset),
    });

    await checkAndSend(mockSendFn, deps);

    expect(deps.recordSentWord).toHaveBeenCalledWith(1, "sobremesa", "preset");
  });
});

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
    expect(mockSendFn).toHaveBeenCalledWith(1, expect.objectContaining({ hour: 8 }));
    expect(result.sent).toBe(1);
    expect(result.errors).toBe(0);
  });

  it("handles multiple users", async () => {
    const user2: NotificationUser = {
      ...mockUser,
      userId: 2,
      interfaceLang: "ru",
      notificationTimes: ["20:00"],
      notificationContext: null,
    };
    const deps = buildSchedulerDeps({
      getUsersForWindow: vi.fn().mockResolvedValue([mockUser, user2]),
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

  it("logs and continues on send error", { timeout: 15000 }, async () => {
    const failSend = vi.fn().mockRejectedValue(new Error("Telegram API error"));
    const user2: NotificationUser = {
      ...mockUser,
      userId: 2,
      interfaceLang: "ru",
      notificationTimes: ["20:00"],
      notificationContext: null,
    };
    const deps = buildSchedulerDeps({
      getUsersForWindow: vi.fn().mockResolvedValue([mockUser, user2]),
    });

    const result = await checkAndSend(failSend, deps);

    expect(result.errors).toBe(2);
    expect(result.sent).toBe(0);
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it("retries failed sends up to 3 times before giving up", { timeout: 15000 }, async () => {
    const failSend = vi.fn().mockRejectedValue(new Error("Telegram API error"));
    const deps = buildSchedulerDeps();

    await checkAndSend(failSend, deps);

    expect(failSend).toHaveBeenCalledTimes(3);
    expect(mockLogger.warn).toHaveBeenCalledTimes(2);
  });

  it("succeeds on retry when transient error resolves", { timeout: 15000 }, async () => {
    let callCount = 0;
    const transientFailSend = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount < 3) {
        throw new Error("Telegram API error");
      }
    });
    const deps = buildSchedulerDeps();

    const result = await checkAndSend(transientFailSend, deps);

    expect(transientFailSend).toHaveBeenCalledTimes(3);
    expect(result.sent).toBe(1);
    expect(result.errors).toBe(0);
  });

  it("disables notifications for a user who blocked the bot (403), without retrying", async () => {
    const blockedError = new Error("Forbidden: bot was blocked by the user");
    const failSend = vi.fn().mockRejectedValue(blockedError);
    const deps = buildSchedulerDeps({
      isUserBlocked: (err) => err === blockedError,
    });

    const result = await checkAndSend(failSend, deps);

    // A permanent 403 must not be retried...
    expect(failSend).toHaveBeenCalledTimes(1);
    // ...and the user is removed from the mailing list instead.
    expect(deps.disableNotifications).toHaveBeenCalledWith(1);
    expect(result.errors).toBe(1);
    expect(result.sent).toBe(0);
  });

  it("sends empty dictionary prompt when no word could be picked", async () => {
    const deps = buildSchedulerDeps({
      pickDictionaryWord: vi.fn().mockResolvedValue(null),
    });

    const result = await checkAndSend(mockSendFn, deps);

    expect(mockSendFn).not.toHaveBeenCalled();
    expect(deps.sendDictionaryEmptyPrompt).toHaveBeenCalledWith(1, "en");
    expect(result.sent).toBe(0);
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
    it("uses pickDictionaryWord for all users", async () => {
      const deps = buildSchedulerDeps();

      await checkAndSend(mockSendFn, deps);

      expect(deps.pickDictionaryWord).toHaveBeenCalledWith(1, []);
    });

    it("passes words sent in the last 24h to the dictionary picker for de-dup", async () => {
      const deps = buildSchedulerDeps({
        getSentWordsSince: vi.fn().mockResolvedValue(["house", "car"]),
      });

      await checkAndSend(mockSendFn, deps);

      expect(deps.getSentWordsSince).toHaveBeenCalledWith(1, expect.any(Date));
      expect(deps.pickDictionaryWord).toHaveBeenCalledWith(1, ["house", "car"]);
    });

    // A19 — the type→picker registry routes each notification type without a switch.
    it("routes a contextual user to the contextual picker", async () => {
      const contextualUser: NotificationUser = {
        ...mockUser,
        notificationType: "contextual",
        notificationContext: "travel",
      };
      const deps = buildSchedulerDeps({
        getUsersForWindow: vi.fn().mockResolvedValue([contextualUser]),
      });

      await checkAndSend(mockSendFn, deps);

      expect(deps.pickContextualWord).toHaveBeenCalledWith(
        1,
        "travel",
        { nativeLang: "en", learningLangs: ["cs", "de"] },
        [],
      );
      expect(deps.pickDictionaryWord).not.toHaveBeenCalled();
    });

    it("falls back to the dictionary picker for a contextual user with no context", async () => {
      const contextualUser: NotificationUser = {
        ...mockUser,
        notificationType: "contextual",
        notificationContext: null,
      };
      const deps = buildSchedulerDeps({
        getUsersForWindow: vi.fn().mockResolvedValue([contextualUser]),
      });

      await checkAndSend(mockSendFn, deps);

      expect(deps.pickDictionaryWord).toHaveBeenCalledWith(1, []);
      expect(deps.pickContextualWord).not.toHaveBeenCalled();
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

    expect(mockReEngagementSend).toHaveBeenCalledWith(1, "We paused your notifications. Use /settings to re-enable.");
    expect(deps.disableNotifications).toHaveBeenCalledWith(1);
    expect(result.processed).toBe(1);
    expect(result.errors).toBe(0);
  });

  it("processes multiple inactive users", async () => {
    const user2: NotificationUser = {
      ...mockUser,
      userId: 2,
      interfaceLang: "ru",
      notificationContext: null,
    };
    const deps = buildSchedulerDeps({
      getInactiveUsers: vi.fn().mockResolvedValue([mockUser, user2]),
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
    const ruUser: NotificationUser = {
      ...mockUser,
      userId: 2,
      interfaceLang: "ru",
      notificationContext: null,
    };
    const deps = buildSchedulerDeps({
      getInactiveUsers: vi.fn().mockResolvedValue([ruUser]),
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

    expect(mockSchedule).toHaveBeenCalledWith("*/30 * * * *", expect.any(Function));
  });

  it("does not register duplicate cron jobs", () => {
    const sendFn = vi.fn();
    const reEngagementSendFn = vi.fn();
    const deps = buildSchedulerDeps();

    startScheduler(sendFn, reEngagementSendFn, deps);
    startScheduler(sendFn, reEngagementSendFn, deps);

    // First call creates the cron, second is ignored
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.anything(), expect.stringContaining("already running"));
  });

  it("stopScheduler stops the cron task", () => {
    const sendFn = vi.fn();
    const reEngagementSendFn = vi.fn();
    const deps = buildSchedulerDeps();

    startScheduler(sendFn, reEngagementSendFn, deps);
    stopScheduler();

    expect(mockStop).toHaveBeenCalledOnce();
    expect(mockLogger.info).toHaveBeenCalledWith(expect.anything(), "Notification scheduler stopped");
  });

  it("stopScheduler is safe to call when not running", () => {
    expect(() => stopScheduler()).not.toThrow();
  });
});
