import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalizedCommands, setBotCommands, setUserCommands } from "./commands.js";

// Mock logger (hoisted to avoid TDZ issues)
const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock @polyglot/core i18n + logger
vi.mock("@polyglot/core", () => ({
  t: (key: string, lang: string) => `${key}:${lang}`,
  logger: mockLogger,
}));

// Mock @polyglot/infra logger
vi.mock("@polyglot/infra", () => ({
  logger: mockLogger,
}));

describe("getLocalizedCommands", () => {
  it("returns 6 commands with i18n descriptions for English", () => {
    const commands = getLocalizedCommands("en");
    expect(commands).toHaveLength(6);
    expect(commands[0]).toEqual({ command: "start", description: "cmdDescStart:en" });
    expect(commands[1]).toEqual({ command: "translate", description: "cmdDescTranslate:en" });
    expect(commands[2]).toEqual({ command: "flashcard", description: "cmdDescFlashcard:en" });
    expect(commands[3]).toEqual({ command: "dictionary", description: "cmdDescDictionary:en" });
    expect(commands[4]).toEqual({ command: "template", description: "cmdDescTemplate:en" });
    expect(commands[5]).toEqual({ command: "settings", description: "cmdDescSettings:en" });
  });

  it("returns 6 commands with i18n descriptions for Russian", () => {
    const commands = getLocalizedCommands("ru");
    expect(commands).toHaveLength(6);
    expect(commands[0]).toEqual({ command: "start", description: "cmdDescStart:ru" });
    expect(commands[1]).toEqual({ command: "translate", description: "cmdDescTranslate:ru" });
    expect(commands[2]).toEqual({ command: "flashcard", description: "cmdDescFlashcard:ru" });
  });

  it("returns 6 commands with i18n descriptions for Czech", () => {
    const commands = getLocalizedCommands("cs");
    expect(commands).toHaveLength(6);
    expect(commands[0]).toEqual({ command: "start", description: "cmdDescStart:cs" });
    expect(commands[3]).toEqual({ command: "dictionary", description: "cmdDescDictionary:cs" });
  });

  it("uses i18n fallback for languages without locale files", () => {
    const commands = getLocalizedCommands("de");
    expect(commands).toHaveLength(6);
    // t() with "de" will fall back to English in real i18n, our mock returns de suffix
    expect(commands[0]).toEqual({ command: "start", description: "cmdDescStart:de" });
  });
});

describe("setBotCommands", () => {
  let mockApi: { setMyCommands: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockApi = { setMyCommands: vi.fn().mockResolvedValue(true) };
  });

  it("sets default commands (English fallback) without language_code", async () => {
    await setBotCommands(mockApi as any);

    // First call: default (no language_code)
    const firstCall = mockApi.setMyCommands.mock.calls[0];
    expect(firstCall[0]).toHaveLength(6);
    expect(firstCall[0][0].description).toBe("cmdDescStart:en");
    expect(firstCall[1]).toBeUndefined(); // no options = default scope
  });

  it("sets per-locale commands for en, ru, cs", async () => {
    await setBotCommands(mockApi as any);

    // 1 default + 3 locale calls = 4 total
    expect(mockApi.setMyCommands).toHaveBeenCalledTimes(4);

    // Locale calls (indices 1, 2, 3)
    expect(mockApi.setMyCommands.mock.calls[1][1]).toEqual({ language_code: "en" });
    expect(mockApi.setMyCommands.mock.calls[2][1]).toEqual({ language_code: "ru" });
    expect(mockApi.setMyCommands.mock.calls[3][1]).toEqual({ language_code: "cs" });
  });

  it("logs error but does not throw when setMyCommands fails", async () => {
    mockApi.setMyCommands.mockRejectedValue(new Error("Network error"));

    await expect(setBotCommands(mockApi as any)).resolves.toBeUndefined();
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it("continues setting other locales when one fails", async () => {
    mockApi.setMyCommands
      .mockResolvedValueOnce(true) // default
      .mockRejectedValueOnce(new Error("fail en")) // en fails
      .mockResolvedValueOnce(true) // ru succeeds
      .mockResolvedValueOnce(true); // cs succeeds

    await setBotCommands(mockApi as any);
    expect(mockApi.setMyCommands).toHaveBeenCalledTimes(4);
  });
});

describe("setUserCommands", () => {
  let mockApi: { setMyCommands: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockApi = { setMyCommands: vi.fn().mockResolvedValue(true) };
  });

  it("sets commands with BotCommandScopeChat for user", async () => {
    await setUserCommands(mockApi as any, 123456, "ru");

    expect(mockApi.setMyCommands).toHaveBeenCalledTimes(1);
    const [commands, options] = mockApi.setMyCommands.mock.calls[0];
    expect(commands).toHaveLength(6);
    expect(commands[0].description).toBe("cmdDescStart:ru");
    expect(options).toEqual({
      scope: { type: "chat", chat_id: 123456 },
      language_code: "ru",
    });
  });

  it("logs error but does not throw on failure", async () => {
    mockApi.setMyCommands.mockRejectedValue(new Error("Rate limited"));

    await expect(setUserCommands(mockApi as any, 123456, "en")).resolves.toBeUndefined();
    expect(mockLogger.error).toHaveBeenCalled();
  });
});
