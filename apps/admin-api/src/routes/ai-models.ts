import { aiModelCreateSchema, aiModelFallbackSchema, aiModelUpdateSchema } from "@polyglot/admin-contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireRole } from "../plugins/auth.js";
import { aiModelService } from "../services/ai-model.service.js";

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

type OpenRouterKeyExpirationStatus = "active" | "expiring_soon" | "expired" | "unknown" | "not_configured";

/**
 * Wall-clock cap for outbound OpenRouter requests (D6). Without it a hung
 * upstream would hold the admin-API request open indefinitely; the AbortSignal
 * aborts the fetch so the route fails fast with a clear error instead.
 */
const OPENROUTER_FETCH_TIMEOUT_MS = 10_000;

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
  // Auth (jwtVerify + isActive) is applied globally by the unified hook in
  // plugins/auth.ts; mutating routes additionally require the superadmin role.
  const superadminOnly = { preHandler: requireRole("superadmin") };

  app.get("/ai-models/openrouter", async () => {
    const headers: Record<string, string> = {};
    if (process.env.OPENROUTER_API_KEY) {
      headers.Authorization = `Bearer ${process.env.OPENROUTER_API_KEY}`;
    }

    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers,
      signal: AbortSignal.timeout(OPENROUTER_FETCH_TIMEOUT_MS),
    });
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
      signal: AbortSignal.timeout(OPENROUTER_FETCH_TIMEOUT_MS),
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
    return aiModelService.list();
  });

  app.post("/ai-models", superadminOnly, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = aiModelCreateSchema.parse(request.body);
    const model = await aiModelService.create(body, request.log, request.adminUser);
    return reply.status(201).send(model);
  });

  app.put("/ai-models/:id", superadminOnly, async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    const body = aiModelUpdateSchema.parse(request.body);
    return aiModelService.update(id, body, request.log, request.adminUser);
  });

  app.put("/ai-models/:id/set-default", superadminOnly, async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    await aiModelService.setDefault(id, request.log, request.adminUser);
    return { success: true };
  });

  // Static path, so it must stay distinct from PUT /ai-models/:id. The failover
  // model is a single global role, hence one endpoint that sets or clears it
  // rather than a per-model toggle that could leave two winners.
  app.put("/ai-models/fallback", superadminOnly, async (request: FastifyRequest) => {
    const { modelId } = aiModelFallbackSchema.parse(request.body);
    await aiModelService.setFallback(modelId, request.log, request.adminUser);
    return { success: true };
  });

  app.delete("/ai-models/:id", superadminOnly, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    await aiModelService.remove(id, request.log, request.adminUser);
    return reply.status(204).send();
  });
}
