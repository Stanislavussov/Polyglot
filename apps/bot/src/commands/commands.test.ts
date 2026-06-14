import { describe, expect, it, vi } from "vitest";
import { getLocalizedCommands, setUserCommands } from "./commands.js";

describe("bot commands", () => {
  it("does not expose /changes in global commands", () => {
    const commands = getLocalizedCommands("en");

    expect(commands.map((command) => command.command)).not.toContain("changes");
  });

  it("exposes /changes when requested for privileged audience groups", () => {
    const commands = getLocalizedCommands("en", { includeChanges: true });

    expect(commands).toContainEqual({ command: "changes", description: "Show delivered product changes" });
  });

  it("sets /changes for admin chats only", async () => {
    const api = {
      setMyCommands: vi.fn().mockResolvedValue(true),
    };

    await setUserCommands(api as unknown as Parameters<typeof setUserCommands>[0], 12345, "en", "admin");

    expect(api.setMyCommands).toHaveBeenCalledWith(
      expect.arrayContaining([{ command: "changes", description: "Show delivered product changes" }]),
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
