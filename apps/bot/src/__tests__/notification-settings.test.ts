/**
 * Tests for notification settings in the settings scene.
 */
import type { UserLanguageSettings } from "@polyglot/core";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BotContext } from "../types.js";

const {
  mockLogger,
  mockUserRepository,
  mockLanguageCache,
  mockNotificationRepository,
  mockTranslationRequestRepository,
} = vi.hoisted(() => {
  const mockUR = {
    getSettings: vi.fn(),
    updateNotificationPrefs: vi.fn().mockResolvedValue({}),
    updateSettings: vi.fn().mockResolvedValue({}),
    updateNativeLang: vi.fn().mockResolvedValue({}),
    updateLearningLangs: vi.fn().mockResolvedValue({}),
    updateInterfaceLang: vi.fn().mockResolvedValue({}),
  };
  const mockLC = {
    getSupportedLangs: vi.fn(() => [{ code: "en" }, { code: "ru" }, { code: "cs" }]),
    getLangDisplay: vi.fn((code: string) => {
      const map: Record<string, string> = {
        en: "🇬🇧 English",
        ru: "🇷🇺 Русский",
        cs: "🇨🇿 Čeština",
      };
      return map[code] ?? code;
    }),
  };
  const mockNR = {
    updatePrefs: vi.fn().mockResolvedValue({}),
  };
  return {
    mockLogger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    mockUserRepository: mockUR,
    mockLanguageCache: mockLC,
    mockNotificationRepository: mockNR,
    mockTranslationRequestRepository: { getUserCreditsInWindow: vi.fn().mockResolvedValue(10) },
  };
});

vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>("@polyglot/core");
  return {
    ...actual,
    // buildSettingsText/buildNotifSubText call the real core getLangDisplay
    // directly (pure registry lookup, no ctx.services) — override it here so
    // the test doesn't depend on initLanguageRegistry having real language rows.
    getLangDisplay: mockLanguageCache.getLangDisplay,
  };
});

vi.mock("@polyglot/infra", () => ({
  logger: mockLogger,
  loadConfig: () => ({ AI_MODEL: "test-model", BOT_TOKEN: "test" }),
}));

vi.mock("../commands/commands.js", () => ({
  setUserCommands: vi.fn().mockResolvedValue(undefined),
}));

import {
  handleSetNotifTimeCallback,
  handleSetNotifTimeSelectCallback,
  handleSetNotifToggleCallback,
  handleSetNotifTypeCallback,
  handleSetNotifTypeSelectCallback,
  handleSetNotifTzCallback,
  handleSetNotifTzSelectCallback,
} from "../scenes/helpers/settings.helper.js";
import {
  buildNotifSubKeyboard,
  buildNotifSubText,
  buildSettingsKeyboard,
  buildSettingsText,
  handleSettingsCommand,
} from "../scenes/settings.scene.js";

/**
 * Typed against the real row shape rather than asserted into place, so every
 * `getSettings` stub below needs no cast and a column added to
 * `UserLanguageSettings` surfaces here as a compile error instead of letting
 * these tests keep asserting against a shape production never returns.
 */
