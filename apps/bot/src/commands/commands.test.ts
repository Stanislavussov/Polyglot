import { describe, expect, it, vi } from "vitest";
import { mainMenuLabels, matchMainMenuAction } from "../utils/main-menu.js";
import { getLocalizedCommands, setUserCommands } from "./commands.js";

describe("bot commands", () => {
  it("does not expose /changes in global commands", () => {
    const commands = getLocalizedCommands("en");

    expect(commands.map((command) => command.command)).not.toContain("changes");
  });

  it("exposes /changes when requested for privileged audience groups", () => {
    const commands = getLocalizedCommands("en", { includeChanges: true });

    expect(commands).toContainEqual({ command: "changes", description: "🆕 Show delivered product changes" });
  });

  it("lists the everyday entry points, so they stay reachable without the reply keyboard", () => {
    const listed = getLocalizedCommands("en", { includeChanges: true }).map((command) => command.command);

    expect(listed).toContain("dictionary");
    expect(listed).toContain("flashcard");
    expect(listed).toContain("videos");
  });

  it("gives an entry point the same icon in the command list and on the reply keyboard", () => {
    const byCommand = new Map(getLocalizedCommands("en").map((command) => [command.command, command.description]));

    for (const label of mainMenuLabels()) {
      const action = matchMainMenuAction(label);
      const icon = label.split(" ")[0] ?? "";
      expect(byCommand.get(action ?? "")?.startsWith(`${icon} `)).toBe(true);
    }
  });

  it("prefixes every command description with a unique icon", () => {
    for (const lang of ["en", "ru", "cs"] as const) {
      const commands = getLocalizedCommands(lang, { includeChanges: true });
      const icons = commands.map((command) => command.description.split(" ")[0] ?? "");

      expect(icons.every((icon) => /\p{Extended_Pictographic}/u.test(icon))).toBe(true);
      expect(new Set(icons).size).toBe(commands.length);
    }
  });

  it("sets /changes for admin chats only", async () => {
    const api = {
      setMyCommands: vi.fn().mockResolvedValue(true),
    };

    await setUserCommands(api as unknown as Parameters<typeof setUserCommands>[0], 12345, "en", "admin");

    expect(api.setMyCommands).toHaveBeenCalledWith(
      expect.arrayContaining([{ command: "changes", description: "🆕 Show delivered product changes" }]),
      { scope: { type: "chat", chat_id: 12345 }, language_code: "en" },
    );
  });

  it("does not set /changes for product chats", async () => {
    const api = {
      setMyCommands: vi.fn().mockResolvedValue(true),
    };

    await setUserCommands(api as unknown as Parameters<typeof setUserCommands>[0], 12345, "en", "product");

    const commands = (api.setMyCommands.mock.calls[0]?.[0] ?? []) as ReturnType<typeof getLocalizedCommands>;
    expect(commands.map((command) => command.command)).not.toContain("changes");
  });
});
