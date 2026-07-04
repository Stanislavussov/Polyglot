import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { installErrorHandler } from "../error-handler.js";
import { paginationQuerySchema, registerCrudRoutes } from "./crud-factory.js";

async function buildListApp() {
  const app = Fastify();
  installErrorHandler(app);
  // Two independent resources wired through the same factory: their list query
  // validation must behave identically (Fable T27/T08 — no per-route drift).
  for (const resource of ["widgets", "gadgets"]) {
    registerCrudRoutes(app, {
      resource,
      list: {
        querySchema: paginationQuerySchema(),
        handler: (query) => Promise.resolve(query),
      },
    });
  }
  return app;
}

describe("registerCrudRoutes query validation (T27/T08)", () => {
  it("clamps an oversized limit identically across factory-built resources", async () => {
    const app = await buildListApp();

    for (const resource of ["widgets", "gadgets"]) {
      const res = await app.inject({ method: "GET", url: `/${resource}?limit=100000` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ page: 1, limit: 100 });
    }

    await app.close();
  });

  it("rejects a non-numeric limit with a safe 400 across resources", async () => {
    const app = await buildListApp();

    for (const resource of ["widgets", "gadgets"]) {
      const res = await app.inject({ method: "GET", url: `/${resource}?limit=abc` });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "Invalid request parameters" });
    }

    await app.close();
  });

  it("applies the same defaults when query params are omitted", async () => {
    const app = await buildListApp();

    for (const resource of ["widgets", "gadgets"]) {
      const res = await app.inject({ method: "GET", url: `/${resource}` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ page: 1, limit: 20 });
    }

    await app.close();
  });

  it("wires create (201) and delete (204) with consistent status codes", async () => {
    const app = Fastify();
    installErrorHandler(app);
    const created: unknown[] = [];
    const removed: string[] = [];
    registerCrudRoutes(app, {
      resource: "things",
      keyParam: "name",
      list: { handler: () => Promise.resolve(created) },
      create: {
        schema: z.object({ name: z.string().min(1) }),
        handler: (body) => {
          created.push(body);
          return Promise.resolve(body);
        },
      },
      remove: {
        handler: (name) => {
          removed.push(name);
          return Promise.resolve();
        },
      },
    });

    const createRes = await app.inject({ method: "POST", url: "/things", payload: { name: "a" } });
    expect(createRes.statusCode).toBe(201);

    const delRes = await app.inject({ method: "DELETE", url: "/things/a" });
    expect(delRes.statusCode).toBe(204);
    expect(removed).toEqual(["a"]);

    await app.close();
  });
});
