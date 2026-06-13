import { type AIModelWithPlans, aiModelRepository } from "@polyglot/adapter-db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

const modelSchema = z.object({
  id: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
  provider: z.string().min(1).max(100),
  maxTokens: z.number().int().min(1),
  costPer1kInput: z.number().min(0),
  costPer1kOutput: z.number().min(0),
  isEnabled: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  allowedPlans: z.array(z.string().min(1).max(50)).default([]),
});

const updateModelSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  provider: z.string().min(1).max(100).optional(),
  maxTokens: z.number().int().min(1).optional(),
  costPer1kInput: z.number().min(0).optional(),
  costPer1kOutput: z.number().min(0).optional(),
  isEnabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  allowedPlans: z.array(z.string().min(1).max(50)).optional(),
});

const openRouterModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  context_length: z.number().int().positive().nullable().optional(),
  pricing: z
    .object({
      prompt: z.string(),
      completion: z.string(),
    })
    .optional(),
});

const openRouterModelsResponseSchema = z.object({
  data: z.array(openRouterModelSchema),
});

const openRouterCurrentKeyResponseSchema = z.object({
  data: z.object({
    label: z.string().optional(),
    expires_at: z.string().datetime().nullable().optional(),
  }),
});

interface AdminActor {
  adminId: number;
  email: string;
  role: string;
}

type AIModelChangeAction = "created" | "updated" | "default_changed" | "deleted";
type OpenRouterKeyExpirationStatus = "active" | "expiring_soon" | "expired" | "unknown" | "not_configured";

function logAiModelChange(
  request: FastifyRequest,
  action: AIModelChangeAction,
  modelId: string,
  details: {
    before?: AIModelWithPlans | null;
    after?: AIModelWithPlans | null;
    previousDefaultId?: string | null;
  } = {},
): void {
  request.log.info(
    {
      event: `ai_model.${action}`,
      actor: request.adminUser,
      modelId,
      ...details,
    },
    `AI model ${action}`,
  );
}

function providerFromModelId(id: string): string {
  return id.split("/")[0] ?? "unknown";
}

function costPer1k(value: string | undefined): number {
  const parsed = Number(value ?? "0");
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed * 1000;
}

function purposeFromModel(model: { id: string; name: string }): string {
  const value = `${model.id} ${model.name}`.toLowerCase();
  if (
    value.includes("coder") ||
    value.includes("coding") ||
    value.includes("codestral") ||
    value.includes("devstral")
  ) {
    return "Coding";
  }
  if (value.includes("translate") || value.includes("translation") || value.includes("polyglot")) {
    return "Translation";
  }
  if (value.includes("vision") || value.includes("vl") || value.includes("visual")) {
    return "Vision";
  }
  if (value.includes("audio") || value.includes("whisper") || value.includes("transcribe")) {
    return "Audio";
  }
  if (value.includes("reason") || value.includes("thinking") || value.includes(" o1") || value.includes(" o3")) {
    return "Reasoning";
  }
  if (value.includes("embedding") || value.includes("embed")) {
    return "Embeddings";
  }
  return "General / translation";
}

function expirationStatus(expiresAt: string | null): {
  status: OpenRouterKeyExpirationStatus;
  daysRemaining: number | null;
} {
  if (!expiresAt) {
    return { status: "unknown", daysRemaining: null };
  }

  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return { status: "unknown", daysRemaining: null };
  }

  const daysRemaining = Math.ceil((expiresAtMs - Date.now()) / (24 * 60 * 60 * 1000));
  if (daysRemaining <= 0) {
    return { status: "expired", daysRemaining };
  }
  if (daysRemaining <= 30) {
    return { status: "expiring_soon", daysRemaining };
  }
  return { status: "active", daysRemaining };
}

export async function aiModelRoutes(app: FastifyInstance) {
  app.addHook("onRequest", async (request) => {
    request.adminUser = await request.jwtVerify<AdminActor>();
  });

  app.get("/ai-models/openrouter", async () => {
    const headers: Record<string, string> = {};
    if (process.env.OPENROUTER_API_KEY) {
      headers.Authorization = `Bearer ${process.env.OPENROUTER_API_KEY}`;
    }

    const response = await fetch("https://openrouter.ai/api/v1/models", { headers });
    if (!response.ok) {
      throw new Error(`OpenRouter models request failed: ${response.status} ${response.statusText}`);
    }

    const body = openRouterModelsResponseSchema.parse(await response.json());
    return body.data.map((model) => ({
      id: model.id,
      name: model.name,
      provider: providerFromModelId(model.id),
      purpose: purposeFromModel(model),
      maxTokens: model.context_length ?? 1,
      costPer1kInput: costPer1k(model.pricing?.prompt),
      costPer1kOutput: costPer1k(model.pricing?.completion),
    }));
  });

  app.get("/openrouter/key", async () => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return {
        configured: false,
        label: null,
        expiresAt: null,
        status: "not_configured" satisfies OpenRouterKeyExpirationStatus,
        daysRemaining: null,
      };
    }

    const response = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      throw new Error(`OpenRouter key request failed: ${response.status} ${response.statusText}`);
    }

    const body = openRouterCurrentKeyResponseSchema.parse(await response.json());
    const expiresAt = body.data.expires_at ?? null;
    const { status, daysRemaining } = expirationStatus(expiresAt);

    return {
      configured: true,
      label: body.data.label ?? null,
      expiresAt,
      status,
      daysRemaining,
    };
  });

  app.get("/ai-models", async () => {
    const models = await aiModelRepository.findAll();
    return models;
  });

  app.post("/ai-models", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = modelSchema.parse(request.body);
    const before = await aiModelRepository.findByIdWithPlans(body.id);
    const model = await aiModelRepository.upsert(body);
    logAiModelChange(request, before ? "updated" : "created", model.id, { before, after: model });
    return reply.status(201).send(model);
  });

  app.put("/ai-models/:id", async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = updateModelSchema.parse(request.body);
    const existing = await aiModelRepository.findByIdWithPlans(id);
    if (!existing) {
      return reply.status(404).send({ error: "Model not found" });
    }
    const model = await aiModelRepository.upsert({ ...existing, ...body });
    logAiModelChange(request, "updated", id, { before: existing, after: model });
    return model;
  });

  app.put("/ai-models/:id/set-default", async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const existing = await aiModelRepository.findByIdWithPlans(id);
    if (!existing) {
      return reply.status(404).send({ error: "Model not found" });
    }
    const previousDefault = await aiModelRepository.findDefault();
    await aiModelRepository.setDefault(id);
    const model = await aiModelRepository.findByIdWithPlans(id);
    logAiModelChange(request, "default_changed", id, {
      before: existing,
      after: model,
      previousDefaultId: previousDefault?.id ?? null,
    });
    return { success: true };
  });

  app.delete("/ai-models/:id", async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const existing = await aiModelRepository.findByIdWithPlans(id);
    await aiModelRepository.delete(id);
    if (existing) {
      logAiModelChange(request, "deleted", id, { before: existing, after: null });
    }
    return reply.status(204).send();
  });
}
