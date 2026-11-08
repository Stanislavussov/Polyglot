import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { originGuard } from "./origin-guard.js";

const ORIGIN = "https://learn.example";

async function app() {
  const server = Fastify();
  server.addHook("preHandler", originGuard(ORIGIN));
  server.get("/x", async () => "ok");
  server.post("/x", async () => "ok");
  return server;
}

describe("originGuard", () => {
  it("refuses a POST without an Origin header", async () => {
    expect((await (await app()).inject({ method: "POST", url: "/x" })).statusCode).toBe(403);
  });

  it("refuses a POST from a foreign Origin", async () => {
    const res = await (await app()).inject({ method: "POST", url: "/x", headers: { origin: "https://evil.example" } });
    expect(res.statusCode).toBe(403);
  });

  it("lets a POST from the app Origin through", async () => {
    const res = await (await app()).inject({ method: "POST", url: "/x", headers: { origin: ORIGIN } });
    expect(res.statusCode).toBe(200);
  });

  it("lets a GET through without an Origin", async () => {
    expect((await (await app()).inject({ method: "GET", url: "/x" })).statusCode).toBe(200);
  });
});
