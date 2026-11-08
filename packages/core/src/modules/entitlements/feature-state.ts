import type { FeatureAccessPort, FeatureAccessSubject } from "../../ports/feature-access.port.js";

/** "off" = switched off for everyone (e.g. TTS disabled); "locked" = the plan does not include it. */
export type FeatureState = "ok" | "locked" | "off";

/**
 * Each feature's state for one viewer, from ONE plan lookup. The bot's lock badges
 * and the web card's locks read this, so the two channels can never disagree on
 * what a plan unlocks.
 */
export async function resolveFeatureStates<K extends string>(
  access: FeatureAccessPort,
  subject: FeatureAccessSubject,
  features: readonly K[],
  off: ReadonlySet<string> = new Set(),
): Promise<Map<K, FeatureState>> {
  const granted = await access.listFeatures(subject);
  return new Map(
    features.map((feature) => [feature, off.has(feature) ? "off" : granted.has(feature) ? "ok" : "locked"]),
  );
}
