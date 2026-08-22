/**
 * The shipped TTS default is a product decision, not an implementation detail:
 * the pronunciation button is meant to be there out of the box, with no
 * `system_settings` row required. These tests pin that decision so it cannot be
 * reverted by accident.
 */
import { describe, expect, it, vi } from "vitest";
import type { SettingsPort, TtsConfig } from "../../../ports/settings.port.js";
import { FALLBACK_TTS, SettingsService } from "../settings.service.js";

describe("shipped TTS default", () => {
  it("is enabled, so the pronunciation button appears without any settings row", () => {
    expect(FALLBACK_TTS.enabled).toBe(true);
  });

  it("names a model and a voice — an enabled config without them renders no button", () => {
    // `resolvePronounceLangs` treats a blank modelId as "off", so enabled-but-blank
    // would be a silently dead feature rather than a loud misconfiguration.
    expect(FALLBACK_TTS.modelId).not.toBe("");
    expect(FALLBACK_TTS.voice).not.toBe("");
  });

  it("keeps the model verified against the live API on 2026-08-22", () => {
    // Pinned deliberately. Grok Voice TTS is the choice because it returns mp3
    // (Telegram sendVoice takes mp3 directly, so no ffmpeg) and auto-detects the
    // language, so one voice covers all 11 supported learning languages. Gemini
    // 3.1 Flash TTS — better on paper for coverage — rejects mp3 outright and
    // would fail on every call. Changing this line means re-probing the API.
    expect(FALLBACK_TTS.modelId).toBe("x-ai/grok-voice-tts-1.0");
    expect(FALLBACK_TTS.voice).toBe("eve");
  });

  it("caps synthesis length so a long card body can never be sent for billing", () => {
    expect(FALLBACK_TTS.maxChars).toBeGreaterThan(0);
    expect(FALLBACK_TTS.maxChars).toBeLessThanOrEqual(1000);
  });

  it("serves the port's stored config verbatim when one exists", async () => {
    // The admin override is what makes a bad default fixable without a redeploy.
    const stored: TtsConfig = { enabled: false, modelId: "other/model", voice: "rex", maxChars: 50 };
    const port = { getTtsConfig: vi.fn().mockResolvedValue(stored) } as unknown as SettingsPort;

    await expect(new SettingsService(port).getTtsConfig()).resolves.toEqual(stored);
  });
});
