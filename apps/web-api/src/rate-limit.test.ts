import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildWebApiApp } from "./app.js";
import type { WebServices } from "./services.js";

describe("rate limit", () => {
  it("never limits static files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "static-"));
    writeFileSync(join(dir, "app.js"), "1");
    const app = await buildWebApiApp({} as WebServices, {
      port: 0,
      host: "127.0.0.1",
      production: false,
      botToken: "1:x",
      jwtSecret: "s".repeat(32),
      appOrigin: "http://x",
      staticDir: dir,
      devUserId: null,
      botUsername: "test_bot",
    });
    const statuses = new Set<number>();
    for (let i = 0; i < 150; i++) statuses.add((await app.inject({ url: "/app.js" })).statusCode);
    expect([...statuses]).toEqual([200]);
  });
});
