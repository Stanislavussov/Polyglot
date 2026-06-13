import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAdminApiApp } from "../index.js";

const originalJwtSecret = process.env.JWT_SECRET;
const originalOpenRouterApiKey = process.env.OPENROUTER_API_KEY;

function stubFetch(response: Response): ReturnType<typeof vi.fn<typeof fetch>> {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("AI model OpenRouter routes", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    delete process.env.OPENROUTER_API_KEY;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T00:00:00.000Z"));
  });

  afterEach(() => {
    process.env.JWT_SECRET = originalJwtSecret;
    process.env.OPENROUTER_API_KEY = originalOpenRouterApiKey;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reports OpenRouter key expiration from the current key endpoint", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const fetchMock = stubFetch(
      new Response(
        JSON.stringify({
          data: {
            label: "sk-or-v1-au7...890",
            expires_at: "2026-07-03T00:00:00Z",
          },
        }),
        { status: 200 },
      ),
    );
    const app = await buildAdminApiApp();

    try {
      const token = app.jwt.sign({ adminId: 1, email: "admin@example.com", role: "superadmin" });
      const response = await app.inject({
        method: "GET",
        url: "/api/settings/openrouter/key",
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        configured: true,
        label: "sk-or-v1-au7...890",
        expiresAt: "2026-07-03T00:00:00Z",
        status: "expiring_soon",
        daysRemaining: 20,
      });
      expect(fetchMock).toHaveBeenCalledWith("https://openrouter.ai/api/v1/key", {
        headers: { Authorization: "Bearer sk-or-test" },
      });
    } finally {
      await app.close();
    }
  });

  it("does not call OpenRouter when no API key is configured", async () => {
    const fetchMock = stubFetch(new Response(null, { status: 500 }));
    const app = await buildAdminApiApp();

    try {
      const token = app.jwt.sign({ adminId: 1, email: "admin@example.com", role: "superadmin" });
      const response = await app.inject({
        method: "GET",
        url: "/api/settings/openrouter/key",
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        configured: false,
        label: null,
        expiresAt: null,
        status: "not_configured",
        daysRemaining: null,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
