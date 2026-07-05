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
  const app = Fastify(logStream ? { logger: { level: "warn", stream: logStream } } : { logger: false });
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
