import { translationPresetRepository } from "@polyglot/adapter-db";
import { presetCreateSchema, presetUpdateSchema } from "@polyglot/admin-contracts";
import type { FastifyInstance } from "fastify";
import { registerCrudRoutes } from "./crud-factory.js";

export async function presetRoutes(app: FastifyInstance) {
  registerCrudRoutes(app, {
    resource: "presets",
    keyParam: "name",
    list: { handler: () => translationPresetRepository.findAll() },
    create: {
      schema: presetCreateSchema,
      handler: (body) => translationPresetRepository.upsert(body),
    },
    update: {
      schema: presetUpdateSchema,
      notFoundMessage: "Preset not found",
      findExisting: (name) => translationPresetRepository.findByName(name),
      handler: (name, body, existing) =>
        translationPresetRepository.upsert({
          name,
          label: body.label ?? existing.label,
          config: body.config ?? existing.config,
          isActive: body.isActive ?? existing.isActive,
        }),
    },
    remove: {
      handler: (name) => translationPresetRepository.delete(name),
    },
  });
}
