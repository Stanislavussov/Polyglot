import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const base = { BOT_TOKEN: "1:x", BOT_USERNAME: "polyglot_bot", WEB_JWT_SECRET: "s".repeat(32) };

describe("loadConfig", () => {
  it("refuses to boot without WEB_JWT_SECRET", () => {
    expect(() => loadConfig({ ...base, WEB_JWT_SECRET: "" })).toThrow(/WEB_JWT_SECRET/);
  });

  it("refuses a short WEB_JWT_SECRET", () => {
    expect(() => loadConfig({ ...base, WEB_JWT_SECRET: "short" })).toThrow(/at least/);
  });

  it("refuses to boot without BOT_TOKEN", () => {
    expect(() => loadConfig({ ...base, BOT_TOKEN: undefined })).toThrow(/BOT_TOKEN/);
  });

  it("requires WEB_APP_ORIGIN in production", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production" })).toThrow(/WEB_APP_ORIGIN/);
  });

  it("defaults the dev origin to the local web server", () => {
    expect(loadConfig(base).appOrigin).toBe("http://localhost:4322");
  });

  it("ignores WEB_DEV_USER_ID in production", () => {
    const env = { ...base, NODE_ENV: "production", WEB_APP_ORIGIN: "https://x", WEB_DEV_USER_ID: "1" };
    expect(loadConfig(env).devUserId).toBeNull();
  });

  it("enables the dev login outside production", () => {
    expect(loadConfig({ ...base, WEB_DEV_USER_ID: "1" }).devUserId).toBe(1);
  });
});
