import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onRequest } from "./middleware.js";

type Ctx = Parameters<typeof onRequest>[0];

function makeContext(pathname: string, cookieValue?: string): Ctx {
  return {
    url: new URL(`http://admin.local${pathname}`),
    cookies: {
      get: (name: string) => (name === "admin_token" && cookieValue ? { value: cookieValue } : undefined),
    },
  } as unknown as Ctx;
}

const NEXT_RESPONSE = new Response("page", { status: 200 });
const next = vi.fn(async () => NEXT_RESPONSE);

describe("reports auth middleware (T09)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("lets non-report requests through without touching the admin API", async () => {
    const res = await onRequest(makeContext("/users"), next);

    expect(res).toBe(NEXT_RESPONSE);
    expect(next).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("blocks an anonymous report request with 401 (no cookie)", async () => {
    const res = await onRequest(makeContext("/reports/database-schema.html"), next);

    expect(res.status).toBe(401);
    expect(next).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("blocks a report request whose token the admin API rejects", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 401 }));

    const res = await onRequest(makeContext("/reports/test-catalog.json", "bad-token"), next);

    expect(res.status).toBe(401);
    expect(next).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("allows a report request with a valid admin token", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ id: 1 }), { status: 200 }));

    const res = await onRequest(makeContext("/reports/database-schema.html", "good-token"), next);

    expect(res).toBe(NEXT_RESPONSE);
    expect(next).toHaveBeenCalledOnce();
    expect(vi.mocked(fetch).mock.calls[0]![1]).toMatchObject({
      headers: { authorization: "Bearer good-token" },
    });
  });

  it("fails closed (401) when the admin API is unreachable", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("ECONNREFUSED"));

    const res = await onRequest(makeContext("/reports/observability.html", "some-token"), next);

    expect(res.status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});
