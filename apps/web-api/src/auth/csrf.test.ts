import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { originGuard } from "./origin-guard.js";

const ORIGIN = "https://learn.example";

async function app(allowLocalhost = false) {
  const server = Fastify();
  server.addHook("preHandler", originGuard([ORIGIN, "https://second.example"], allowLocalhost));
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

  it("lets a POST from any listed Origin through", async () => {
    const res = await (await app()).inject({
      method: "POST",
      url: "/x",
      headers: { origin: "https://second.example" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("lets a POST from any localhost port through outside production", async () => {
    for (const origin of ["http://localhost:4323", "http://127.0.0.1:5173"]) {
      const res = await (await app(true)).inject({ method: "POST", url: "/x", headers: { origin } });
      expect(res.statusCode).toBe(200);
    }
  });

  it("refuses a localhost Origin in production", async () => {
    const res = await (await app()).inject({ method: "POST", url: "/x", headers: { origin: "http://localhost:4323" } });
    expect(res.statusCode).toBe(403);
  });

  it("refuses a host that only starts like localhost", async () => {
    const res = await (await app(true)).inject({
      method: "POST",
      url: "/x",
      headers: { origin: "http://localhost.evil.example" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("lets a GET through without an Origin", async () => {
    expect((await (await app()).inject({ method: "GET", url: "/x" })).statusCode).toBe(200);
  });
});
