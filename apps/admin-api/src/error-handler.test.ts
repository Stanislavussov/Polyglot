import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { installErrorHandler } from "./error-handler.js";

async function buildApp() {
  const app = Fastify();
  installErrorHandler(app);

  app.get("/zod", async () => {
    // A validation failure raised from a handler, exactly as the real routes do.
    z.object({ days: z.coerce.number().int() }).parse({ days: "abc" });
    return { ok: true };
  });

  app.get("/boom", async () => {
    throw new Error("secret db connection string leaked here");
  });

  app.get("/conflict", async () => {
    const err = new Error("Already the default model") as Error & { statusCode: number };
    err.statusCode = 409;
    throw err;
  });

  return app;
}

describe("installErrorHandler", () => {
  it("maps a thrown ZodError to 400 with a body free of ZodError internals", async () => {
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/zod" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid request parameters" });
    // The schema path / issue array must not surface to the client.
    expect(res.body).not.toContain("days");
    expect(res.body).not.toContain("issues");
    await app.close();
  });

  it("hides 5xx internals behind a generic message", async () => {
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/boom" });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "Internal Server Error" });
    expect(res.body).not.toContain("secret db connection string");
    await app.close();
  });

  it("passes through a safe 4xx status and message", async () => {
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/conflict" });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "Already the default model" });
    await app.close();
  });
});
