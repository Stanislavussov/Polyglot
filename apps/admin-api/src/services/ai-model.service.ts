import { type AIModelWithPlans, aiModelRepository } from "@polyglot/adapter-db";
import type { aiModelCreateSchema, aiModelUpdateSchema } from "@polyglot/admin-contracts";
import type { FastifyBaseLogger } from "fastify";
import type { z } from "zod";
import { HttpError } from "./http-error.js";

type Actor = { adminId: number; email: string; role: string };
type CreateInput = z.infer<typeof aiModelCreateSchema>;
type UpdateInput = z.infer<typeof aiModelUpdateSchema>;
type AIModelChangeAction = "created" | "updated" | "default_changed" | "deleted";

function logChange(
  logger: FastifyBaseLogger,
  actor: Actor,
  action: AIModelChangeAction,
  modelId: string,
  details: {
    before?: AIModelWithPlans | null;
    after?: AIModelWithPlans | null;
    previousDefaultId?: string | null;
  } = {},
): void {
  logger.info({ event: `ai_model.${action}`, actor, modelId, ...details }, `AI model ${action}`);
}

/**
 * Business invariants for AI models (Fable T11/T27, finding D2/D3). The bot picks
 * its model from this table, so the guards here prevent it from ever pointing at
 * a model it cannot call (the :free 429 freeze class): the default model can be
 * neither deleted nor set to a disabled model. Raw Drizzle stays in the
 * repository; the route handlers call this service and stay thin.
 */
export const aiModelService = {
  list(): Promise<AIModelWithPlans[]> {
    return aiModelRepository.findAll();
  },

  async create(input: CreateInput, logger: FastifyBaseLogger, actor: Actor): Promise<AIModelWithPlans> {
    const before = await aiModelRepository.findByIdWithPlans(input.id);
    const model = await aiModelRepository.upsert(input);
    logChange(logger, actor, before ? "updated" : "created", model.id, { before, after: model });
    return model;
  },

  async update(id: string, patch: UpdateInput, logger: FastifyBaseLogger, actor: Actor): Promise<AIModelWithPlans> {
    const existing = await aiModelRepository.findByIdWithPlans(id);
    if (!existing) {
      throw new HttpError(404, "Model not found");
    }
    const model = await aiModelRepository.upsert({ ...existing, ...patch });
    logChange(logger, actor, "updated", id, { before: existing, after: model });
    return model;
  },

  async setDefault(id: string, logger: FastifyBaseLogger, actor: Actor): Promise<void> {
    const existing = await aiModelRepository.findByIdWithPlans(id);
    if (!existing) {
      throw new HttpError(404, "Model not found");
    }
    // A disabled model must not become the default — the bot would pick a model
    // it is not allowed to call (same failure class as the :free freeze). D2.
    if (!existing.isEnabled) {
      throw new HttpError(409, "Cannot set a disabled model as default. Enable it first.");
    }
    const previousDefault = await aiModelRepository.findDefault();
    await aiModelRepository.setDefault(id);
    const model = await aiModelRepository.findByIdWithPlans(id);
    logChange(logger, actor, "default_changed", id, {
      before: existing,
      after: model,
      previousDefaultId: previousDefault?.id ?? null,
    });
  },

  async remove(id: string, logger: FastifyBaseLogger, actor: Actor): Promise<void> {
    const existing = await aiModelRepository.findByIdWithPlans(id);
    // Never delete the model the bot is currently using — deletion would fall
    // back to a hardcoded model that may be unavailable (the 429/:free incident
    // class). Require another model to be made default first. D2.
    if (existing?.isDefault) {
      throw new HttpError(409, "Cannot delete the default AI model. Set another model as default first.");
    }
    await aiModelRepository.delete(id);
    if (existing) {
      logChange(logger, actor, "deleted", id, { before: existing, after: null });
    }
  },
};
