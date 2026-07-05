import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { baseEnvSchema, botEnvSchema, ConfigError, loadConfig } from "./config.js";

// Skip .env discovery so the tests control process.env exclusively and never
// pick up a developer's real .env (which carries a BOT_TOKEN).
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: () => false };
});

describe("composable env schema (Fable T24/A18)", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.BOT_TOKEN;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.BETTERSTACK_TOKEN;
    process.env.DATABASE_URL = "postgres://localhost/test";
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it("loads a channel-less (admin/worker) config without BOT_TOKEN", () => {
    const cfg = loadConfig(baseEnvSchema);
    expect(cfg.DATABASE_URL).toBe("postgres://localhost/test");
    expect(cfg.NODE_ENV).toBe("test");
    expect("BOT_TOKEN" in cfg).toBe(false);
  });

  it("defaults to the base schema when none is passed", () => {
    const cfg = loadConfig();
    expect(cfg.DATABASE_URL).toBe("postgres://localhost/test");
  });

  it("still requires BOT_TOKEN for the bot config", () => {
    expect(() => loadConfig(botEnvSchema)).toThrow(ConfigError);
  });

  it("loads the bot config when BOT_TOKEN is present", () => {
    process.env.BOT_TOKEN = "123456:token";
    const cfg = loadConfig(botEnvSchema);
    expect(cfg.BOT_TOKEN).toBe("123456:token");
    expect(cfg.DATABASE_URL).toBe("postgres://localhost/test");
  });

  it("throws a typed ConfigError (never exits) on invalid env", () => {
    delete process.env.DATABASE_URL;
    try {
      loadConfig(baseEnvSchema);
      expect.unreachable("expected loadConfig to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).issues).toBeDefined();
    }
  });
});
