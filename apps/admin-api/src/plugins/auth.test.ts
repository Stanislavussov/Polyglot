import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({ findById: vi.fn() }));

vi.mock("@polyglot/adapter-db", () => ({ adminUserRepository: repo }));

process.env.JWT_SECRET = "test-secret";

const { authPlugin, clearAdminActiveCache, ADMIN_ACTIVE_CACHE_TTL_MS } = await import("./auth.js");

async function buildApp() {
  const app = Fastify();
  // authPlugin installs the unified auth hook globally, so this route needs no
  // per-route auth wiring — exactly the T07 consolidation under test.
  await app.register(authPlugin);
  app.get("/protected", async () => ({ ok: true }));
  app.post("/api/auth/logout", async () => ({ ok: true }));
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

  it("accepts the session cookie the login set, with no Authorization header", async () => {
    repo.findById.mockResolvedValue({ id: 1, isActive: true });
    const app = await buildApp();
    const token = app.jwt.sign({ adminId: 1, email: "a@example.com", role: "admin" });

    const res = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { cookie: `theme=dark; admin_token=${token}` },
    });

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("reads the __Host- cookie in production", async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    repo.findById.mockResolvedValue({ id: 1, isActive: true });
    const app = await buildApp();
    const token = app.jwt.sign({ adminId: 1, email: "a@example.com", role: "admin" });

    const planted = await app.inject({ method: "GET", url: "/protected", headers: { cookie: `admin_token=${token}` } });
    const own = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { cookie: `__Host-admin_token=${token}` },
    });

    process.env.NODE_ENV = original;
    expect(planted.statusCode).toBe(401);
    expect(own.statusCode).toBe(200);
    await app.close();
  });

  it("rejects a forged session cookie", async () => {
    repo.findById.mockResolvedValue({ id: 1, isActive: true });
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/protected", headers: { cookie: "admin_token=forged" } });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("lets logout through without a session, so an expired one can still be cleared", async () => {
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: "/api/auth/logout" });

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("rejects a protected route when no token is presented", async () => {
    repo.findById.mockResolvedValue({ id: 1, isActive: true });
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/protected" });

    expect(res.statusCode).toBe(401);
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

describe("authPlugin token hardening", () => {
  beforeEach(() => {
    clearAdminActiveCache();
    repo.findById.mockResolvedValue({ id: 1, isActive: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a token signed with the right secret under another algorithm", async () => {
    const app = await buildApp();
    const token = app.jwt.sign({ adminId: 1, email: "a@example.com", role: "admin" }, { algorithm: "HS512" });

    const res = await callProtected(app, token);

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("rejects a token carrying a critical header extension it does not understand", async () => {
    const app = await buildApp();
    const token = app.jwt.sign(
      { adminId: 1, email: "a@example.com", role: "admin" },
      { header: { alg: "HS256", crit: ["x-policy"], "x-policy": "require-mfa" } },
    );

    const res = await callProtected(app, token);

    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
