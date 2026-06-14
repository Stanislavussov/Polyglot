import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  const select = vi.fn((selection?: { count?: unknown }) => {
    if (selection?.count !== undefined) {
      return {
        from: vi.fn(() => Promise.resolve([{ count: userRows.length }])),
      };
    }

    const query = Promise.resolve(userRows);
    const queryWithWhere = query as Promise<typeof userRows> & {
      where: ReturnType<typeof vi.fn>;
    };
    queryWithWhere.where = vi.fn(() => Promise.resolve(userRows));

    return {
      from: vi.fn(() => ({
        leftJoin: vi.fn(() => ({
          limit: vi.fn(() => ({
            offset: vi.fn(() => queryWithWhere),
          })),
        })),
      })),
    };
  });

  return {
    findByName,
    getDb: vi.fn(() => ({ select })),
    select,
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
  await app.register(userRoutes);
  return app;
}

describe("userRoutes", () => {
  beforeEach(() => {
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
});
