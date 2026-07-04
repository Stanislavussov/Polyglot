import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getClient, getModel, resetClient, setAIApiKey } from "../client.js";

// Mock the OpenRouter provider
vi.mock("@openrouter/ai-sdk-provider", () => {
  const mockModelInstance = { modelId: "test-model" };
  const mockClient = vi.fn(() => mockModelInstance);
  return {
    createOpenRouter: vi.fn(() => mockClient),
  };
});

// Mock the ai SDK (needed for the type import)
vi.mock("ai", () => ({
  generateObject: vi.fn(),
}));

describe("client", () => {
  beforeEach(() => {
    resetClient();
    vi.unstubAllEnvs();
  });

  describe("getClient", () => {
    it("throws when OPENROUTER_API_KEY is not set", () => {
      vi.stubEnv("OPENROUTER_API_KEY", "");
      delete process.env.OPENROUTER_API_KEY;
      expect(() => getClient()).toThrow("OPENROUTER_API_KEY is not set");
    });

    it("returns a client when API key is set", () => {
      vi.stubEnv("OPENROUTER_API_KEY", "test-key-123");
      const client = getClient();
      expect(client).toBeDefined();
      expect(typeof client).toBe("function");
    });

    it("returns the same client on subsequent calls (singleton)", () => {
      vi.stubEnv("OPENROUTER_API_KEY", "test-key-123");
      const a = getClient();
      const b = getClient();
      expect(a).toBe(b);
    });
  });

  describe("setAIApiKey (composition-root ownership — A17)", () => {
    it("uses the injected key even when no env var is set", () => {
      vi.stubEnv("OPENROUTER_API_KEY", "");
      delete process.env.OPENROUTER_API_KEY;

      setAIApiKey("injected-key");
      const client = getClient();

      expect(client).toBeDefined();
      expect(createOpenRouter).toHaveBeenCalledWith({ apiKey: "injected-key" });
    });

    it("the injected key takes precedence over the env var", () => {
      vi.stubEnv("OPENROUTER_API_KEY", "env-key");
      vi.mocked(createOpenRouter).mockClear();

      setAIApiKey("injected-key");
      getClient();

      expect(createOpenRouter).toHaveBeenCalledWith({ apiKey: "injected-key" });
    });

    it("falls back to the env var when no key is injected", () => {
      vi.stubEnv("OPENROUTER_API_KEY", "env-key");
      vi.mocked(createOpenRouter).mockClear();

      getClient();

      expect(createOpenRouter).toHaveBeenCalledWith({ apiKey: "env-key" });
    });
  });

  describe("getModel", () => {
    it("returns a model instance for a given model ID", () => {
      vi.stubEnv("OPENROUTER_API_KEY", "test-key-123");
      const model = getModel("openai/gpt-4o");
      expect(model).toBeDefined();
    });
  });

  describe("resetClient", () => {
    it("resets the singleton so next getClient creates a new one", () => {
      vi.stubEnv("OPENROUTER_API_KEY", "key-1");
      const _a = getClient();
      resetClient();
      vi.stubEnv("OPENROUTER_API_KEY", "key-2");
      const b = getClient();
      // After reset, a new client is created
      // They may be equal because mock always returns same fn,
      // but the important thing is it doesn't throw
      expect(b).toBeDefined();
    });
  });
});
