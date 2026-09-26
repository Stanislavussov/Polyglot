import { Writable } from "node:stream";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findByEmail: vi.fn(),
  updateLastLogin: vi.fn().mockResolvedValue(undefined),
  findById: vi.fn(),
  bcryptCompare: vi.fn(),
}));

vi.mock("@polyglot/adapter-db", () => ({
  adminUserRepository: {
    findByEmail: mocks.findByEmail,
    updateLastLogin: mocks.updateLastLogin,
    findById: mocks.findById,
  },
}));

vi.mock("bcryptjs", () => ({
  default: { compare: mocks.bcryptCompare },
}));

const { authRoutes } = await import("./auth.js");
const { TRUSTED_PROXY_HOPS } = await import("../proxy-trust.js");

const ACTIVE_ADMIN = {
  id: 1,
  email: "admin@example.com",
  passwordHash: "$2a$10$hash",
  role: "admin",
  isActive: true,
};

/**
 * Builds an app that mirrors production wiring for the login route: the global
 * @fastify/rate-limit plugin plus @fastify/jwt, so the per-route hard limit and
 * token signing behave as they do in index.ts. An optional log stream captures
 * pino output for the "no password leak" assertion.
 */
async function buildApp(logStream?: Writable) {
  const app = Fastify({
    trustProxy: TRUSTED_PROXY_HOPS,
    logger: logStream ? { level: "warn", stream: logStream } : false,
  });
  await app.register(import("@fastify/rate-limit"), { global: true, max: 200, timeWindow: "1 minute" });
  await app.register(import("@fastify/jwt"), { secret: "test-secret" });
  await app.register(authRoutes, { prefix: "/api/auth" });
  return app;
}

function loginPayload(overrides: Record<string, string> = {}) {
  return { email: "admin@example.com", password: "correct-horse", ...overrides };
}

describe("admin login rate limiting (T05)", () => {
  beforeEach(() => {
    mocks.findByEmail.mockResolvedValue(ACTIVE_ADMIN);
    mocks.bcryptCompare.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 429 after more than 5 login attempts in a minute from one IP", async () => {
    const app = await buildApp();

    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: loginPayload() });
      statuses.push(res.statusCode);
    }

    // First five reach the handler (401 on bad password); the sixth is throttled.
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
  });

  it("keys the limit on the address nginx saw, not on a forged X-Forwarded-For", async () => {
    const app = await buildApp();
    // nginx appends the real peer (203.0.113.7) after whatever the client sent.
    const attempt = (forged: string, real = "203.0.113.7") =>
      app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { "x-forwarded-for": `${forged}, ${real}` },
        payload: loginPayload(),
      });

    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await attempt(`198.51.100.${i}`)).statusCode);
    }
    const otherClient = await attempt("198.51.100.99", "203.0.113.8");

    // A fresh forged address per attempt no longer buys a fresh bucket...
    expect(statuses[5]).toBe(429);
    // ...while a genuinely different client still has its own.
    expect(otherClient.statusCode).toBe(401);
  });

  it("lets a legitimate login through within the limit", async () => {
    mocks.bcryptCompare.mockResolvedValue(true);
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: loginPayload() });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.token).toBeTypeOf("string");
    expect(json.admin).toMatchObject({ id: 1, email: "admin@example.com", role: "admin" });
    expect(mocks.updateLastLogin).toHaveBeenCalledWith(1);
  });

  it("logs a failed attempt with the email but never the password", async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const app = await buildApp(stream);

    await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: loginPayload({ password: "sup3r-s3cret-pw" }),
    });

    const logged = lines.join("\n");
    expect(logged).toContain("Failed admin login");
    expect(logged).toContain("admin@example.com");
    expect(logged).not.toContain("sup3r-s3cret-pw");
  });
});

/**
 * Spec: the session travels in an httpOnly cookie, so a script injected into the
 * panel cannot read the token. It lives exactly as long as the token itself, is
 * only sent to this API from the same site, and `Secure` in production.
 */
describe("admin session cookie", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    mocks.findByEmail.mockResolvedValue(ACTIVE_ADMIN);
    mocks.bcryptCompare.mockResolvedValue(true);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("hands the token over in an httpOnly, same-site cookie on login", async () => {
    process.env.NODE_ENV = "production";
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: loginPayload() });

    const cookie = String(res.headers["set-cookie"]);
    // __Host- makes the browser refuse the cookie from any other subdomain, so a
    // sibling site cannot plant its own admin_token to shadow this one.
    expect(cookie).toContain(`__Host-admin_token=${res.json().token}`);
    expect(cookie).toMatch(/; HttpOnly/);
    expect(cookie).toMatch(/; SameSite=Strict/);
    expect(cookie).toMatch(/; Secure/);
    expect(cookie).toMatch(/; Path=\//);
    expect(cookie).toMatch(/; Max-Age=86400/);
  });

  it("leaves Secure off outside production, where the panel runs on plain http://localhost", async () => {
    process.env.NODE_ENV = "development";
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: loginPayload() });

    expect(String(res.headers["set-cookie"])).not.toMatch(/Secure/);
  });

  it("sets no cookie when the password is wrong", async () => {
    mocks.bcryptCompare.mockResolvedValue(false);
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: loginPayload() });

    expect(res.statusCode).toBe(401);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("clears the cookie on logout", async () => {
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: "/api/auth/logout" });

    expect(res.statusCode).toBe(204);
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toMatch(/^admin_token=;/);
    expect(cookie).toMatch(/; Max-Age=0/);
    expect(cookie).toMatch(/; HttpOnly/);
  });
});
