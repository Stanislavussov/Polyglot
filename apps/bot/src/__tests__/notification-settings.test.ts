/**
 * Tests for notification settings in the settings scene.
 * Tests the notification-related callback handlers and settings rendering.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Define mocks at top level using vi.hoisted
const { mockLogger, mockUserRepository, mockLanguageCache, mockNotificationRepository } = vi.hoisted(() => {
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
  };
});

// Mock dependencies before imports
vi.mock("@polyglot/adapter-db", () => ({
  userRepository: mockUserRepository,
  languageCache: mockLanguageCache,
  notificationRepository: mockNotificationRepository,
  getLangDisplay: mockLanguageCache.getLangDisplay,
  getSupportedLangs: mockLanguageCache.getSupportedLangs,
  NOTIFICATION_TYPES: ["suggested", "srs", "both"],
  DEFAULT_NOTIFICATION_HOUR: 8,
  MIN_NOTIFICATION_HOUR: 0,
  MAX_NOTIFICATION_HOUR: 23,
  parseNotificationHour: (v: string | null | undefined) => {
    if (v == null) return 8;
    const p = Number.parseInt(v, 10);
    if (Number.isNaN(p) || p < 0 || p > 23) return 8;
    return p;
  },
  formatNotificationHour: (h: number) => `${h.toString().padStart(2, "0")}:00`,
}));

vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>("@polyglot/core");
  return {
    ...actual,
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
import { buildSettingsKeyboard, buildSettingsText, handleSettingsCommand } from "../scenes/settings.scene.js";

const DEFAULT_SETTINGS = {
  interfaceLang: "en",
  nativeLang: "en",
  learningLangs: ["cs", "ru"],
  activeMode: "translate",
  timezone: "UTC",
  lastSourceLang: null,
  notificationEnabled: false,
  notificationTime: "8",
  notificationType: "both",
};

function createMockCtx(callbackData?: string) {
  return {
    user: { id: 1 },
    session: { activeMode: "translate" },
    from: { id: 12345 },
    chat: { id: 12345 },
    api: {},
    services: {
      userRepository: mockUserRepository,
      languageCache: mockLanguageCache,
      notificationRepository: mockNotificationRepository,
    },
    callbackQuery: callbackData ? { data: callbackData, message: { message_id: 100 } } : undefined,
    reply: vi.fn().mockResolvedValue({ message_id: 200 }),
    editMessageText: vi.fn().mockResolvedValue({}),
    editMessageReplyMarkup: vi.fn().mockResolvedValue({}),
    answerCallbackQuery: vi.fn().mockResolvedValue({}),
    deleteMessage: vi.fn().mockResolvedValue({}),
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUserRepository.getSettings.mockResolvedValue(DEFAULT_SETTINGS as any);
});

describe("buildSettingsText — notifications", () => {
  it("shows notification section with disabled state", () => {
    const text = buildSettingsText("en", ["cs"], "en", "en", false);
    expect(text).toMatch(/notification/i);
  });

  it("shows notification section with enabled state and details", () => {
    const text = buildSettingsText("en", ["cs"], "en", "en", true, "morning", "both", "Europe/Prague");
    expect(text).toMatch(/notification/i);
  });

  it("does not show time/type/timezone when disabled", () => {
    const text = buildSettingsText("en", ["cs"], "en", "en", false, "morning", "both", "UTC");
    // Should not contain notification time/type details when disabled
    expect(text).not.toMatch(/time|08:00/i);
  });
});

describe("buildSettingsKeyboard — notifications", () => {
  it("includes toggle button always", () => {
    const kb = buildSettingsKeyboard("en", false);
    const buttons = kb.inline_keyboard.flat();
    const cbData = buttons.map((b: any) => b.callback_data);
    expect(cbData).toContain("set:notif:toggle");
  });

  it("does not show time/type/tz buttons when disabled", () => {
    const kb = buildSettingsKeyboard("en", false);
    const buttons = kb.inline_keyboard.flat();
    const cbData = buttons.map((b: any) => b.callback_data);
    expect(cbData).not.toContain("set:notif:time");
    expect(cbData).not.toContain("set:notif:type");
    expect(cbData).not.toContain("set:notif:tz");
  });

  it("shows time/type/tz buttons when enabled", () => {
    const kb = buildSettingsKeyboard("en", true);
    const buttons = kb.inline_keyboard.flat();
    const cbData = buttons.map((b: any) => b.callback_data);
    expect(cbData).toContain("set:notif:time");
    expect(cbData).toContain("set:notif:type");
    expect(cbData).toContain("set:notif:tz");
  });
});

describe("handleSettingsCommand — notifications", () => {
  it("shows notification section in settings", async () => {
    const ctx = createMockCtx();

    await handleSettingsCommand(ctx);

    const text = ctx.reply.mock.calls[0][0] as string;
    expect(text).toMatch(/notification/i);
  });

  it("shows enabled notification details", async () => {
    mockUserRepository.getSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      notificationEnabled: true,
      notificationTime: "20",
      notificationType: "srs",
      timezone: "Europe/Prague",
    } as any);
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

    expect(mockNotificationRepository.updatePrefs).toHaveBeenCalledWith(1, {
      notificationEnabled: true,
    });
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(ctx.editMessageText).toHaveBeenCalled();
  });

  it("disables notifications when currently enabled", async () => {
    mockUserRepository.getSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      notificationEnabled: true,
      notificationTime: "8",
    } as any);
    const ctx = createMockCtx("set:notif:toggle");

    await handleSetNotifToggleCallback(ctx);

    expect(mockNotificationRepository.updatePrefs).toHaveBeenCalledWith(1, {
      notificationEnabled: false,
    });
  });
});

describe("handleSetNotifTimeCallback", () => {
  it("shows time picker with hourly options (0-23)", async () => {
    const ctx = createMockCtx("set:notif:time");

    await handleSetNotifTimeCallback(ctx);

    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
    const opts = ctx.editMessageText.mock.calls[0][1];
    const buttons = opts.reply_markup.inline_keyboard.flat();
    const cbData = buttons.map((b: any) => b.callback_data);
    // Should have all 24 hours plus back button
    expect(cbData).toContain("set:notif:time:0");
    expect(cbData).toContain("set:notif:time:8");
    expect(cbData).toContain("set:notif:time:14");
    expect(cbData).toContain("set:notif:time:23");
    expect(cbData).toContain("set:back");
  });
});

describe("handleSetNotifTimeSelectCallback", () => {
  it("updates notification time to selected hour", async () => {
    const ctx = createMockCtx("set:notif:time:14");

    await handleSetNotifTimeSelectCallback(ctx);

    expect(mockNotificationRepository.updatePrefs).toHaveBeenCalledWith(1, {
      notificationTime: "14",
    });
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(ctx.editMessageText).toHaveBeenCalled();
  });

  it("rejects invalid hour values", async () => {
    const ctx = createMockCtx("set:notif:time:25");

    await handleSetNotifTimeSelectCallback(ctx);

    expect(mockNotificationRepository.updatePrefs).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(expect.objectContaining({ show_alert: true }));
  });
});

describe("handleSetNotifTypeCallback", () => {
  it("shows type picker with all options", async () => {
    const ctx = createMockCtx("set:notif:type");

    await handleSetNotifTypeCallback(ctx);

    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
    const opts = ctx.editMessageText.mock.calls[0][1];
    const buttons = opts.reply_markup.inline_keyboard.flat();
    const cbData = buttons.map((b: any) => b.callback_data);
    expect(cbData).toContain("set:notif:type:suggested");
    expect(cbData).toContain("set:notif:type:srs");
    expect(cbData).toContain("set:notif:type:both");
  });
});

describe("handleSetNotifTypeSelectCallback", () => {
  it("updates notification type", async () => {
    const ctx = createMockCtx("set:notif:type:srs");

    await handleSetNotifTypeSelectCallback(ctx);

    expect(mockNotificationRepository.updatePrefs).toHaveBeenCalledWith(1, {
      notificationType: "srs",
    });
  });
});

describe("handleSetNotifTzCallback", () => {
  it("shows timezone picker with common timezones", async () => {
    const ctx = createMockCtx("set:notif:tz");

    await handleSetNotifTzCallback(ctx);

    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
    const opts = ctx.editMessageText.mock.calls[0][1];
    const buttons = opts.reply_markup.inline_keyboard.flat();
    const cbData = buttons.map((b: any) => b.callback_data);
    expect(cbData).toContain("set:notif:tz:UTC");
    expect(cbData).toContain("set:notif:tz:Europe/Prague");
    expect(cbData).toContain("set:back");
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
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(ctx.editMessageText).toHaveBeenCalled();
  });

  it("rejects invalid timezone", async () => {
    const ctx = createMockCtx("set:notif:tz:Invalid/Timezone123");

    await handleSetNotifTzSelectCallback(ctx);

    expect(mockUserRepository.updateSettings).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(expect.objectContaining({ show_alert: true }));
  });
});
