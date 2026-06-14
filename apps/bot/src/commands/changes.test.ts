import { describe, expect, it, vi } from "vitest";
import type { BotContext } from "../types.js";
import { canUseChangesCommand, changesCommand, formatDeliveredChanges, splitTelegramText } from "./changes.js";

function createMockCtx(audienceGroup: "admin" | "tester" | "product"): BotContext {
  return {
    reply: vi.fn().mockResolvedValue({ message_id: 1 }),
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
  } as unknown as BotContext;
}

describe("changesCommand", () => {
  it("allows admin and tester audience groups", () => {
    expect(canUseChangesCommand("admin")).toBe(true);
    expect(canUseChangesCommand("tester")).toBe(true);
    expect(canUseChangesCommand("product")).toBe(false);
  });

  it("formats changelog body without the document header", () => {
    const result = formatDeliveredChanges(`# Changelog

All notable changes.

## [Unreleased]

### Added

- Added one feature.
`);

    expect(result).toBe(`Delivered changes

## [Unreleased]

### Added

- Added one feature.`);
  });

  it("splits long text into Telegram-safe chunks", () => {
    const chunks = splitTelegramText(`Title\n\n${"- change\n".repeat(700)}`);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 3900)).toBe(true);
  });

  it("rejects product audience users", async () => {
    const ctx = createMockCtx("product");

    await changesCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith("This command is available to testers and admins.");
  });

  it("replies with delivered changes for testers", async () => {
    const ctx = createMockCtx("tester");

    await changesCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Delivered changes"));
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("## [Unreleased]"));
  });
});
