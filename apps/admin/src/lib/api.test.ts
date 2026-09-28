import { afterEach, describe, expect, it, vi } from "vitest";
import { type AIModel, aiModels, auth, dictionaryLookupLogs, openRouter, reportedIssues, users } from "./api.js";

function stubFetch(
  response: Response,
): ReturnType<typeof vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>> {
  const fetchMock = vi
    .fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>()
    .mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("admin API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not send JSON content type for bodyless DELETE requests", async () => {
    const fetchMock = stubFetch(new Response(null, { status: 204 }));

    await aiModels.delete("google/gemini-3.5-flash");

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:3001/api/settings/ai-models/google%2Fgemini-3.5-flash", {
      method: "DELETE",
      headers: {},
      credentials: "include",
    });
  });

  it("sends JSON content type when a request has a body", async () => {
    const model: Omit<AIModel, "isDefault"> = {
      id: "google/gemini-3.5-flash",
      name: "Gemini 3.5 Flash",
      provider: "google",
      maxTokens: 8192,
      costPer1kInput: 0,
      costPer1kOutput: 0,
      isEnabled: true,
      allowedPlans: ["free"],
    };
    const fetchMock = stubFetch(new Response(JSON.stringify({ ...model, isDefault: false }), { status: 200 }));

    await aiModels.create(model);

    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({ "Content-Type": "application/json" });
  });

  it("builds reported issues query parameters", async () => {
    const fetchMock = stubFetch(
      new Response(JSON.stringify({ issues: [], total: 0, page: 2, limit: 50 }), { status: 200 }),
    );

    await reportedIssues.list(2, 50, "open", "broken flow");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/api/reported-issues?page=2&limit=50&status=open&search=broken+flow",
      {
        method: "GET",
        headers: {},
        credentials: "include",
      },
    );
  });

  it("fetches OpenRouter key status from settings", async () => {
    const payload = {
      configured: true,
      label: "sk-or-v1-au7...890",
      expiresAt: "2026-07-03T00:00:00Z",
      status: "expiring_soon",
      daysRemaining: 20,
    };
    const fetchMock = stubFetch(new Response(JSON.stringify(payload), { status: 200 }));

    await expect(openRouter.key()).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:3001/api/settings/openrouter/key", {
      method: "GET",
      headers: {},
      credentials: "include",
    });
  });

  it("builds dictionary lookup log query parameters", async () => {
    const fetchMock = stubFetch(
      new Response(
        JSON.stringify({
          logs: [],
          total: 0,
          page: 3,
          limit: 25,
          summary: { totalLookups: 0, matchedLookups: 0, failedLookups: 0, matchRate: 0 },
        }),
        { status: 200 },
      ),
    );

    await dictionaryLookupLogs.list(3, 25, 14);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/api/stats/dictionary-lookups?page=3&limit=25&days=14",
      {
        method: "GET",
        headers: {},
        credentials: "include",
      },
    );
  });

  it("updates user audience groups", async () => {
    const fetchMock = stubFetch(new Response(JSON.stringify({ success: true }), { status: 200 }));

    await users.changeAudienceGroup(42, "tester");

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:3001/api/users/42/audience-group", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audienceGroup: "tester" }),
      credentials: "include",
    });
  });
});

/**
 * Spec: the admin token never lands anywhere a script can read it back. The API
 * keeps it in its own httpOnly cookie; the panel's server gets it once, right
 * after login, to set the httpOnly cookie the reports pages check. A token an
 * older build left in localStorage is wiped.
 */
describe("admin session", () => {
  const LOGIN = { token: "jwt-token", admin: { id: "1", email: "admin@example.com" } };

  function stubBrowser() {
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    const location = { href: "/" };
    const doc = { cookie: "" };
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("window", { location });
    vi.stubGlobal("document", doc);
    return { storage, location, doc };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("logs in with the API cookie and hands the token to the panel server, storing nothing", async () => {
    const { storage, doc } = stubBrowser();
    const fetchMock = vi
      .fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify(LOGIN), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await auth.login("admin@example.com", "pw");

    expect(fetchMock).toHaveBeenNthCalledWith(1, "http://localhost:3001/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@example.com", password: "pw" }),
      credentials: "include",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "jwt-token" }),
    });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).toHaveBeenCalledWith("admin_token");
    // The script-readable cookie older builds mirrored the token into, expired.
    expect(doc.cookie).toBe("admin_token=; path=/; Max-Age=0; SameSite=Strict");
  });

  it("fails the login when the panel server refuses the session", async () => {
    stubBrowser();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify(LOGIN), { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 401 })),
    );

    await expect(auth.login("admin@example.com", "pw")).rejects.toThrow();
  });

  it("never sends an Authorization header, even with a token left in localStorage", async () => {
    const { storage } = stubBrowser();
    storage.getItem.mockReturnValue("stale-token");
    const fetchMock = stubFetch(new Response(JSON.stringify({ id: "1", email: "a@example.com" }), { status: 200 }));

    await auth.me();

    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({});
  });

  it("logs out of the API and the panel server, then goes to the login page", async () => {
    const { location, storage, doc } = stubBrowser();
    const fetchMock = vi
      .fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await auth.logout();

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:3001/api/auth/logout", {
      method: "POST",
      headers: {},
      credentials: "include",
    });
    // Astro's origin check turns away a bodyless DELETE, which left the panel's
    // session behind; a JSON content type is what lets it through.
    expect(fetchMock).toHaveBeenCalledWith("/session", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    });
    expect(location.href).toBe("/login");
    expect(storage.removeItem).toHaveBeenCalledWith("admin_token");
    expect(doc.cookie).toBe("admin_token=; path=/; Max-Age=0; SameSite=Strict");
  });

  it("wipes a token an older build stored when the API turns the session away", async () => {
    const { location, storage } = stubBrowser();
    stubFetch(new Response(null, { status: 401 }));

    await expect(auth.me()).rejects.toThrow("Unauthorized");

    expect(storage.removeItem).toHaveBeenCalledWith("admin_token");
    expect(location.href).toBe("/login");
  });

  // Both cookies hold a JWT that stays valid until it expires, so reaching the
  // login page while one survives would claim a sign-out that never happened.
  it("stays on the page when the panel server does not end its session", async () => {
    const { location } = stubBrowser();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        input === "/session" ? new Response(null, { status: 403 }) : new Response(null, { status: 204 }),
      ),
    );

    await expect(auth.logout()).rejects.toThrow();

    expect(location.href).toBe("/");
  });

  it("stays on the page when a server cannot be reached on logout", async () => {
    const { location } = stubBrowser();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(auth.logout()).rejects.toThrow();

    expect(location.href).toBe("/");
  });
});
