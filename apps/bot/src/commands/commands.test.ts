import { describe, expect, it, vi } from "vitest";
import { getLocalizedCommands, setUserCommands } from "./commands.js";

describe("bot commands", () => {
  it("leads with the practice entries and trails with configuration", () => {
    const listed = getLocalizedCommands("en").map((command) => command.command);

    expect(listed).toEqual(["learn", "dictionary", "settings", "report"]);
  });

  it("keeps the retired entry points out of the list", () => {
    const listed = getLocalizedCommands("en").map((command) => command.command);

    // They stay registered in bot-factory so typing them still works; only the
    // advertisement is gone, which is what keeps the list short. /start is in this
    // set too (Telegram shows its own START button on an empty chat), and so is
    // /menu — its hub holds exactly the four entries this list already carries.
    for (const retired of [
      "start",
      "menu",
      "translate",
      "pick",
      "flashcard",
      "videos",
      "template",
      "review",
      "mentor",
      "changes",
    ]) {
      expect(listed).not.toContain(retired);
    }
  });

  it("prefixes every command description with a unique icon", () => {
    for (const lang of ["en", "ru", "cs"] as const) {
      const commands = getLocalizedCommands(lang);
      const icons = commands.map((command) => command.description.split(" ")[0] ?? "");

      expect(icons.every((icon) => icon.codePointAt(0) !== undefined && icon.codePointAt(0)! > 0x7f)).toBe(true);
      expect(new Set(icons).size).toBe(commands.length);
    }
  });

  it("scopes the same commands to a single chat", async () => {
    const api = { setMyCommands: vi.fn().mockResolvedValue(true) };

    await setUserCommands(api as unknown as Parameters<typeof setUserCommands>[0], 12345, "en");

    const [commands, options] = api.setMyCommands.mock.calls[0] ?? [];
    expect((commands as ReturnType<typeof getLocalizedCommands>).map((c) => c.command)).toEqual([
      "learn",
      "dictionary",
      "settings",
      "report",
    ]);
    expect(options).toEqual({ scope: { type: "chat", chat_id: 12345 }, language_code: "en" });
  });
});
