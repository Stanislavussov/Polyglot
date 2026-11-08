import type { SettingsPort } from "../ports/settings.port.js";

/**
 * Thrown when no AI model can be resolved from the database — no default model for
 * the plan, no global default, and no fallback model flagged in the admin panel.
 *
 * There is deliberately NO hardcoded model to fall back on: a constant in the code
 * is exactly how the 2026-07-17 incident happened (the constant held
 * `google/gemini-3.1-flash`, a slug OpenRouter rejects as "not a valid model ID",
 * so every primary timeout hard-failed on a model nobody could fix without a
 * redeploy). Model ids now live only in `ai_models`, where an admin can repair
 * them, and an empty table is surfaced as this error rather than papered over.
 */
export class AIModelNotConfiguredError extends Error {
  constructor() {
    super("No AI model configured — set a default model in the admin panel (AI Models)");
    this.name = "AIModelNotConfiguredError";
  }
}

/**
 * The primary model for a call: the plan's default, else the global default, else
 * the admin-set fallback model — all three read from `ai_models`. When the database
 * names none of them there is no model to call, and that is an
 * {@link AIModelNotConfiguredError}, not a hardcoded guess.
 */
export async function resolveDefaultAIModel(
  settings?: Pick<SettingsPort, "getDefaultAIModel" | "getDefaultAIModelForPlan" | "getFallbackAIModel">,
  plan?: string,
): Promise<string> {
  if (!settings) {
    throw new AIModelNotConfiguredError();
  }

  const preferred = plan ? await settings.getDefaultAIModelForPlan(plan) : await settings.getDefaultAIModel();
  const model = preferred ?? (await settings.getFallbackAIModel());
  if (!model) {
    throw new AIModelNotConfiguredError();
  }
  return model;
}
