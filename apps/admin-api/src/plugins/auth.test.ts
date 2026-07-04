import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({ findById: vi.fn() }));

vi.mock("@polyglot/adapter-db", () => ({ adminUserRepository: repo }));

process.env.JWT_SECRET = "test-secret";

const { authPlugin, clearAdminActiveCache, ADMIN_ACTIVE_CACHE_TTL_MS } = await import("./auth.js");

async function buildApp() {
  const app = Fastify();
  await app.register(authPlugin);
  // A protected route mirroring the real per-route auth hook.
  app.get(
    "/protected",
    {
      onRequest: async (request) => {
        await request.jwtVerify();
      },
    },
    async () => ({ ok: true }),
  );
  await app.ready();
  return app;
}

function callProtected(app: Awaited<ReturnType<typeof buildApp>>, token: string) {
  return app.inject({ method: "GET", url: "/protected", headers: { authorization: `Bearer ${token}` } });
}

describe("authPlugin runtime revocation (T06)", () => {
  beforeEach(() => {
    clearAdminActiveCache();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-04T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("lets an active admin through", async () => {
    repo.findById.mockResolvedValue({ id: 1, isActive: true });
    const app = await buildApp();
    const token = app.jwt.sign({ adminId: 1, email: "a@example.com", role: "admin" });

    const res = await callProtected(app, token);

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("revokes a deactivated admin once the cache TTL expires", async () => {
    repo.findById.mockResolvedValue({ id: 1, isActive: true });
    const app = await buildApp();
    const token = app.jwt.sign({ adminId: 1, email: "a@example.com", role: "admin" });

    // First call caches "active".
    expect((await callProtected(app, token)).statusCode).toBe(200);

    // Admin is deactivated in the DB.
    repo.findById.mockResolvedValue({ id: 1, isActive: false });

    // Still allowed within the TTL (served from cache, no fresh DB read).
    expect((await callProtected(app, token)).statusCode).toBe(200);

    // After the TTL, the DB is re-read and access is revoked — long before the
    // 24h token would have expired.
    vi.advanceTimersByTime(ADMIN_ACTIVE_CACHE_TTL_MS + 1_000);
    expect((await callProtected(app, token)).statusCode).toBe(401);
    await app.close();
  });

  it("does not hit the DB on every request within the TTL", async () => {
    repo.findById.mockResolvedValue({ id: 1, isActive: true });
    const app = await buildApp();
    const token = app.jwt.sign({ adminId: 1, email: "a@example.com", role: "admin" });

    await callProtected(app, token);
    await callProtected(app, token);
    await callProtected(app, token);

    expect(repo.findById).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("rejects a token for a deleted admin", async () => {
    repo.findById.mockResolvedValue(null);
    const app = await buildApp();
    const token = app.jwt.sign({ adminId: 999, email: "gone@example.com", role: "admin" });

    const res = await callProtected(app, token);

    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
