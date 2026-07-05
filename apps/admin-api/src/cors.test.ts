import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAdminApiApp, resolveCorsOrigins } from "./index.js";

describe("resolveCorsOrigins (D6: gate the dev origin in production)", () => {
  it("adds the localhost dev origin outside production", () => {
    const origins = resolveCorsOrigins({
      ADMIN_PANEL_URL: "https://admin.polyglot.monster",
      NODE_ENV: "development",
    } as NodeJS.ProcessEnv);
    expect(origins).toContain("https://admin.polyglot.monster");
    expect(origins).toContain("http://localhost:4321");
  });

  it("allows ONLY the configured origin in production (no localhost)", () => {
    const origins = resolveCorsOrigins({
      ADMIN_PANEL_URL: "https://admin.polyglot.monster",
      NODE_ENV: "production",
    } as NodeJS.ProcessEnv);
    expect(origins).toEqual(["https://admin.polyglot.monster"]);
    expect(origins).not.toContain("http://localhost:4321");
  });

  it("supports multiple configured origins and de-dupes", () => {
    const origins = resolveCorsOrigins({
      ADMIN_PANEL_URL: "https://a.example, https://b.example, https://a.example",
      NODE_ENV: "production",
    } as NodeJS.ProcessEnv);
    expect(origins).toEqual(["https://a.example", "https://b.example"]);
  });
});

const originalAdminPanelUrl = process.env.ADMIN_PANEL_URL;
const originalJwtSecret = process.env.JWT_SECRET;

describe("admin API CORS", () => {
  beforeEach(() => {
    process.env.ADMIN_PANEL_URL = "https://admin.polyglot.monster";
    process.env.JWT_SECRET = "test-secret";
  });

  afterEach(() => {
    process.env.ADMIN_PANEL_URL = originalAdminPanelUrl;
    process.env.JWT_SECRET = originalJwtSecret;
  });

  it("allows PUT preflight requests from the admin panel", async () => {
    const app = await buildAdminApiApp();

    try {
      const response = await app.inject({
        method: "OPTIONS",
        url: "/api/settings/ai-models/google%2Fgemini-2.5-flash-lite-preview-09-2025/set-default",
        headers: {
          origin: "https://admin.polyglot.monster",
          "access-control-request-method": "PUT",
          "access-control-request-headers": "authorization,content-type",
        },
      });

      expect(response.statusCode).toBe(204);
      expect(response.headers["access-control-allow-origin"]).toBe("https://admin.polyglot.monster");
      expect(String(response.headers["access-control-allow-methods"])).toContain("PUT");
    } finally {
      await app.close();
    }
  });

  it("routes encoded slash model ids before auth checks", async () => {
    const app = await buildAdminApiApp();

    try {
      const response = await app.inject({
        method: "DELETE",
        url: "/api/settings/ai-models/google%2Fgemini-3.5-flash",
      });

      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
