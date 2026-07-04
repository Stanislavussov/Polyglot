import type { FastifyBaseLogger } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
  findAll: vi.fn(),
  findByIdWithPlans: vi.fn(),
  findDefault: vi.fn(),
  setDefault: vi.fn(),
  upsert: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@polyglot/adapter-db", () => ({ aiModelRepository: repo }));

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
    allowedPlans: [],
    ...overrides,
  };
}

describe("aiModelService invariants (T11/T27)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repo.findDefault.mockResolvedValue(model({ id: "other/model", isDefault: true }));
    repo.setDefault.mockResolvedValue(undefined);
    repo.delete.mockResolvedValue(undefined);
  });

  it("refuses to delete the current default model and never touches the repository", async () => {
    repo.findByIdWithPlans.mockResolvedValue(model({ isDefault: true }));

    await expect(aiModelService.remove("openai/gpt-5-nano", logger, actor)).rejects.toMatchObject({ statusCode: 409 });
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it("deletes a non-default model", async () => {
    repo.findByIdWithPlans.mockResolvedValue(model({ isDefault: false }));

    await aiModelService.remove("openai/gpt-5-nano", logger, actor);
    expect(repo.delete).toHaveBeenCalledWith("openai/gpt-5-nano");
  });

  it("rejects set-default on a disabled model and does not switch the default", async () => {
    repo.findByIdWithPlans.mockResolvedValue(model({ isEnabled: false }));

    await expect(aiModelService.setDefault("openai/gpt-5-nano", logger, actor)).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(repo.setDefault).not.toHaveBeenCalled();
  });

  it("rejects set-default on a missing model with 404", async () => {
    repo.findByIdWithPlans.mockResolvedValue(null);

    await expect(aiModelService.setDefault("nope/model", logger, actor)).rejects.toMatchObject({ statusCode: 404 });
    expect(repo.setDefault).not.toHaveBeenCalled();
  });

  it("sets an enabled model as default", async () => {
    repo.findByIdWithPlans.mockResolvedValue(model({ isEnabled: true, isDefault: false }));

    await aiModelService.setDefault("openai/gpt-5-nano", logger, actor);
    expect(repo.setDefault).toHaveBeenCalledWith("openai/gpt-5-nano");
  });
});
