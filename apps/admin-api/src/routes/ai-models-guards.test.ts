import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
  findById: vi.fn(),
  findDefault: vi.fn(),
  findFallback: vi.fn(),
  setDefault: vi.fn(),
  setFallback: vi.fn(),
  delete: vi.fn(),
}));

const planRepo = vi.hoisted(() => ({ findAll: vi.fn() }));

vi.mock("@polyglot/adapter-db", () => ({
  aiModelRepository: repo,
  rateLimitPlanRepository: planRepo,
}));

const { aiModelRoutes } = await import("./ai-models.js");

function model(overrides: Record<string, unknown> = {}) {
  return {
    id: "openai/gpt-5-nano",
    name: "GPT-5 Nano",
    provider: "openai",
    maxTokens: 16384,
    costPer1kInput: 0.0001,
    costPer1kOutput: 0.0004,
    isEnabled: true,
    isDefault: false,
    isFallback: false,
    ...overrides,
  };
}

function plan(overrides: Record<string, unknown> = {}) {
  return { name: "free", label: "Free", isActive: true, isDefault: true, aiModelId: null, ...overrides };
}

async function buildApp(role = "superadmin") {
  const app = Fastify();
  // The unified auth hook (jwtVerify + isActive) runs globally in the real app;
  // here we stand in an admin of the given role to exercise the RBAC preHandler.
  app.addHook("onRequest", async (request) => {
    request.adminUser = { adminId: 1, email: "admin@example.com", role };
  });
  await app.register(aiModelRoutes, { prefix: "/api/settings" });
  return app;
}

async function authedInject(
  method: "DELETE" | "PUT",
  url: string,
  role = "superadmin",
  payload?: Record<string, unknown>,
) {
  const app = await buildApp(role);
  return payload === undefined ? app.inject({ method, url }) : app.inject({ method, url, payload });
}

describe("AI model guards (T11)", () => {
  beforeEach(() => {
    repo.findDefault.mockResolvedValue(model({ id: "other/model", isDefault: true }));
    repo.findFallback.mockResolvedValue(null);
    repo.setDefault.mockResolvedValue(undefined);
    repo.setFallback.mockResolvedValue(undefined);
    repo.delete.mockResolvedValue(undefined);
    planRepo.findAll.mockResolvedValue([plan()]);
  });
  afterEach(() => vi.clearAllMocks());

  it("refuses to delete the current default model with 409", async () => {
    repo.findById.mockResolvedValue(model({ isDefault: true }));

    const res = await authedInject("DELETE", "/api/settings/ai-models/openai%2Fgpt-5-nano");

    expect(res.statusCode).toBe(409);
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it("refuses to delete the current fallback model with 409", async () => {
    repo.findById.mockResolvedValue(model({ isFallback: true }));

    const res = await authedInject("DELETE", "/api/settings/ai-models/openai%2Fgpt-5-nano");

    expect(res.statusCode).toBe(409);
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it("refuses to delete a model a plan is routed to, naming the plan", async () => {
    repo.findById.mockResolvedValue(model());
    planRepo.findAll.mockResolvedValue([plan({ name: "pro", label: "Pro", aiModelId: "openai/gpt-5-nano" })]);

    const res = await authedInject("DELETE", "/api/settings/ai-models/openai%2Fgpt-5-nano");

    expect(res.statusCode).toBe(409);
    // The admin has to know WHICH plan blocks the delete, not just that one does.
    expect(res.json().message).toContain("Pro");
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it("deletes a model that holds no routing role with 204", async () => {
    repo.findById.mockResolvedValue(model());

    const res = await authedInject("DELETE", "/api/settings/ai-models/openai%2Fgpt-5-nano");

    expect(res.statusCode).toBe(204);
    expect(repo.delete).toHaveBeenCalledWith("openai/gpt-5-nano");
  });

  it("rejects set-default on a disabled model with 409 and does not switch the default", async () => {
    repo.findById.mockResolvedValue(model({ isEnabled: false }));

    const res = await authedInject("PUT", "/api/settings/ai-models/openai%2Fgpt-5-nano/set-default");

    expect(res.statusCode).toBe(409);
    expect(repo.setDefault).not.toHaveBeenCalled();
  });

  it("rejects set-default on a missing model with 404", async () => {
    repo.findById.mockResolvedValue(null);

    const res = await authedInject("PUT", "/api/settings/ai-models/nope%2Fmodel/set-default");

    expect(res.statusCode).toBe(404);
    expect(repo.setDefault).not.toHaveBeenCalled();
  });

  it("sets an enabled model as default", async () => {
    repo.findById.mockResolvedValue(model({ isEnabled: true, isDefault: false }));

    const res = await authedInject("PUT", "/api/settings/ai-models/openai%2Fgpt-5-nano/set-default");

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
    expect(repo.setDefault).toHaveBeenCalledWith("openai/gpt-5-nano");
  });

  it("sets an enabled model as the failover model", async () => {
    repo.findById.mockResolvedValue(model({ isEnabled: true }));

    const res = await authedInject("PUT", "/api/settings/ai-models/fallback", "superadmin", {
      modelId: "openai/gpt-5-nano",
    });

    expect(res.statusCode).toBe(200);
    expect(repo.setFallback).toHaveBeenCalledWith("openai/gpt-5-nano");
  });

  it("clears the failover model when modelId is null", async () => {
    // An admin must be able to turn failover off; the bot then runs a single
    // unsplit attempt on the primary rather than reserving a window for nothing.
    const res = await authedInject("PUT", "/api/settings/ai-models/fallback", "superadmin", { modelId: null });

    expect(res.statusCode).toBe(200);
    expect(repo.setFallback).toHaveBeenCalledWith(null);
  });

  it("rejects a disabled model as the failover model with 409", async () => {
    repo.findById.mockResolvedValue(model({ isEnabled: false }));

    const res = await authedInject("PUT", "/api/settings/ai-models/fallback", "superadmin", {
      modelId: "openai/gpt-5-nano",
    });

    expect(res.statusCode).toBe(409);
    expect(repo.setFallback).not.toHaveBeenCalled();
  });

  it("forbids a non-superadmin from deleting a model with 403 (RBAC, T07)", async () => {
    repo.findById.mockResolvedValue(model({ isDefault: false }));

    const res = await authedInject("DELETE", "/api/settings/ai-models/openai%2Fgpt-5-nano", "admin");

    expect(res.statusCode).toBe(403);
    expect(repo.findById).not.toHaveBeenCalled();
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it("forbids a non-superadmin from changing the default model with 403", async () => {
    repo.findById.mockResolvedValue(model({ isEnabled: true, isDefault: false }));

    const res = await authedInject("PUT", "/api/settings/ai-models/openai%2Fgpt-5-nano/set-default", "admin");

    expect(res.statusCode).toBe(403);
    expect(repo.setDefault).not.toHaveBeenCalled();
  });

  it("forbids a non-superadmin from changing the failover model with 403", async () => {
    const res = await authedInject("PUT", "/api/settings/ai-models/fallback", "admin", {
      modelId: "openai/gpt-5-nano",
    });

    expect(res.statusCode).toBe(403);
    expect(repo.setFallback).not.toHaveBeenCalled();
  });
});
