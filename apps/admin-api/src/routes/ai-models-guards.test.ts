import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
  findByIdWithPlans: vi.fn(),
  findDefault: vi.fn(),
  setDefault: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@polyglot/adapter-db", () => ({
  aiModelRepository: repo,
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
    allowedPlans: [],
    ...overrides,
  };
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

async function authedInject(method: "DELETE" | "PUT", url: string, role = "superadmin") {
  const app = await buildApp(role);
  return app.inject({ method, url });
}

describe("AI model guards (T11)", () => {
  beforeEach(() => {
    repo.findDefault.mockResolvedValue(model({ id: "other/model", isDefault: true }));
    repo.setDefault.mockResolvedValue(undefined);
    repo.delete.mockResolvedValue(undefined);
  });
  afterEach(() => vi.clearAllMocks());

  it("refuses to delete the current default model with 409", async () => {
    repo.findByIdWithPlans.mockResolvedValue(model({ isDefault: true }));

    const res = await authedInject("DELETE", "/api/settings/ai-models/openai%2Fgpt-5-nano");

    expect(res.statusCode).toBe(409);
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it("deletes a non-default model with 204", async () => {
    repo.findByIdWithPlans.mockResolvedValue(model({ isDefault: false }));

    const res = await authedInject("DELETE", "/api/settings/ai-models/openai%2Fgpt-5-nano");

    expect(res.statusCode).toBe(204);
    expect(repo.delete).toHaveBeenCalledWith("openai/gpt-5-nano");
  });

  it("rejects set-default on a disabled model with 409 and does not switch the default", async () => {
    repo.findByIdWithPlans.mockResolvedValue(model({ isEnabled: false }));

    const res = await authedInject("PUT", "/api/settings/ai-models/openai%2Fgpt-5-nano/set-default");

    expect(res.statusCode).toBe(409);
    expect(repo.setDefault).not.toHaveBeenCalled();
  });

  it("rejects set-default on a missing model with 404", async () => {
    repo.findByIdWithPlans.mockResolvedValue(null);

    const res = await authedInject("PUT", "/api/settings/ai-models/nope%2Fmodel/set-default");

    expect(res.statusCode).toBe(404);
    expect(repo.setDefault).not.toHaveBeenCalled();
  });

  it("sets an enabled model as default", async () => {
    repo.findByIdWithPlans.mockResolvedValue(model({ isEnabled: true, isDefault: false }));

    const res = await authedInject("PUT", "/api/settings/ai-models/openai%2Fgpt-5-nano/set-default");

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
    expect(repo.setDefault).toHaveBeenCalledWith("openai/gpt-5-nano");
  });

  it("forbids a non-superadmin from deleting a model with 403 (RBAC, T07)", async () => {
    repo.findByIdWithPlans.mockResolvedValue(model({ isDefault: false }));

    const res = await authedInject("DELETE", "/api/settings/ai-models/openai%2Fgpt-5-nano", "admin");

    expect(res.statusCode).toBe(403);
    expect(repo.findByIdWithPlans).not.toHaveBeenCalled();
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it("forbids a non-superadmin from changing the default model with 403", async () => {
    repo.findByIdWithPlans.mockResolvedValue(model({ isEnabled: true, isDefault: false }));

    const res = await authedInject("PUT", "/api/settings/ai-models/openai%2Fgpt-5-nano/set-default", "admin");

    expect(res.statusCode).toBe(403);
    expect(repo.setDefault).not.toHaveBeenCalled();
  });
});