const DEFAULT_SETTINGS: UserLanguageSettings = {
  id: 1,
  userId: 1,
  interfaceLang: "en",
  nativeLang: "en",
  learningLangs: ["cs", "ru"],
  activeMode: "translate",
  timezone: "UTC",
  lastSourceLang: null,
  notificationEnabled: false,
  notificationTimes: ["08:00"],
  notificationType: "srs",
  notificationContext: null,
  lastInteractionAt: null,
  isActive: true,
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const mockGetNotificationDefaults = vi.fn(() =>
  Promise.resolve({ defaultTime: "19:00", defaultType: "srs", inactivityDays: 14, notificationTimesLimit: 12 }),
);

/**
 * The hand-built context, typed as a real `BotContext` with the five methods the
 * assertions inspect narrowed to mocks.
 *
 * What the return annotation buys: call sites now see a `BotContext` instead of
 * `any`, so the handlers under test are type-checked against their real
 * parameter. What it does NOT buy — and this matters, because the opposite is
 * easy to assume: `as unknown as MockCtx` erases all checking of the object
 * literal itself, so a **missing** stub is still a runtime `TypeError`, not a
 * compile error. The `getNotificationDefaults` addition below had to be made by
 * hand for exactly that reason. Making the literal structurally checked means
 * building out the rest of `BotContext`, which is a larger change than this file
 * needs.
 */
type MockCtx = BotContext & {
  reply: Mock;
  editMessageText: Mock;
  editMessageReplyMarkup: Mock;
  answerCallbackQuery: Mock;
  deleteMessage: Mock;
};

function createMockCtx(callbackData?: string): MockCtx {
  return {
    user: { id: 1, subscriptionPlan: "free" },
    session: { activeMode: "translate", awaitingNotifContext: false },
    from: { id: 12345 },
    chat: { id: 12345 },
    api: {},
    services: {
      userRepository: mockUserRepository,
      languageCache: mockLanguageCache,
      notificationRepository: mockNotificationRepository,
      translationRequestRepository: mockTranslationRequestRepository,
      settings: {
        getPlanLimit: () =>
          Promise.resolve({
            name: "free",
            label: "Free",
            translationLimit: 50,
            creditCost: 1,
            isActive: true,
            isDefault: true,
          }),
        getNotificationDefaults: mockGetNotificationDefaults,
      },
    },
    callbackQuery: callbackData ? { data: callbackData, message: { message_id: 100 } } : undefined,
    reply: vi.fn().mockResolvedValue({ message_id: 200 }),
    editMessageText: vi.fn().mockResolvedValue({}),
    editMessageReplyMarkup: vi.fn().mockResolvedValue({}),
    answerCallbackQuery: vi.fn().mockResolvedValue({}),
    deleteMessage: vi.fn().mockResolvedValue({}),
  } as unknown as MockCtx;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUserRepository.getSettings.mockResolvedValue(DEFAULT_SETTINGS);
  mockTranslationRequestRepository.getUserCreditsInWindow.mockResolvedValue(10);
});

describe("buildSettingsText", () => {
  it("shows notification status line", () => {
    const text = buildSettingsText("en", ["cs"], "en", "en", false, ["08:00"], "srs");
    expect(text).toMatch(/notification/i);
  });

  it("shows enabled status with time and type", () => {
    const text = buildSettingsText("en", ["cs"], "en", "en", true, ["08:00"], "srs");
    expect(text).toContain("08:00");
    expect(text).toContain("srs");
  });
});

describe("buildSettingsKeyboard", () => {
  it("includes Manage notifications button", () => {
    const kb = buildSettingsKeyboard("en");
    const buttons = kb.inline_keyboard.flat();
    const cbData = buttons.map((b: any) => b.callback_data);
    expect(cbData).toContain("set:notif");
  });

  it("does not show individual notif buttons in main menu", () => {
    const kb = buildSettingsKeyboard("en");
    const buttons = kb.inline_keyboard.flat();
    const cbData = buttons.map((b: any) => b.callback_data);
    expect(cbData).not.toContain("set:notif:time");
    expect(cbData).not.toContain("set:notif:type");
    expect(cbData).not.toContain("set:notif:tz");
  });
});

describe("buildNotifSubText", () => {
  it("shows all notification details", () => {
    const text = buildNotifSubText("en", true, ["08:00"], "srs", "Europe/Prague", null);
    expect(text).toContain("08:00");
    expect(text).toContain("srs");
    expect(text).toContain("Europe/Prague");
  });

  it("shows multiple times as a sorted list", () => {
    const text = buildNotifSubText("en", true, ["20:00", "08:00"], "srs", "UTC", null);
    expect(text).toContain("08:00, 20:00");
  });

  it("shows context when type is contextual", () => {
    const text = buildNotifSubText("en", true, ["08:00"], "contextual", "UTC", "job interview");
    expect(text).toContain("job interview");
  });
});

describe("buildNotifSubKeyboard", () => {
  it("shows toggle and all settings when enabled", () => {
    const kb = buildNotifSubKeyboard("en", true, "srs");
    const buttons = kb.inline_keyboard.flat();
    const cbData = buttons.map((b: any) => b.callback_data);
    expect(cbData).toContain("set:notif:toggle");
    expect(cbData).toContain("set:notif:time");
    expect(cbData).toContain("set:notif:type");
    expect(cbData).toContain("set:notif:tz");
    expect(cbData).toContain("set:notif:back");
  });

  it("shows context button only when type is contextual", () => {
    const kbSrs = buildNotifSubKeyboard("en", true, "srs");
    const cbDataSrs = kbSrs.inline_keyboard.flat().map((b: any) => b.callback_data);
    expect(cbDataSrs).not.toContain("set:notif:context");

    const kbCtx = buildNotifSubKeyboard("en", true, "contextual");
    const cbDataCtx = kbCtx.inline_keyboard.flat().map((b: any) => b.callback_data);
    expect(cbDataCtx).toContain("set:notif:context");
  });

  it("hides settings buttons when disabled", () => {
    const kb = buildNotifSubKeyboard("en", false, "srs");
    const buttons = kb.inline_keyboard.flat();
    const cbData = buttons.map((b: any) => b.callback_data);
    expect(cbData).not.toContain("set:notif:time");
    expect(cbData).not.toContain("set:notif:type");
    expect(cbData).not.toContain("set:notif:tz");
  });
});

