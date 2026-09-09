import type { FastifyBaseLogger } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
  findAll: vi.fn(),
  findById: vi.fn(),
  findDefault: vi.fn(),
  findFallback: vi.fn(),
  setDefault: vi.fn(),
  setFallback: vi.fn(),
  upsert: vi.fn(),
  delete: vi.fn(),
}));

const planRepo = vi.hoisted(() => ({ findAll: vi.fn() }));

vi.mock("@polyglot/adapter-db", () => ({ aiModelRepository: repo, rateLimitPlanRepository: planRepo }));

const { aiModelService } = await import("./ai-model.service.js");

const logger = { info: vi.fn() } as unknown as FastifyBaseLogger;
const actor = { adminId: 1, email: "admin@example.com", role: "superadmin" };

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

describe("aiModelService invariants (T11/T27)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repo.findDefault.mockResolvedValue(model({ id: "other/model", isDefault: true }));
    repo.findFallback.mockResolvedValue(null);
    repo.setDefault.mockResolvedValue(undefined);
    repo.setFallback.mockResolvedValue(undefined);
    repo.delete.mockResolvedValue(undefined);
    repo.upsert.mockImplementation(async (data: Record<string, unknown>) => data);
    planRepo.findAll.mockResolvedValue([plan()]);
  });

  it("refuses to delete the current default model and never touches the repository", async () => {
    repo.findById.mockResolvedValue(model({ isDefault: true }));

    await expect(aiModelService.remove("openai/gpt-5-nano", logger, actor)).rejects.toMatchObject({ statusCode: 409 });
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it("refuses to delete the current fallback model", async () => {
    repo.findById.mockResolvedValue(model({ isFallback: true }));

    await expect(aiModelService.remove("openai/gpt-5-nano", logger, actor)).rejects.toMatchObject({ statusCode: 409 });
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it("refuses to delete a model a plan is routed to", async () => {
    repo.findById.mockResolvedValue(model());
    planRepo.findAll.mockResolvedValue([plan({ name: "pro", label: "Pro", aiModelId: "openai/gpt-5-nano" })]);

    await expect(aiModelService.remove("openai/gpt-5-nano", logger, actor)).rejects.toMatchObject({ statusCode: 409 });
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it("deletes a model that holds no routing role", async () => {
    repo.findById.mockResolvedValue(model());

    await aiModelService.remove("openai/gpt-5-nano", logger, actor);
    expect(repo.delete).toHaveBeenCalledWith("openai/gpt-5-nano");
  });

  it("rejects set-default on a disabled model and does not switch the default", async () => {
    repo.findById.mockResolvedValue(model({ isEnabled: false }));

    await expect(aiModelService.setDefault("openai/gpt-5-nano", logger, actor)).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(repo.setDefault).not.toHaveBeenCalled();
  });

  it("rejects set-default on a missing model with 404", async () => {
    repo.findById.mockResolvedValue(null);

    await expect(aiModelService.setDefault("nope/model", logger, actor)).rejects.toMatchObject({ statusCode: 404 });
    expect(repo.setDefault).not.toHaveBeenCalled();
  });

  it("sets an enabled model as default", async () => {
    repo.findById.mockResolvedValue(model({ isEnabled: true, isDefault: false }));

    await aiModelService.setDefault("openai/gpt-5-nano", logger, actor);
    expect(repo.setDefault).toHaveBeenCalledWith("openai/gpt-5-nano");
  });

  it("rejects a disabled model as fallback — failover must not point at a model we may not call", async () => {
    repo.findById.mockResolvedValue(model({ isEnabled: false }));

    await expect(aiModelService.setFallback("openai/gpt-5-nano", logger, actor)).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(repo.setFallback).not.toHaveBeenCalled();
  });

  it("rejects a missing model as fallback with 404", async () => {
    repo.findById.mockResolvedValue(null);

    await expect(aiModelService.setFallback("nope/model", logger, actor)).rejects.toMatchObject({ statusCode: 404 });
    expect(repo.setFallback).not.toHaveBeenCalled();
  });

  it("sets an enabled model as fallback", async () => {
    repo.findById.mockResolvedValue(model({ isEnabled: true }));

    await aiModelService.setFallback("openai/gpt-5-nano", logger, actor);
    expect(repo.setFallback).toHaveBeenCalledWith("openai/gpt-5-nano");
  });

  it("clears the fallback without touching the model lookup", async () => {
    await aiModelService.setFallback(null, logger, actor);

    expect(repo.setFallback).toHaveBeenCalledWith(null);
    expect(repo.findById).not.toHaveBeenCalled();
  });

  it("refuses to disable a model that still holds a routing role", async () => {
    // Disabling is the back door into "role points at a model the bot may not
    // call": the role reads filter on is_enabled, so the plan would silently
    // slide onto the global default with nothing in the UI saying so.
    repo.findById.mockResolvedValue(model({ isDefault: true }));

    await expect(aiModelService.update("openai/gpt-5-nano", { isEnabled: false }, logger, actor)).rejects.toMatchObject(
      { statusCode: 409 },
    );
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it("disables a model that holds no routing role", async () => {
    repo.findById.mockResolvedValue(model());

    await aiModelService.update("openai/gpt-5-nano", { isEnabled: false }, logger, actor);
    expect(repo.upsert).toHaveBeenCalledWith(expect.objectContaining({ isEnabled: false }));
  });
});
