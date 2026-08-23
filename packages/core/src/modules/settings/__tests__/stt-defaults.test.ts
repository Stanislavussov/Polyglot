/**
 * The shipped STT default is a product decision, not an implementation detail:
 * voice message translation is meant to be there out of the box, with no
 * `system_settings` row required. These tests pin that decision so it cannot be
 * reverted by accident.
 */
import { describe, expect, it, vi } from "vitest";
import type { SettingsPort, SttConfig } from "../../../ports/settings.port.js";
import { FALLBACK_STT, SettingsService } from "../settings.service.js";

describe("shipped STT default", () => {
  it("is enabled, so voice messages are handled without any settings row", () => {
    expect(FALLBACK_STT.enabled).toBe(true);
  });

  it("names a model — an enabled config without one renders a silently dead feature", () => {
    expect(FALLBACK_STT.modelId).not.toBe("");
  });

  it("keeps the model verified against the live API on 2026-08-23", () => {
    // Pinned deliberately. OpenRouter's /audio/transcriptions accepts OGG/Opus
    // (Telegram's voice message format) directly, so no transcoding, and
    // transcribed ru/kk/de correctly. Changing this line means re-probing the API.
    expect(FALLBACK_STT.modelId).toBe("openai/whisper-large-v3-turbo");
  });

  it("caps voice message duration so an oversized upload can never be sent for billing", () => {
    expect(FALLBACK_STT.maxDurationSec).toBeGreaterThan(0);
    expect(FALLBACK_STT.maxDurationSec).toBeLessThanOrEqual(300);
  });

  it("serves the port's stored config verbatim when one exists", async () => {
    // The admin override is what makes a bad default fixable without a redeploy.
    const stored: SttConfig = { enabled: false, modelId: "other/model", maxDurationSec: 30 };
    const port = { getSttConfig: vi.fn().mockResolvedValue(stored) } as unknown as SettingsPort;

    await expect(new SettingsService(port).getSttConfig()).resolves.toEqual(stored);
  });
});
