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

  const updateAudienceGroup = vi.fn();
  const findByName = vi.fn();

  // Rows returned once a search filter is applied. Defaults to all rows (a filter
  // that matches everything); a test can shrink it to prove the count query honours
  // the same filter as the page selection.
  const state = { searchRows: userRows as typeof userRows };

  const select = vi.fn((selection?: { count?: unknown }) => {
    const isCount = selection?.count !== undefined;
    let filtered = false;
    const builder = {
      from: () => builder,
      leftJoin: () => builder,
      where: (filter?: unknown) => {
        filtered = filter !== undefined;
        return builder;
      },
      limit: () => builder,
      offset: () => builder,
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
        const rows = filtered ? state.searchRows : userRows;
        const value = isCount ? [{ count: rows.length }] : rows;
        return Promise.resolve(value).then(resolve, reject);
      },
    };
    return builder;
  });

  return {
    findByName,
    getDb: vi.fn(() => ({ select })),
    select,
    state,
    updateAudienceGroup,
    userRows,
  };
});

vi.mock("@polyglot/adapter-db", () => ({
  AUDIENCE_GROUPS: ["admin", "tester", "product"],
  getDb: mocks.getDb,
  rateLimitPlanRepository: { findByName: mocks.findByName },
  userLanguageSettings: {
    interfaceLang: "interfaceLang",
    learningLangs: "learningLangs",
    nativeLang: "nativeLang",
    userId: "userId",
  },
  userRepository: { updateAudienceGroup: mocks.updateAudienceGroup },
  users: {
    audienceGroup: "audienceGroup",
    createdAt: "createdAt",
    id: "id",
    isActive: "isActive",
    subscriptionPlan: "subscriptionPlan",
    telegramId: "telegramId",
    username: "username",
  },
}));

const { userRoutes } = await import("./users.js");

async function buildApp() {
  const app = Fastify();
  app.decorateRequest("jwtVerify", async () => undefined);
  installErrorHandler(app);
  await app.register(userRoutes);
  return app;
}

describe("userRoutes", () => {
  beforeEach(() => {
    mocks.state.searchRows = mocks.userRows;
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
    await app.close();
  });

  it("clamps an oversized limit instead of dumping the whole table", async () => {
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/users?limit=100000" });

    // limit above the 100 ceiling is clamped down, never returning everything.
    expect(response.statusCode).toBe(200);
    expect(response.json().limit).toBe(100);
    await app.close();
  });

  it("counts with the same search filter so total stays consistent with the page", async () => {
    mocks.state.searchRows = [];
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/users?search=nobody&page=1&limit=20" });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    // Pre-fix the count ignored the filter and reported the full table size.
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
});
