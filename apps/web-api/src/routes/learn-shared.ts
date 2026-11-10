import {
  type AiCallType,
  buildQuotaPorts,
  checkAiQuota,
  defaultFeatureAccess,
  type FeatureKey,
  isSupported,
  logEvent,
  type SupportedLang,
  type User,
  type UserLanguageSettings,
} from "@polyglot/core";
import type { FastifyReply } from "fastify";
import type { WebServices } from "../services.js";

export async function learnerSettings(
  services: WebServices,
  user: User,
): Promise<{ settings: UserLanguageSettings | null; lang: SupportedLang }> {
  const settings = await services.userRepository.getSettings(user.id);
  const iLang = settings?.interfaceLang ?? "en";
  return { settings, lang: isSupported(iLang) ? iLang : "en" };
}

/**
 * The shared credit meter, run before the paid call. Returns the cost to bill on
 * success; otherwise sends the 429 the client renders as the limit notice and
 * returns null (the route must then stop).
 */
export async function meterCredits(
  services: WebServices,
  user: User,
  reply: FastifyReply,
  callType: AiCallType,
): Promise<number | null> {
  const quota = await checkAiQuota(buildQuotaPorts(services), user, callType);
  if (quota.ok) return quota.creditCost;
  logEvent("limit.reached", { userId: user.id, reason: quota.reason, callType, channel: "web" });
  await reply.status(429).send({ code: "limit", reason: quota.reason, resetAt: quota.resetAt.toISOString() });
  return null;
}

export async function hasFeature(services: WebServices, user: User, feature: FeatureKey): Promise<boolean> {
  const access = services.featureAccess ?? defaultFeatureAccess;
  return (await access.checkFeatureAccess(user, feature)).hasAccess;
}

export function featureLocked(reply: FastifyReply, feature: FeatureKey) {
  return reply.status(403).send({ code: "feature_locked", feature });
}
