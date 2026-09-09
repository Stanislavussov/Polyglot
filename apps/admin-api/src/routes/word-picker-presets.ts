import { wordPickerPresetRepository } from "@polyglot/adapter-db";
import { wordPickerPresetCreateSchema, wordPickerPresetUpdateSchema } from "@polyglot/admin-contracts";
import type { FastifyInstance } from "fastify";
import { registerCrudRoutes } from "./crud-factory.js";

export async function wordPickerPresetRoutes(app: FastifyInstance) {
  registerCrudRoutes(app, {
    resource: "word-picker-presets",
    keyParam: "id",
    list: { handler: () => wordPickerPresetRepository.findAll() },
    create: {
      schema: wordPickerPresetCreateSchema,
      handler: (body) => wordPickerPresetRepository.create(body),
    },
    update: {
      schema: wordPickerPresetUpdateSchema,
      notFoundMessage: "Preset not found",
      findExisting: (id) => wordPickerPresetRepository.findById(Number(id)),
      handler: (id, body, existing) =>
        wordPickerPresetRepository.update(Number(id), {
          // The slug is the seeder's key and the stable identity of the angle, so
          // it is never editable — everything else is patched over the stored row.
          slug: existing.slug,
          emoji: body.emoji ?? existing.emoji,
          title: body.title ?? existing.title,
          titleI18n: body.titleI18n ?? existing.titleI18n,
          prompt: body.prompt ?? existing.prompt,
          learningLangs: body.learningLangs ?? existing.learningLangs,
          sortOrder: body.sortOrder ?? existing.sortOrder,
          isActive: body.isActive ?? existing.isActive,
        }),
    },
    remove: {
      handler: (id) => wordPickerPresetRepository.delete(Number(id)),
    },
  });
}
