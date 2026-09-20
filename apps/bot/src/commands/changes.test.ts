import { describe, expect, it, vi } from "vitest";
import type { BotContext } from "../types.js";
import { canUseChangesCommand, changesCommand } from "./changes.js";

function createMockCtx(
  audienceGroup: "admin" | "tester" | "product",
  interfaceLang = "en",
): BotContext & { reply: ReturnType<typeof vi.fn> } {
  return {
    reply: vi.fn().mockResolvedValue({ message_id: 1 }),
    services: {
      userRepository: {
        getSettings: vi.fn().mockResolvedValue({ interfaceLang, nativeLang: interfaceLang }),
      },
    },
    user: {
      id: 1,
      telegramId: 123456,
      username: "tester",
      audienceGroup,
      subscriptionPlan: "free",
      onboardingStep: 3,
      onboarded: true,
      isActive: true,
      createdAt: new Date("2026-06-14T00:00:00Z"),
    },
  } as unknown as BotContext & { reply: ReturnType<typeof vi.fn> };
}

describe("changesCommand", () => {
  it("allows admin and tester audience groups", () => {
    expect(canUseChangesCommand("admin")).toBe(true);
    expect(canUseChangesCommand("tester")).toBe(true);
    expect(canUseChangesCommand("product")).toBe(false);
  });

  it("turns a product user away without reading the queue", async () => {
    const ctx = createMockCtx("product");

    await changesCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith("This command is available to testers and admins.");
  });

  // Reads the repository's own @docs/releases/unreleased queue, which the CI gate
  // keeps non-empty — the same notes the next production deploy announces.
  it("sends the pending notes as one HTML message", async () => {
    const ctx = createMockCtx("tester");

    await changesCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("•"), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
    expect(ctx.reply.mock.calls[0]?.[0]).toContain("<b>What's new</b>");
  });

  it("answers in the reader's interface language", async () => {
    const ctx = createMockCtx("admin", "ru");

    await changesCommand(ctx);

    expect(ctx.reply.mock.calls[0]?.[0]).toContain("<b>Что нового</b>");
  });
});
