/**
 * Tests for settings scene and helper handlers.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Define mocks at top level using vi.hoisted
const { mockLogger, mockUserRepository, mockLanguageCache } = vi.hoisted(() => {
  const mockUR = {
    getSettings: vi.fn(),
    updateNativeLang: vi.fn().mockResolvedValue({}),
    updateLearningLangs: vi.fn().mockResolvedValue({}),
    updateInterfaceLang: vi.fn().mockResolvedValue({}),
  };
  const mockLC = {
    getSupportedLangs: vi.fn(() => [{ code: "en" }, { code: "ru" }, { code: "cs" }, { code: "de" }]),
    getLangDisplay: vi.fn((code: string) => {
      const map: Record<string, string> = {
        en: "🇬🇧 English",
        ru: "🇷🇺 Русский",
        cs: "🇨🇿 Čeština",
        de: "🇩🇪 Deutsch",
      };
      return map[code] ?? code;
    }),
  };
  return {
    mockLogger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    mockUserRepository: mockUR,
    mockLanguageCache: mockLC,
  };
});

// Mock dependencies before imports
vi.mock("@polyglot/adapter-db", () => ({
  userRepository: mockUserRepository,
  languageCache: mockLanguageCache,
  getLangDisplay: mockLanguageCache.getLangDisplay,
  getSupportedLangs: mockLanguageCache.getSupportedLangs,
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

import { setUserCommands } from "../commands/commands.js";
import {
  handleSetBackCallback,
  handleSetCloseCallback,
  handleSetIfaceSelectCallback,
  handleSetInterfaceCallback,
  handleSetLearningCallback,
  handleSetLearnToggleCallback,
  handleSetNativeCallback,
  handleSetNativeSelectCallback,
} from "../scenes/helpers/settings.helper.js";
import { handleSettingsCommand } from "../scenes/settings.scene.js";

/** Default settings for tests */
const DEFAULT_SETTINGS = {
  interfaceLang: "en",
  nativeLang: "en",
  learningLangs: ["cs", "ru"],
  activeMode: "translate",
  timezone: "UTC",
  lastSourceLang: null,
};

/** Create a minimal mock BotContext */
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

describe("handleSettingsCommand", () => {
  it("shows settings with current language configuration", async () => {
    const ctx = createMockCtx();

    await handleSettingsCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const text = ctx.reply.mock.calls[0][0] as string;
    expect(text).toContain("⚙️ Settings");
    expect(text).toContain("🇬🇧 English");
    expect(text).toContain("🇨🇿 Čeština");
    expect(text).toContain("🇷🇺 Русский");
  });

  it("shows inline keyboard with change buttons", async () => {
    const ctx = createMockCtx();

    await handleSettingsCommand(ctx);

    const opts = ctx.reply.mock.calls[0][1];
    const buttons = opts.reply_markup.inline_keyboard.flat();
    const cbData = buttons.map((b: any) => b.callback_data);
    expect(cbData).toContain("set:native");
    expect(cbData).toContain("set:learning");
    expect(cbData).toContain("set:interface");
    expect(cbData).toContain("set:close");
  });

  it("handles missing settings gracefully", async () => {
    mockUserRepository.getSettings.mockResolvedValue(null);
    const ctx = createMockCtx();

    await handleSettingsCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const text = ctx.reply.mock.calls[0][0] as string;
    expect(text).toContain("⚙️ Settings");
  });
});

describe("handleSetNativeCallback", () => {
  it("shows language picker with all supported languages", async () => {
    const ctx = createMockCtx("set:native");

    await handleSetNativeCallback(ctx);

    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
    const text = ctx.editMessageText.mock.calls[0][0] as string;
    expect(text).toContain("native language");

    const opts = ctx.editMessageText.mock.calls[0][1];
    const buttons = opts.reply_markup.inline_keyboard.flat();
    const cbData = buttons.map((b: any) => b.callback_data);
    expect(cbData).toContain("set:native:en");
    expect(cbData).toContain("set:native:ru");
    expect(cbData).toContain("set:back");
  });
});

describe("handleSetNativeSelectCallback", () => {
  it("updates native language and returns to settings menu", async () => {
    const ctx = createMockCtx("set:native:de");

    await handleSetNativeSelectCallback(ctx);

    expect(mockUserRepository.updateNativeLang).toHaveBeenCalledWith(1, "de");
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("🇩🇪 Deutsch"),
      }),
    );
    // Re-renders settings menu
    expect(ctx.editMessageText).toHaveBeenCalled();
  });
});

