import { type AIModelRow, aiModelRepository, rateLimitPlanRepository } from "@polyglot/adapter-db";
import type { aiModelCreateSchema, aiModelUpdateSchema } from "@polyglot/admin-contracts";
import type { FastifyBaseLogger } from "fastify";
import type { z } from "zod";
import { HttpError } from "./http-error.js";

type Actor = { adminId: number; email: string; role: string };
type CreateInput = z.infer<typeof aiModelCreateSchema>;
type UpdateInput = z.infer<typeof aiModelUpdateSchema>;
type AIModelChangeAction = "created" | "updated" | "default_changed" | "fallback_changed" | "deleted";

function logChange(
  logger: FastifyBaseLogger,
  actor: Actor,
  action: AIModelChangeAction,
  modelId: string,
  details: {
    before?: AIModelRow | null;
    after?: AIModelRow | null;
    previousDefaultId?: string | null;
    previousFallbackId?: string | null;
  } = {},
): void {
  logger.info({ event: `ai_model.${action}`, actor, modelId, ...details }, `AI model ${action}`);
}

/** Every routing role the model currently holds, in human-readable form ("Default", "Fallback", plan labels). */
async function routingRolesOf(model: AIModelRow): Promise<string[]> {
  const roles: string[] = [];
  if (model.isDefault) roles.push("Default");
  if (model.isFallback) roles.push("Fallback");
  const plans = await rateLimitPlanRepository.findAll();
  roles.push(...plans.filter((plan) => plan.aiModelId === model.id).map((plan) => plan.label));
  return roles;
}

/**
 * Business invariants for AI models (Fable T11/T27, finding D2/D3). The bot picks
 * its model from this table, so the guards here prevent it from ever pointing at
 * a model it cannot call (the :free 429 freeze class): a model holding a routing
 * role (global default, plan model, failover) can be neither deleted nor pointed
 * at a disabled model. Raw Drizzle stays in the repository; the route handlers
 * call this service and stay thin.
 */
export const aiModelService = {
  list(): Promise<AIModelRow[]> {
    return aiModelRepository.findAll();
  },

  async create(input: CreateInput, logger: FastifyBaseLogger, actor: Actor): Promise<AIModelRow> {
    const before = await aiModelRepository.findById(input.id);
    const model = await aiModelRepository.upsert(input);
    logChange(logger, actor, before ? "updated" : "created", model.id, { before, after: model });
    return model;
  },

  async update(id: string, patch: UpdateInput, logger: FastifyBaseLogger, actor: Actor): Promise<AIModelRow> {
    const existing = await aiModelRepository.findById(id);
    if (!existing) {
      throw new HttpError(404, "Model not found");
    }
    // Disabling is the back door into the same broken state set-default/set-fallback
    // guard against: a routing role pointing at a model the bot may not call. The
    // role reads filter on `is_enabled`, so the plan would silently slide onto the
    // global default (or lose failover) with nothing in the UI saying so.
    if (patch.isEnabled === false) {
      const roles = await routingRolesOf(existing);
      if (roles.length > 0) {
        throw new HttpError(
          409,
          `Cannot disable a model in use (${roles.join(", ")}). Route those to another model first.`,
        );
      }
    }
    const model = await aiModelRepository.upsert({ ...existing, ...patch });
    logChange(logger, actor, "updated", id, { before: existing, after: model });
    return model;
  },

  async setDefault(id: string, logger: FastifyBaseLogger, actor: Actor): Promise<void> {
    const existing = await aiModelRepository.findById(id);
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
    const model = await aiModelRepository.findById(id);
    logChange(logger, actor, "default_changed", id, {
      before: existing,
      after: model,
      previousDefaultId: previousDefault?.id ?? null,
    });
  },

  /**
   * The failover model the bot retries on, or `null` to run without failover.
   * Same enabled-only guard as {@link setDefault}: pointing failover at a model we
   * are not allowed to call is worse than having none, because it only shows up
   * once the primary is already failing.
   */
  async setFallback(id: string | null, logger: FastifyBaseLogger, actor: Actor): Promise<void> {
    const existing = id === null ? null : await aiModelRepository.findById(id);
    if (id !== null) {
      if (!existing) {
        throw new HttpError(404, "Model not found");
      }
      if (!existing.isEnabled) {
        throw new HttpError(409, "Cannot set a disabled model as fallback. Enable it first.");
      }
    }
    const previousFallback = await aiModelRepository.findFallback();
    await aiModelRepository.setFallback(id);
    logChange(logger, actor, "fallback_changed", id ?? "(none)", {
      before: existing,
      after: id === null ? null : await aiModelRepository.findById(id),
      previousFallbackId: previousFallback?.id ?? null,
    });
  },

  async remove(id: string, logger: FastifyBaseLogger, actor: Actor): Promise<void> {
    const existing = await aiModelRepository.findById(id);
    // Never delete a model that currently holds a routing role — the bot would be
    // left without a model for that role (the 429/:free incident class). Require
    // another model to take the role first. D2.
    if (existing) {
      const roles = await routingRolesOf(existing);
      if (roles.length > 0) {
        throw new HttpError(
          409,
          `Cannot delete a model in use (${roles.join(", ")}). Route those to another model first.`,
        );
      }
    }
    await aiModelRepository.delete(id);
    if (existing) {
      logChange(logger, actor, "deleted", id, { before: existing, after: null });
    }
  },
};
