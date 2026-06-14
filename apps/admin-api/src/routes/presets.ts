import { translationPresetRepository } from "@polyglot/adapter-db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

const presetConfigSchema = z.object({
  synonyms: z.boolean(),
  examples: z.boolean(),
  alternatives: z.boolean(),
  equivalentNote: z.boolean(),
  connotationWarning: z.boolean(),
});

const presetSchema = z.object({
  name: z.string().min(1).max(100),
  label: z.string().min(1).max(255),
  config: presetConfigSchema,
  isActive: z.boolean().default(true),
});

const updatePresetSchema = z.object({
  label: z.string().min(1).max(255).optional(),
  config: presetConfigSchema.optional(),
  isActive: z.boolean().optional(),
});

export async function presetRoutes(app: FastifyInstance) {
  app.addHook("onRequest", async (request) => {
    await request.jwtVerify();
  });

  app.get("/presets", async () => {
    const presets = await translationPresetRepository.findAll();
    return presets;
  });

  app.post("/presets", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = presetSchema.parse(request.body);
    const preset = await translationPresetRepository.upsert(body);
    return reply.status(201).send(preset);
  });

  app.put("/presets/:name", async (request: FastifyRequest, reply: FastifyReply) => {
    const { name } = request.params as { name: string };
    const body = updatePresetSchema.parse(request.body);
    const existing = await translationPresetRepository.findByName(name);
    if (!existing) {
      return reply.status(404).send({ error: "Preset not found" });
    }
    const preset = await translationPresetRepository.upsert({
      name,
      label: body.label ?? existing.label,
      config: body.config ?? existing.config,
      isActive: body.isActive ?? existing.isActive,
    });
    return preset;
  });

  app.delete("/presets/:name", async (request: FastifyRequest, reply: FastifyReply) => {
    const { name } = request.params as { name: string };
    await translationPresetRepository.delete(name);
    return reply.status(204).send();
  });
}