describe("handleSettingsCommand", () => {
  it("shows settings with notification status", async () => {
    const ctx = createMockCtx();
    await handleSettingsCommand(ctx);
    const text = ctx.reply.mock.calls[0][0] as string;
    expect(text).toMatch(/notification/i);
  });
});

describe("handleSetNotifToggleCallback", () => {
  it("enables notifications when currently disabled", async () => {
    const ctx = createMockCtx("set:notif:toggle");
    await handleSetNotifToggleCallback(ctx);
    expect(mockNotificationRepository.updatePrefs).toHaveBeenCalledWith(1, { notificationEnabled: true });
  });

  it("disables notifications when currently enabled", async () => {
    mockUserRepository.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, notificationEnabled: true });
    const ctx = createMockCtx("set:notif:toggle");
    await handleSetNotifToggleCallback(ctx);
    expect(mockNotificationRepository.updatePrefs).toHaveBeenCalledWith(1, { notificationEnabled: false });
  });

  it("seeds the admin default when enabling with no schedule", async () => {
    mockUserRepository.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, notificationTimes: [] });
    const ctx = createMockCtx("set:notif:toggle");

    await handleSetNotifToggleCallback(ctx);

    expect(mockNotificationRepository.updatePrefs).toHaveBeenCalledWith(1, {
      notificationEnabled: true,
      notificationTimes: ["19:00"],
    });
  });

  it("canonicalizes a malformed admin default rather than storing it verbatim", async () => {
    // getWithFallback heals *missing* keys only, so a present-but-invalid stored
    // value survives the merge and must not reach user data as written.
    mockGetNotificationDefaults.mockResolvedValueOnce({
      defaultTime: "not a time",
      defaultType: "srs",
      inactivityDays: 14,
      notificationTimesLimit: 12,
    });
    mockUserRepository.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, notificationTimes: [] });
    const ctx = createMockCtx("set:notif:toggle");

    await handleSetNotifToggleCallback(ctx);

    expect(mockNotificationRepository.updatePrefs).toHaveBeenCalledWith(1, {
      notificationEnabled: true,
      notificationTimes: ["19:00"],
    });
  });

  it("never overwrites a schedule the user already chose", async () => {
    mockUserRepository.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, notificationTimes: ["06:00"] });
    const ctx = createMockCtx("set:notif:toggle");

    await handleSetNotifToggleCallback(ctx);

    expect(mockNotificationRepository.updatePrefs).toHaveBeenCalledWith(1, { notificationEnabled: true });
    expect(mockGetNotificationDefaults).not.toHaveBeenCalled();
  });

  it("does not touch the schedule when turning notifications off", async () => {
    mockUserRepository.getSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      notificationEnabled: true,
      notificationTimes: [],
    });
    const ctx = createMockCtx("set:notif:toggle");

    await handleSetNotifToggleCallback(ctx);

    expect(mockNotificationRepository.updatePrefs).toHaveBeenCalledWith(1, { notificationEnabled: false });
    expect(mockGetNotificationDefaults).not.toHaveBeenCalled();
  });
});

describe("handleSetNotifTimeCallback", () => {
  it("shows a multi-select grid with the current time checked and a Done button", async () => {
    const ctx = createMockCtx("set:notif:time");
    await handleSetNotifTimeCallback(ctx);
    const opts = ctx.editMessageText.mock.calls[0][1];
    const buttons = opts.reply_markup.inline_keyboard.flat();
    const cbData = buttons.map((b: any) => b.callback_data);
    expect(cbData).toContain("set:notif:time:0");
    expect(cbData).toContain("set:notif:time:480");
    expect(cbData).toContain("set:notif:time:1410");
    // Done returns to the notification sub-menu
    expect(cbData).toContain("set:notif");
    // The currently-selected 08:00 (480) slot is marked with a check
    const selected = buttons.find((b: any) => b.callback_data === "set:notif:time:480");
    expect(selected.text).toContain("✅");
  });
});

