import {
  type CardFrontFields,
  DEFAULT_NOTIFICATION_BATCH_SIZE,
  formatNotificationTime,
  getSupportedLangs,
  isNotificationBatchSize,
  isSupported,
  MAX_LEARNING_LANGS,
  MAX_NOTIFICATION_TIMES,
  NOTIFICATION_BATCH_SIZES,
  NOTIFICATION_TYPES,
  parseNotificationMinutes,
  validateLanguageSettings,
} from "@polyglot/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { WebServices } from "../services.js";

const settingsPatchSchema = z
  .object({
    interfaceLang: z.string().optional(),
    nativeLang: z.string().optional(),
    learningLangs: z.array(z.string()).min(1).max(MAX_LEARNING_LANGS).optional(),
  })
  .strict();

const HALF_HOUR_SLOT = /^([01]\d|2[0-3]):(00|30)$/;

/** The bot's notification screen as one form: the same choices, the same limits. */
const notificationPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    times: z.array(z.string().regex(HALF_HOUR_SLOT)).min(1).max(MAX_NOTIFICATION_TIMES).optional(),
    type: z.enum(NOTIFICATION_TYPES).optional(),
    batchSize: z.number().int().refine(isNotificationBatchSize).optional(),
    timezone: z.string().min(1).max(64).optional(),
    context: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

const cardFieldPatchSchema = z
  .object({
    field: z.enum(["hint", "synonyms", "example"] as const satisfies readonly (keyof CardFrontFields)[]),
    enabled: z.boolean(),
  })
  .strict();

function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

async function readSettings(services: WebServices, userId: number) {
  const settings = await services.userRepository.getSettings(userId);
  const cache = services.languageCache;
  const display = settings?.interfaceLang ?? "en";
  return {
    interfaceLang: display,
    nativeLang: settings?.nativeLang ?? "en",
    learningLangs: settings?.learningLangs ?? [],
    interfaceLanguages: getSupportedLangs(),
    languages: cache.getSupportedLangs().map((lang) => ({
      code: lang.code,
      name: cache.getLangName(lang.code, display),
      flag: lang.flag ?? "",
    })),
    notifications: {
      // Defaults mirror the bot's notification screen, which reads the same row.
      enabled: settings?.notificationEnabled ?? true,
      times: settings?.notificationTimes ?? [],
      type: settings?.notificationType ?? "srs",
      batchSize: settings?.notificationBatchSize ?? DEFAULT_NOTIFICATION_BATCH_SIZE,
      timezone: settings?.timezone || "UTC",
      context: settings?.notificationContext ?? null,
      options: { types: NOTIFICATION_TYPES, batchSizes: NOTIFICATION_BATCH_SIZES, maxTimes: MAX_NOTIFICATION_TIMES },
    },
  };
}

export function settingsRoutes(app: FastifyInstance, services: WebServices): void {
  app.get("/api/settings", async (request) => readSettings(services, request.learner.id));

  // Writes go through the same repository the bot's settings scene uses, so the
  // bot reads the change on its next `getSettings(userId)`.
  app.patch("/api/settings", async (request, reply) => {
    const parsed = settingsPatchSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: "invalid_settings" });
    const userId = request.learner.id;
    const current = await services.userRepository.getSettings(userId);
    const validation = validateLanguageSettings(parsed.data, {
      currentNativeLang: current?.nativeLang,
      isKnownLang: (code) => services.languageCache.getLang(code)?.isSupported === true,
      isInterfaceLang: isSupported,
    });
    if (!validation.ok) return reply.status(400).send({ code: "invalid_settings", reason: validation.reason });
    const patch = validation.patch;

    // A web-first learner has no settings row yet, and the per-field updates write
    // nothing without one; the upsert creates it, as the bot's onboarding does.
    if (!current) {
      await services.userRepository.updateSettings(userId, {
        interfaceLang: patch.interfaceLang ?? "en",
        nativeLang: patch.nativeLang ?? "en",
        learningLangs: patch.learningLangs ?? [],
      });
      return readSettings(services, userId);
    }
    if (patch.interfaceLang !== undefined)
      await services.userRepository.updateInterfaceLang(userId, patch.interfaceLang);
    if (patch.nativeLang !== undefined) await services.userRepository.updateNativeLang(userId, patch.nativeLang);
    if (patch.learningLangs) await services.userRepository.updateLearningLangs(userId, patch.learningLangs);
    return readSettings(services, userId);
  });

  // The bot's card-settings toggles (handleSetCardToggleCallback): one aid at a time, same repository.
  app.get("/api/settings/card", async (request) => services.cardTemplateRepository.getFields(request.learner.id));

  app.patch("/api/settings/card", async (request, reply) => {
    const parsed = cardFieldPatchSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: "invalid_settings" });
    return services.cardTemplateRepository.setField(request.learner.id, parsed.data.field, parsed.data.enabled);
  });

  // Only the preferences change here; delivery stays in Telegram, run by the bot's scheduler.
  app.patch("/api/settings/notifications", async (request, reply) => {
    const parsed = notificationPatchSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: "invalid_settings" });
    const patch = parsed.data;
    if (patch.timezone !== undefined && !isValidTimezone(patch.timezone)) {
      return reply.status(400).send({ code: "invalid_settings" });
    }
    const userId = request.learner.id;
    const current = await services.userRepository.getSettings(userId);

    const times = patch.times
      ? [...new Set(patch.times.map(parseNotificationMinutes))].sort((a, b) => a - b).map(formatNotificationTime)
      : undefined;
    // Same seeding as the bot's toggle: turning on with no schedule takes the admin
    // default, because an empty list means "not configured", never "no times".
    const seeded =
      patch.enabled === true && !times && (current?.notificationTimes?.length ?? 0) === 0
        ? [
            formatNotificationTime(
              parseNotificationMinutes((await services.settings.getNotificationDefaults()).defaultTime),
            ),
          ]
        : undefined;

    const prefs = {
      ...(patch.enabled !== undefined ? { notificationEnabled: patch.enabled } : {}),
      ...((times ?? seeded) ? { notificationTimes: times ?? seeded } : {}),
      ...(patch.type !== undefined ? { notificationType: patch.type } : {}),
      ...(patch.batchSize !== undefined ? { notificationBatchSize: patch.batchSize } : {}),
      ...(patch.context !== undefined ? { notificationContext: patch.context || null } : {}),
    };
    if (Object.keys(prefs).length > 0) await services.notificationRepository.updatePrefs(userId, prefs);
    if (patch.timezone !== undefined) {
      await services.userRepository.updateSettings(userId, {
        interfaceLang: current?.interfaceLang ?? "en",
        nativeLang: current?.nativeLang ?? "en",
        learningLangs: current?.learningLangs ?? [],
        timezone: patch.timezone,
        activeMode: current?.activeMode ?? "translate",
      });
    }
    return readSettings(services, userId);
  });
}
