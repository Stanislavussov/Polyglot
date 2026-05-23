/**
 * Tests for notification settings in the settings scene.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@polyglot/adapter-db", () => ({
  userRepository: mockUserRepository,
  languageCache: mockLanguageCache,
  notificationRepository: mockNotificationRepository,
  getLangDisplay: mockLanguageCache.getLangDisplay,
  getSupportedLangs: mockLanguageCache.getSupportedLangs,
  NOTIFICATION_TYPES: ["suggested", "srs", "contextual"],
  DEFAULT_NOTIFICATION_TIME: "08:00",
  parseNotificationMinutes: (v: string | null | undefined) => {
    if (v == null) return 8 * 60;
    const parts = v.split(":");
    if (parts.length !== 2) return 8 * 60;
    const h = Number.parseInt(parts[0], 10);
    const m = Number.parseInt(parts[1], 10);
    if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 23) return 8 * 60;
    return h * 60 + m;
  },
  formatNotificationTime: (m: number) => {
    const h = Math.floor(m / 60);
    const min = m % 60;
    return `${h.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`;
  },
}));

vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>("@polyglot/core");
  return { ...actual };
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

const DEFAULT_SETTINGS = {
  interfaceLang: "en",
  nativeLang: "en",
  learningLangs: ["cs", "ru"],
  activeMode: "translate",
  timezone: "UTC",
  lastSourceLang: null,
  notificationEnabled: false,
  notificationTime: "08:00",
  notificationType: "srs",
  notificationContext: null,
};

function createMockCtx(callbackData?: string) {
  return {
    user: { id: 1 },
    session: { activeMode: "translate", awaitingNotifContext: false },
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

describe("buildSettingsText", () => {
  it("shows notification status line", () => {
    const text = buildSettingsText("en", ["cs"], "en", "en", false, "08:00", "srs");
    expect(text).toMatch(/notification/i);
  });

  it("shows enabled status with time and type", () => {
    const text = buildSettingsText("en", ["cs"], "en", "en", true, "08:00", "srs");
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
    const text = buildNotifSubText("en", true, "08:00", "srs", "Europe/Prague", null);
    expect(text).toContain("08:00");
    expect(text).toContain("srs");
    expect(text).toContain("Europe/Prague");
  });

  it("shows context when type is contextual", () => {
    const text = buildNotifSubText("en", true, "08:00", "contextual", "UTC", "job interview");
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
    mockUserRepository.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, notificationEnabled: true } as any);
    const ctx = createMockCtx("set:notif:toggle");
    await handleSetNotifToggleCallback(ctx);
    expect(mockNotificationRepository.updatePrefs).toHaveBeenCalledWith(1, { notificationEnabled: false });
  });
});

describe("handleSetNotifTimeCallback", () => {
  it("shows time picker with 30-min interval options", async () => {
    const ctx = createMockCtx("set:notif:time");
    await handleSetNotifTimeCallback(ctx);
    const opts = ctx.editMessageText.mock.calls[0][1];
    const buttons = opts.reply_markup.inline_keyboard.flat();
    const cbData = buttons.map((b: any) => b.callback_data);
    expect(cbData).toContain("set:notif:time:0");
    expect(cbData).toContain("set:notif:time:480");
    expect(cbData).toContain("set:notif:time:1410");
    expect(cbData).toContain("set:notif:back");
  });
});

describe("handleSetNotifTimeSelectCallback", () => {
  it("updates notification time", async () => {
    const ctx = createMockCtx("set:notif:time:870");
    await handleSetNotifTimeSelectCallback(ctx);
    expect(mockNotificationRepository.updatePrefs).toHaveBeenCalledWith(1, { notificationTime: "14:30" });
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
