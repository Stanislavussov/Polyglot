import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const planRepo = vi.hoisted(() => ({
  findAll: vi.fn(),
  upsert: vi.fn(),
  delete: vi.fn(),
}));

const featureRepo = vi.hoisted(() => ({
  findFeaturesForPlan: vi.fn(),
  setFeaturesForPlan: vi.fn(),
}));

const modelRepo = vi.hoisted(() => ({ findById: vi.fn() }));

vi.mock("@polyglot/adapter-db", () => ({
  rateLimitPlanRepository: planRepo,
  planFeatureAccessRepository: featureRepo,
  aiModelRepository: modelRepo,
}));

const { rateLimitRoutes } = await import("./rate-limits.js");
const { installErrorHandler } = await import("../error-handler.js");

function plan(overrides: Record<string, unknown> = {}) {
  return {
    name: "plus",
    label: "Plus",
    translationLimit: null,
    creditCost: 1,
    videoLimit: 20,
    videoWindow: "monthly",
    mentorDailyLimit: 30,
    priceUsdCents: 500,
    isActive: true,
    isDefault: false,
    aiModelId: null,
    ...overrides,
  };
}

async function buildApp(role = "superadmin") {
  const app = Fastify();
  installErrorHandler(app);
  app.decorateRequest("jwtVerify", async () => undefined);
  app.addHook("preHandler", async (request) => {
    request.adminUser = { adminId: 1, email: "admin@example.com", role };
  });
  await app.register(rateLimitRoutes);
  return app;
}

beforeEach(() => {
  planRepo.upsert.mockImplementation(async (body: Record<string, unknown>) => body);
  featureRepo.setFeaturesForPlan.mockResolvedValue(undefined);
  featureRepo.findFeaturesForPlan.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /rate-limits", () => {
  it("attaches each plan's unlocked features from the junction", async () => {
    planRepo.findAll.mockResolvedValue([plan()]);
    featureRepo.findFeaturesForPlan.mockResolvedValue(["clarification", "mentor"]);
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/rate-limits" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ ...plan(), features: ["clarification", "mentor"] }]);
  });
});

describe("PUT /rate-limits", () => {
  it("persists the feature set through the junction and returns it on the plan", async () => {
    featureRepo.findFeaturesForPlan.mockResolvedValue(["mentor", "clarification"]);
    const app = await buildApp();

    const res = await app.inject({
      method: "PUT",
      url: "/rate-limits",
      payload: { ...plan(), features: ["clarification", "mentor"] },
    });

    expect(res.statusCode).toBe(200);
    expect(featureRepo.setFeaturesForPlan).toHaveBeenCalledWith("plus", ["clarification", "mentor"]);
    // The response reflects what the junction now holds, not what the caller sent.
    expect(res.json().features).toEqual(["mentor", "clarification"]);
  });

  it("leaves the junction untouched when the body has no features field", async () => {
    // The AI Models page routes a plan to a model by upserting the whole plan —
    // an omitted field must mean "don't touch", never "clear everything".
    featureRepo.findFeaturesForPlan.mockResolvedValue(["mentor"]);
    const app = await buildApp();

    const res = await app.inject({ method: "PUT", url: "/rate-limits", payload: plan() });

    expect(res.statusCode).toBe(200);
    expect(featureRepo.setFeaturesForPlan).not.toHaveBeenCalled();
    expect(res.json().features).toEqual(["mentor"]);
  });

  it("clears the junction when an explicit empty list is sent", async () => {
    const app = await buildApp();

    const res = await app.inject({ method: "PUT", url: "/rate-limits", payload: { ...plan(), features: [] } });

    expect(res.statusCode).toBe(200);
    expect(featureRepo.setFeaturesForPlan).toHaveBeenCalledWith("plus", []);
  });

  it("rejects a feature key the bot does not know", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "PUT",
      url: "/rate-limits",
      payload: { ...plan(), features: ["timeTravel"] },
    });

    expect(res.statusCode).toBe(400);
    expect(planRepo.upsert).not.toHaveBeenCalled();
    expect(featureRepo.setFeaturesForPlan).not.toHaveBeenCalled();
  });

  it("deduplicates repeated keys before writing the junction", async () => {
    const app = await buildApp();

    await app.inject({
      method: "PUT",
      url: "/rate-limits",
      payload: { ...plan(), features: ["mentor", "mentor", "clarification"] },
    });

    expect(featureRepo.setFeaturesForPlan).toHaveBeenCalledWith("plus", ["mentor", "clarification"]);
  });

  it("stays superadmin-only", async () => {
    const app = await buildApp("admin");

    const res = await app.inject({ method: "PUT", url: "/rate-limits", payload: { ...plan(), features: ["mentor"] } });

    expect(res.statusCode).toBe(403);
    expect(planRepo.upsert).not.toHaveBeenCalled();
    expect(featureRepo.setFeaturesForPlan).not.toHaveBeenCalled();
  });
});
