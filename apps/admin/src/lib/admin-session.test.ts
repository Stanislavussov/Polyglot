/**
 * Spec: the panel's own server keeps the admin token in an httpOnly cookie, which
 * is what the reports pages check. It takes the token once, right after login,
 * and only after the admin API confirms it — a made-up token sets nothing.
 */
import type { APIContext } from "astro";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSession, endSession } from "./admin-session.js";

const TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJhZG1pbklkIjoxfQ.c2lnbmF0dXJl";

function context(body: unknown, contentType = "application/json", forwardedFor = "203.0.113.9") {
  const cookies = { set: vi.fn(), delete: vi.fn() };
  const request = new Request("http://admin.local/session", {
    method: "POST",
    headers: { "content-type": contentType, "x-forwarded-for": forwardedFor },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { ctx: { request, cookies } as unknown as APIContext, cookies };
}

describe("panel session", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores a token the admin API accepts in an httpOnly cookie", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 200 }));
    const { ctx, cookies } = context({ token: TOKEN });

    const res = await createSession(ctx);

    expect(res.status).toBe(204);
    expect(vi.mocked(fetch).mock.calls[0]?.[1]).toMatchObject({ headers: { authorization: `Bearer ${TOKEN}` } });
    expect(cookies.set).toHaveBeenCalledWith(
      "admin_token",
      TOKEN,
      expect.objectContaining({ httpOnly: true, sameSite: "strict", path: "/", maxAge: 86_400 }),
    );
  });

  it("refuses a token the admin API rejects", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 401 }));
    const { ctx, cookies } = context({ token: `${TOKEN}x` });

    const res = await createSession(ctx);

    expect(res.status).toBe(401);
    expect(cookies.set).not.toHaveBeenCalled();
  });

  it.each([
    ["no token", { nope: 1 }, "application/json"],
    ["a body that is not JSON", "token=abc", "application/json"],
    ["a form-style content type, which a cross-site page could send", { token: TOKEN }, "text/plain"],
    ["something that is not even shaped like a token", { token: "junk" }, "application/json"],
  ])("refuses %s without asking the admin API", async (_label, body, contentType) => {
    const { ctx, cookies } = context(body, contentType);

    const res = await createSession(ctx);

    expect(res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
    expect(cookies.set).not.toHaveBeenCalled();
  });

  // The API rate-limits per client address. Without the address nginx saw, every
  // check the panel server made shared one bucket, and a flood of junk tokens
  // locked every admin out of login and the reports.
  it("asks the admin API on behalf of the client nginx saw", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 200 }));
    const { ctx } = context({ token: TOKEN }, "application/json", "198.51.100.1, 203.0.113.9");

    await createSession(ctx);

    expect(vi.mocked(fetch).mock.calls[0]?.[1]).toMatchObject({
      headers: { "x-forwarded-for": "198.51.100.1, 203.0.113.9" },
    });
  });

  it("drops the cookie on logout", async () => {
    const { ctx, cookies } = context({});

    const res = await endSession(ctx);

    expect(res.status).toBe(204);
    expect(cookies.delete).toHaveBeenCalledWith("admin_token", { path: "/" });
  });
});
