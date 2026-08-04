/**
 * Spec for how SettingsService resolves WHICH model serves a request.
 *
 * The rule the admin panel now shows literally: the plan's own model, else the
 * globally default model, else the admin-set fallback model, else nothing. Every
 * step is a database row an admin can change; the service holds no model id of its
 * own. It used to end at a hardcoded "openai/gpt-5-nano", which meant an empty or
 * misconfigured `ai_models` table looked healthy while the bot called a model
 * nobody had chosen — and, in the 2026-07-17 incident, one that did not exist.
 */
import { describe, expect, it, vi } from "vitest";
import type { SettingsPort } from "../../../ports/settings.port.js";
import { SettingsService } from "../settings.service.js";

function portStub(overrides: Partial<SettingsPort> = {}): SettingsPort {
  return {
    getPlanLimits: vi.fn().mockResolvedValue([]),
    getPlanLimit: vi.fn().mockResolvedValue(null),
    getAIModels: vi.fn().mockResolvedValue([]),
    getEnabledAIModels: vi.fn().mockResolvedValue([]),
    getDefaultAIModel: vi.fn().mockResolvedValue(null),
    getDefaultAIModelForPlan: vi.fn().mockResolvedValue(null),
    getFallbackAIModel: vi.fn().mockResolvedValue(null),
    getAIGenerationDefaults: vi.fn(),
    getSrsConfig: vi.fn(),
    getNotificationDefaults: vi.fn(),
    getDictionaryConfig: vi.fn(),
    getTranslationPresets: vi.fn().mockResolvedValue([]),
    getVideoVocabularyConfig: vi.fn(),
    ...overrides,
  } as SettingsPort;
}

describe("SettingsService model resolution", () => {
  it("uses the model routed to the plan when the plan has one", async () => {
    const service = new SettingsService(
      portStub({
        getDefaultAIModelForPlan: vi.fn().mockResolvedValue("anthropic/claude-sonnet-4-20250514"),
        getDefaultAIModel: vi.fn().mockResolvedValue("google/gemini-3.1-flash-lite"),
      }),
    );

    expect(await service.getDefaultAIModelForPlan("pro")).toBe("anthropic/claude-sonnet-4-20250514");
  });

  it("falls back to the global default for a plan with no model of its own", async () => {
    const service = new SettingsService(
      portStub({ getDefaultAIModel: vi.fn().mockResolvedValue("google/gemini-3.1-flash-lite") }),
    );

    expect(await service.getDefaultAIModelForPlan("free")).toBe("google/gemini-3.1-flash-lite");
  });

  it("falls back to the admin-set fallback model when no default model is flagged", async () => {
    const service = new SettingsService(
      portStub({ getFallbackAIModel: vi.fn().mockResolvedValue("openai/gpt-5-nano") }),
    );

    expect(await service.getDefaultAIModel()).toBe("openai/gpt-5-nano");
  });

  it("returns null — never a hardcoded id — when the database names no model at all", async () => {
    const service = new SettingsService(portStub());

    expect(await service.getDefaultAIModel()).toBeNull();
    expect(await service.getDefaultAIModelForPlan("free")).toBeNull();
    expect(await service.getFallbackAIModel()).toBeNull();
  });

  it("re-reads an unset fallback instead of caching the unconfigured state", async () => {
    // An admin choosing a fallback must take effect on the next call, not after
    // the 60s TTL of a cached "none".
    const getFallbackAIModel = vi.fn().mockResolvedValueOnce(null).mockResolvedValue("openai/gpt-5-nano");
    const service = new SettingsService(portStub({ getFallbackAIModel }));

    expect(await service.getFallbackAIModel()).toBeNull();
    expect(await service.getFallbackAIModel()).toBe("openai/gpt-5-nano");
  });

  it("caches a resolved fallback model", async () => {
    const getFallbackAIModel = vi.fn().mockResolvedValue("openai/gpt-5-nano");
    const service = new SettingsService(portStub({ getFallbackAIModel }));

    await service.getFallbackAIModel();
    await service.getFallbackAIModel();

    expect(getFallbackAIModel).toHaveBeenCalledTimes(1);
  });
});