describe("handleSetLearningCallback", () => {
  it("shows multi-select with currently selected languages checked", async () => {
    const ctx = createMockCtx("set:learning");

    await handleSetLearningCallback(ctx);

    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
    const opts = ctx.editMessageText.mock.calls[0][1];
    const buttons = opts.reply_markup.inline_keyboard.flat();
    const labels = buttons.map((b: any) => b.text);

    // cs and ru should have ✅ prefix, en (native) should be excluded
    expect(labels).toContainEqual(expect.stringContaining("✅"));
  });

  it("excludes native language from the picker", async () => {
    const ctx = createMockCtx("set:learning");

    await handleSetLearningCallback(ctx);

    const opts = ctx.editMessageText.mock.calls[0][1];
    const buttons = opts.reply_markup.inline_keyboard.flat();
    const cbData = buttons.map((b: any) => b.callback_data);
    // Native lang (en) should not appear as a learning option
    expect(cbData).not.toContain("set:learn:en");
  });
});

describe("handleSetLearnToggleCallback", () => {
  it("adds a new learning language", async () => {
    const ctx = createMockCtx("set:learn:de");

    await handleSetLearnToggleCallback(ctx);

    expect(mockUserRepository.updateLearningLangs).toHaveBeenCalledWith(1, ["cs", "ru", "de"]);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Added"),
      }),
    );
  });

  it("removes an existing learning language", async () => {
    const ctx = createMockCtx("set:learn:cs");

    await handleSetLearnToggleCallback(ctx);

    expect(mockUserRepository.updateLearningLangs).toHaveBeenCalledWith(1, ["ru"]);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Removed"),
      }),
    );
  });

  it("shows alert when max languages reached", async () => {
    mockUserRepository.getSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      learningLangs: ["cs", "ru", "de", "fr"],
    } as any);
    const ctx = createMockCtx("set:learn:it");

    await handleSetLearnToggleCallback(ctx);

    expect(mockUserRepository.updateLearningLangs).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(expect.objectContaining({ show_alert: true }));
  });

  it("confirms when pressing done with valid selection", async () => {
    const ctx = createMockCtx("set:learn:done");

    await handleSetLearnToggleCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("updated"),
      }),
    );
    // Should show settings menu
    expect(ctx.editMessageText).toHaveBeenCalled();
  });

  it("shows alert when pressing done with no selection", async () => {
    mockUserRepository.getSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      learningLangs: [],
    } as any);
    const ctx = createMockCtx("set:learn:done");

    await handleSetLearnToggleCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(expect.objectContaining({ show_alert: true }));
  });
});

describe("handleSetInterfaceCallback", () => {
  it("shows interface language picker", async () => {
    const ctx = createMockCtx("set:interface");

    await handleSetInterfaceCallback(ctx);

    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
    const text = ctx.editMessageText.mock.calls[0][0] as string;
    expect(text).toContain("interface language");

    const opts = ctx.editMessageText.mock.calls[0][1];
    const buttons = opts.reply_markup.inline_keyboard.flat();
    const cbData = buttons.map((b: any) => b.callback_data);
    expect(cbData).toContain("set:iface:en");
    expect(cbData).toContain("set:iface:ru");
    expect(cbData).toContain("set:back");
  });
});

describe("handleSetIfaceSelectCallback", () => {
  it("updates interface language and calls setUserCommands", async () => {
    const ctx = createMockCtx("set:iface:ru");

    await handleSetIfaceSelectCallback(ctx);

    expect(mockUserRepository.updateInterfaceLang).toHaveBeenCalledWith(1, "ru");
    expect(setUserCommands).toHaveBeenCalledWith(ctx.api, 12345, "ru");
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("🇷🇺 Русский"),
      }),
    );
    // Re-renders settings menu
    expect(ctx.editMessageText).toHaveBeenCalled();
  });
});

describe("handleSetBackCallback", () => {
  it("returns to settings main menu", async () => {
    const ctx = createMockCtx("set:back");

    await handleSetBackCallback(ctx);

    expect(ctx.editMessageText).toHaveBeenCalled();
    const text = ctx.editMessageText.mock.calls[0][0] as string;
    expect(text).toContain("⚙️ Settings");
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
  });
});

describe("handleSetCloseCallback", () => {
  it("deletes the settings message", async () => {
    const ctx = createMockCtx("set:close");

    await handleSetCloseCallback(ctx);

    expect(ctx.deleteMessage).toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
  });

  it("falls back to removing keyboard when delete fails", async () => {
    const ctx = createMockCtx("set:close");
    ctx.deleteMessage.mockRejectedValue(new Error("too old"));

    await handleSetCloseCallback(ctx);

    expect(ctx.editMessageReplyMarkup).toHaveBeenCalledWith({
      reply_markup: { inline_keyboard: [] },
    });
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
  });
});
