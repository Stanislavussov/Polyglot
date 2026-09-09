/**
 * Motivation kill switch — the four booleans that gate momentum recording and
 * the three surfaces built on it.
 *
 * The GET runs the stored blob through the same parser the runtime reads it
 * with, rather than the spread-over-defaults the other settings routes use: a
 * spread heals a missing key but shows a present-but-invalid one back to the
 * operator as-is, so the panel would display a switch the bot is not honouring.
 */
import { systemSettingsRepository } from "@polyglot/adapter-db";
import { motivationSettingsSchema } from "@polyglot/admin-contracts";
import { parseMotivationConfig } from "@polyglot/core";
import type { FastifyInstance, FastifyRequest } from "fastify";

const SETTINGS_KEY = "motivation";

export async function motivationRoutes(app: FastifyInstance) {
  app.get("/motivation", async () => {
    return parseMotivationConfig(await systemSettingsRepository.get(SETTINGS_KEY));
  });

  app.put("/motivation", async (request: FastifyRequest) => {
    const body = motivationSettingsSchema.parse(request.body);
    await systemSettingsRepository.set(SETTINGS_KEY, body);
    return body;
  });
}
