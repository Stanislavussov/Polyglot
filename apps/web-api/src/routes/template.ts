import { applyTemplateFields, resolveTemplate, TEMPLATE_PREVIEW_OUTPUT, type TemplateFields } from "@polyglot/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { WebServices } from "../services.js";
import { toTranslateResult } from "./translate.js";

const fieldsSchema = z
  .object({
    synonyms: z.boolean(),
    examples: z.boolean(),
    alternatives: z.boolean(),
    equivalentNote: z.boolean(),
    connotationWarning: z.boolean(),
  })
  .strict() satisfies z.ZodType<TemplateFields>;
const bodySchema = z.object({ fields: fieldsSchema }).strict();

async function readTemplate(services: WebServices, userId: number) {
  const saved = await services.translationTemplateRepository.getByUserId(userId);
  const fields = resolveTemplate(saved ? { name: saved.name, fields: saved.fields } : null).fields;
  return { fields, custom: saved !== null };
}

// The bot's /template wizard as routes: same repository, same "Custom" name, same preview card.
export function templateRoutes(app: FastifyInstance, services: WebServices): void {
  app.get("/api/template", async (request) => readTemplate(services, request.learner.id));

  app.put("/api/template", async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: "invalid_template" });
    await services.translationTemplateRepository.upsert(request.learner.id, "Custom", parsed.data.fields);
    return readTemplate(services, request.learner.id);
  });

  app.delete("/api/template", async (request) => {
    await services.translationTemplateRepository.deleteByUserId(request.learner.id);
    return readTemplate(services, request.learner.id);
  });

  app.post("/api/template/preview", async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: "invalid_template" });
    const output = applyTemplateFields(TEMPLATE_PREVIEW_OUTPUT, parsed.data.fields);
    return toTranslateResult(output, Object.keys(output.translations), null, false);
  });
}
