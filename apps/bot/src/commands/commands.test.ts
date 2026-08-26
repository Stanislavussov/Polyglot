import { describe, expect, it, vi } from "vitest";
import { getLocalizedCommands, setUserCommands } from "./commands.js";

describe("bot commands", () => {
  it("lists /menu and the categories it holds, and nothing else", () => {
    const listed = getLocalizedCommands("en").map((command) => command.command);

    expect(listed).toEqual(["start", "menu", "dictionary", "learn", "settings", "report"]);
  });

  it("keeps the retired entry points out of the list", () => {
    const listed = getLocalizedCommands("en").map((command) => command.command);

    // They stay registered in bot-factory so typing them still works; only the
    // advertisement is gone, which is what keeps the list short.
    for (const retired of ["translate", "pick", "flashcard", "videos", "template", "review", "mentor", "changes"]) {
      expect(listed).not.toContain(retired);
    }
  });

  it("prefixes every command description with a unique icon", () => {
    for (const lang of ["en", "ru", "cs"] as const) {
      const commands = getLocalizedCommands(lang);
      const icons = commands.map((command) => command.description.split(" ")[0] ?? "");

      // Non-ASCII rather than Extended_Pictographic: ☰ (U+2630) is the clearest glyph
      // for a menu and Telegram renders it fine, but Unicode does not class it as an emoji.
      expect(icons.every((icon) => icon.codePointAt(0) !== undefined && icon.codePointAt(0)! > 0x7f)).toBe(true);
      expect(new Set(icons).size).toBe(commands.length);
    }
  });

  it("scopes the same commands to a single chat", async () => {
    const api = { setMyCommands: vi.fn().mockResolvedValue(true) };

    await setUserCommands(api as unknown as Parameters<typeof setUserCommands>[0], 12345, "en");

    const [commands, options] = api.setMyCommands.mock.calls[0] ?? [];
    expect((commands as ReturnType<typeof getLocalizedCommands>).map((c) => c.command)).toEqual([
      "start",
      "menu",
      "dictionary",
      "learn",
      "settings",
      "report",
    ]);
    expect(options).toEqual({ scope: { type: "chat", chat_id: 12345 }, language_code: "en" });
  });
});