describe("handleSetNotifTimeSelectCallback", () => {
  it("adds a new time to the list (toggle on)", async () => {
    const ctx = createMockCtx("set:notif:time:870");
    await handleSetNotifTimeSelectCallback(ctx);
    expect(mockNotificationRepository.updatePrefs).toHaveBeenCalledWith(1, {
      notificationTimes: ["08:00", "14:30"],
    });
  });

  it("removes an already-selected time (toggle off)", async () => {
    // Two slots, so removing one still leaves a schedule. This is where the
    // original "toggle off works" coverage lives now that emptying the list is
    // refused (the case below).
    mockUserRepository.getSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      notificationTimes: ["08:00", "20:00"],
    });
    const ctx = createMockCtx("set:notif:time:480");
    await handleSetNotifTimeSelectCallback(ctx);
    expect(mockNotificationRepository.updatePrefs).toHaveBeenCalledWith(1, { notificationTimes: ["20:00"] });
  });

  it("refuses to remove the last remaining time and does not persist", async () => {
    // An empty schedule means "not configured", so the next toggle off→on would
    // seed the admin default — a time the user never picked.
    const ctx = createMockCtx("set:notif:time:480");

    await handleSetNotifTimeSelectCallback(ctx);

    expect(mockNotificationRepository.updatePrefs).not.toHaveBeenCalled();
    // Exactly one answer, and it must be the refusal — not the "Removed 08:00"
    // toast followed by an alert Telegram would silently drop, which would tell
    // the user their slot was removed while it was in fact kept.
    expect(ctx.answerCallbackQuery).toHaveBeenCalledTimes(1);
    const answer = ctx.answerCallbackQuery.mock.calls[0][0] as { text: string; show_alert?: boolean };
    expect(answer.show_alert).toBe(true);
    expect(answer.text).not.toContain("Removed");
  });

  it("rejects adding a 13th time and does not persist", async () => {
    const twelveTimes = Array.from({ length: 12 }, (_, i) => `${String(i).padStart(2, "0")}:00`);
    mockUserRepository.getSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      notificationTimes: twelveTimes,
    });
    const ctx = createMockCtx("set:notif:time:870");
    await handleSetNotifTimeSelectCallback(ctx);
    expect(mockNotificationRepository.updatePrefs).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(expect.objectContaining({ show_alert: true }));
  });

  it("rejects invalid minute values", async () => {
    const ctx = createMockCtx("set:notif:time:1500");
    await handleSetNotifTimeSelectCallback(ctx);
    expect(mockNotificationRepository.updatePrefs).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(expect.objectContaining({ show_alert: true }));
  });
});

describe("handleSetNotifTypeCallback", () => {
  it("shows type picker with all options", async () => {
    const ctx = createMockCtx("set:notif:type");
    await handleSetNotifTypeCallback(ctx);
    const opts = ctx.editMessageText.mock.calls[0][1];
    const buttons = opts.reply_markup.inline_keyboard.flat();
    const cbData = buttons.map((b: any) => b.callback_data);
    expect(cbData).toContain("set:notif:type:suggested");
    expect(cbData).toContain("set:notif:type:srs");
    expect(cbData).toContain("set:notif:type:contextual");
    expect(cbData).toContain("set:notif:back");
  });
});

describe("handleSetNotifTypeSelectCallback", () => {
  it("updates notification type", async () => {
    const ctx = createMockCtx("set:notif:type:srs");
    await handleSetNotifTypeSelectCallback(ctx);
    expect(mockNotificationRepository.updatePrefs).toHaveBeenCalledWith(1, { notificationType: "srs" });
  });
});

describe("handleSetNotifTzCallback", () => {
  it("shows timezone picker", async () => {
    const ctx = createMockCtx("set:notif:tz");
    await handleSetNotifTzCallback(ctx);
    const opts = ctx.editMessageText.mock.calls[0][1];
    const buttons = opts.reply_markup.inline_keyboard.flat();
    const cbData = buttons.map((b: any) => b.callback_data);
    expect(cbData).toContain("set:notif:tz:UTC");
    expect(cbData).toContain("set:notif:tz:Europe/Prague");
    expect(cbData).toContain("set:notif:back");
  });
});

describe("handleSetNotifTzSelectCallback", () => {
  it("updates timezone for a valid timezone", async () => {
    const ctx = createMockCtx("set:notif:tz:Europe/Prague");
    await handleSetNotifTzSelectCallback(ctx);
    expect(mockUserRepository.updateSettings).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ timezone: "Europe/Prague" }),
    );
  });

  it("rejects invalid timezone", async () => {
    const ctx = createMockCtx("set:notif:tz:Invalid/Timezone123");
    await handleSetNotifTzSelectCallback(ctx);
    expect(mockUserRepository.updateSettings).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(expect.objectContaining({ show_alert: true }));
  });
});
