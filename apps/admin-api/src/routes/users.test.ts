import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installErrorHandler } from "../error-handler.js";

const mocks = vi.hoisted(() => {
  const userRows = [
    {
      id: 1,
      telegramId: 123456,
      username: "tester",
      audienceGroup: "tester",
      subscriptionPlan: "free",
      isActive: true,
      createdAt: new Date("2026-06-14T00:00:00Z"),
      interfaceLang: "en",
      nativeLang: "cs",
      learningLangs: ["en"],
    },
  ];

  return {
    userRows,
    listAdmin: vi.fn(),
    updatePlan: vi.fn(),
    updateAudienceGroup: vi.fn(),
    findByName: vi.fn(),
  };
});

vi.mock("@polyglot/adapter-db", () => ({
  rateLimitPlanRepository: { findByName: mocks.findByName },
  userRepository: {
    listAdmin: mocks.listAdmin,
    updatePlan: mocks.updatePlan,
    updateAudienceGroup: mocks.updateAudienceGroup,
  },
}));

const { userRoutes } = await import("./users.js");

async function buildApp(role = "superadmin") {
  const app = Fastify();
  installErrorHandler(app);
  // The unified auth hook runs in the real app; here we stand in an admin of the
  // given role so the RBAC-gated routes (plan / audience-group) are reachable.
  app.addHook("onRequest", async (request) => {
    request.adminUser = { adminId: 1, email: "admin@example.com", role };
  });
  await app.register(userRoutes);
  return app;
}

describe("userRoutes", () => {
  beforeEach(() => {
    mocks.listAdmin.mockResolvedValue({ users: mocks.userRows, total: mocks.userRows.length });
    mocks.updateAudienceGroup.mockResolvedValue({
      id: 1,
      telegramId: 123456,
      username: "tester",
      audienceGroup: "admin",
      subscriptionPlan: "free",
      onboardingStep: 3,
      onboarded: true,
      isActive: true,
      createdAt: new Date("2026-06-14T00:00:00Z"),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("includes audienceGroup in the users list", async () => {
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/users" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      users: [{ id: 1, audienceGroup: "tester" }],
      total: 1,
      page: 1,
      limit: 20,
    });
    await app.close();
  });

  it("updates a user audience group", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "PUT",
      url: "/users/1/audience-group",
      payload: { audienceGroup: "admin" },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.updateAudienceGroup).toHaveBeenCalledWith(1, "admin");
    await app.close();
  });

  it("returns 400 for invalid audience group values", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "PUT",
      url: "/users/1/audience-group",
      payload: { audienceGroup: "segment" },
    });

    expect(response.statusCode).toBe(400);
    expect(mocks.updateAudienceGroup).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects a non-numeric limit with 400 (not 500) and a safe body", async () => {
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/users?limit=abc" });

    expect(response.statusCode).toBe(400);
    // No ZodError internals (issues, schema paths) leak to the client.
    expect(response.json()).toEqual({ error: "Invalid request parameters" });
    expect(mocks.listAdmin).not.toHaveBeenCalled();
    await app.close();
  });

  it("clamps an oversized limit instead of dumping the whole table", async () => {
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/users?limit=100000" });

    // limit above the 100 ceiling is clamped down, never returning everything.
    expect(response.statusCode).toBe(200);
    expect(response.json().limit).toBe(100);
    expect(mocks.listAdmin).toHaveBeenCalledWith({ page: 1, limit: 100, search: undefined });
    await app.close();
  });

  it("forwards the search filter and returns the repo's consistent total", async () => {
    // The repository counts with the same filter as the page selection, so the
    // total stays consistent with the returned page (Fable T08).
    mocks.listAdmin.mockResolvedValueOnce({ users: [], total: 0 });
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/users?search=nobody&page=1&limit=20" });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(mocks.listAdmin).toHaveBeenCalledWith({ page: 1, limit: 20, search: "nobody" });
    expect(json.total).toBe(json.users.length);
    expect(json.total).toBe(0);
    await app.close();
  });

  it("reports the full total when no search filter is applied", async () => {
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/users" });

    expect(response.statusCode).toBe(200);
    expect(response.json().total).toBe(mocks.userRows.length);
    await app.close();
  });

  it("forbids a non-superadmin from changing a user's audience group with 403", async () => {
    const app = await buildApp("admin");

    const response = await app.inject({
      method: "PUT",
      url: "/users/1/audience-group",
      payload: { audienceGroup: "admin" },
    });

    expect(response.statusCode).toBe(403);
    expect(mocks.updateAudienceGroup).not.toHaveBeenCalled();
    await app.close();
  });
});
