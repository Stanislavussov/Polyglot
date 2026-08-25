/**
 * The shipped mentor default is a product decision, not an implementation
 * detail: mentor answers with a smarter model than the translate pipeline out
 * of the box, with no `system_settings` row required. These tests pin that
 * decision so it cannot be reverted by accident.
 */
import { describe, expect, it, vi } from "vitest";
import type { MentorConfig, SettingsPort } from "../../../ports/settings.port.js";
import { FALLBACK_MENTOR, SettingsService } from "../settings.service.js";

describe("shipped mentor default", () => {
  it("routes mentor to the mid-tier chat model picked on 2026-08-24", () => {
    // Pinned deliberately: gemini-3.7-flash at $0.375/$1.875 per 1M tokens
    // (~1.5x the flash-lite translate default) for grammar-explanation quality.
    // Changing this line is a cost/quality decision, not a refactor.
    expect(FALLBACK_MENTOR.modelId).toBe("google/gemini-3.7-flash");
  });

  it("caps answers so one turn stays inside a single Telegram message", () => {
    expect(FALLBACK_MENTOR.maxTokens).toBeGreaterThanOrEqual(100);
    expect(FALLBACK_MENTOR.maxTokens).toBeLessThanOrEqual(4000);
  });

  it("serves the port's stored config verbatim when one exists", async () => {
    // The admin override is what makes a bad default fixable without a redeploy.
    const stored: MentorConfig = { modelId: "anthropic/claude-sonnet-5", maxTokens: 900 };
    const port = { getMentorConfig: vi.fn().mockResolvedValue(stored) } as unknown as SettingsPort;

    await expect(new SettingsService(port).getMentorConfig()).resolves.toEqual(stored);
  });
});
