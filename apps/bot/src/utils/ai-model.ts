import type { SettingsPort } from "@polyglot/core";

const FALLBACK_AI_MODEL = "openai/gpt-5-nano";

export async function resolveDefaultAIModel(
  settings?: Pick<SettingsPort, "getDefaultAIModel" | "getDefaultAIModelForPlan">,
  plan?: string,
): Promise<string> {
  if (!settings) {
    return FALLBACK_AI_MODEL;
  }

  try {
    if (plan) {
      return (await settings.getDefaultAIModelForPlan(plan)) ?? FALLBACK_AI_MODEL;
    }
    return (await settings.getDefaultAIModel()) ?? FALLBACK_AI_MODEL;
  } catch {
    return FALLBACK_AI_MODEL;
  }
}
