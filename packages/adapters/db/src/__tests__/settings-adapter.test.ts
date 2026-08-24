/**
 * Spec for the settings adapter's partial-blob merge (getWithFallback).
 *
 * A stored settings blob written before a field existed (e.g. an `ai.defaults` row
 * predating `requestTimeoutMs`, added in Fable T27) must not come back with that
 * field `undefined` — the whole fallback was only used when the row was null. The
 * fix backfills MISSING keys from the complete defaults via a shallow merge, which
 * is exactly what prevented the "AI request timed out after NaNms" outage from
 * being reachable through the data layer.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGet = vi.fn();
vi.mock("../repositories/system-settings.repository.js", () => ({
  systemSettingsRepository: { get: (...args: unknown[]) => mockGet(...args) },
}));
vi.mock("../repositories/ai-model.repository.js", () => ({ aiModelRepository: {} }));
vi.mock("../repositories/rate-limit-plan.repository.js", () => ({ rateLimitPlanRepository: {} }));
vi.mock("../repositories/translation-preset.repository.js", () => ({ translationPresetRepository: {} }));

import { settingsAdapter } from "../settings-adapter.js";

describe("settingsAdapter.getAIGenerationDefaults — partial-blob merge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("backfills a missing requestTimeoutMs from defaults while preserving stored values", async () => {
    // Legacy blob written before requestTimeoutMs existed.
    mockGet.mockResolvedValueOnce({ maxTokens: 8192, temperature: 0.3, frequencyPenalty: 0.5, maxRetries: 2 });

    const defaults = await settingsAdapter.getAIGenerationDefaults();

    expect(defaults.requestTimeoutMs).toBe(15_000); // backfilled from defaults
    expect(defaults.maxTokens).toBe(8192); // admin-set value preserved, not clobbered
  });

  it("returns a complete stored blob unchanged (merge is a no-op)", async () => {
    const complete = {
      maxTokens: 4096,
      temperature: 0.3,
      frequencyPenalty: 0.5,
      maxRetries: 2,
      requestTimeoutMs: 8_000,
    };
    mockGet.mockResolvedValueOnce(complete);

    expect(await settingsAdapter.getAIGenerationDefaults()).toEqual(complete);
  });

  it("falls back to full defaults when the row is null", async () => {
    mockGet.mockResolvedValueOnce(null);

    const defaults = await settingsAdapter.getAIGenerationDefaults();

    expect(defaults.requestTimeoutMs).toBe(15_000);
    expect(defaults.maxTokens).toBe(4096);
  });

  it("falls back to safe defaults when a stored field is present but invalid", async () => {
    // The exact shape that caused the outage: requestTimeoutMs stored as a non-number.
    mockGet.mockResolvedValueOnce({
      maxTokens: 8192,
      temperature: 0.3,
      frequencyPenalty: 0.5,
      maxRetries: 2,
      requestTimeoutMs: null,
    });

    const defaults = await settingsAdapter.getAIGenerationDefaults();

    // Boundary validation guarantees a finite, in-range budget — never null/NaN.
    expect(defaults.requestTimeoutMs).toBe(15_000);
    expect(Number.isFinite(defaults.requestTimeoutMs)).toBe(true);
    // Whole-object fallback: an invalid blob is not limped along field-by-field.
    expect(defaults.maxTokens).toBe(4096);
  });
});

describe("settingsAdapter.getSrsConfig — getWithFallback shallow-merge (non-ai blobs)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("backfills a key missing from a partial blob", async () => {
    mockGet.mockResolvedValueOnce({ minEaseFactor: 1.5 }); // defaultEaseFactor absent

    const srs = await settingsAdapter.getSrsConfig();

    expect(srs.minEaseFactor).toBe(1.5); // stored value preserved
    expect(srs.defaultEaseFactor).toBe(2.5); // backfilled from defaults
  });
});

describe("settingsAdapter.getNotificationDefaults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 19:00 when no notifications row has ever been saved", async () => {
    // The state every fresh database and every integration run starts in: the
    // only writer of this key is the admin-api notifications route. This value is
    // what a new user's schedule gets seeded with at their first opt-in, and what
    // the admin form pre-fills on a fresh install.
    mockGet.mockResolvedValueOnce(null);

    const notifications = await settingsAdapter.getNotificationDefaults();

    expect(notifications.defaultTime).toBe("19:00");
  });

  it("preserves an admin-set time and backfills the keys a legacy blob lacks", async () => {
    mockGet.mockResolvedValueOnce({ defaultTime: "21:30" }); // written before the other three existed

    const notifications = await settingsAdapter.getNotificationDefaults();

    expect(notifications.defaultTime).toBe("21:30"); // admin choice wins over the default
    expect(notifications.defaultType).toBe("srs");
    expect(notifications.inactivityDays).toBe(14);
    expect(notifications.notificationTimesLimit).toBe(12);
  });

  it("lets a present-but-invalid stored time through — canonicalization is the caller's job", async () => {
    // getWithFallback heals MISSING keys only. This is not a defect to fix here:
    // it is why the notification toggle canonicalizes through
    // parseNotificationMinutes before writing anything into user data.
    mockGet.mockResolvedValueOnce({ defaultTime: "not a time" });

    const notifications = await settingsAdapter.getNotificationDefaults();

    expect(notifications.defaultTime).toBe("not a time");
  });
});

describe("settingsAdapter.getSttConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("backfills a partial stored blob with the shipped defaults", async () => {
    mockGet.mockResolvedValueOnce({ modelId: "x" }); // enabled/maxDurationSec absent

    const stt = await settingsAdapter.getSttConfig();

    expect(stt.modelId).toBe("x"); // admin-set value preserved
    expect(stt.enabled).toBe(true); // backfilled from defaults
    expect(stt.maxDurationSec).toBe(60); // backfilled from defaults
  });

  it("returns the shipped defaults when no stt row has ever been saved", async () => {
    mockGet.mockResolvedValueOnce(null);

    const stt = await settingsAdapter.getSttConfig();

    expect(stt).toEqual({ enabled: true, modelId: "openai/whisper-large-v3", maxDurationSec: 60 });
  });
});
