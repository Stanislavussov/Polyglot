import type { ServiceContainer } from "../../ports/container.js";
import { resolveDefaultAIModel, resolveFallbackAIModel } from "../../shared/ai-model.js";
import { buildMentorSystemPrompt } from "./prompt.builder.js";

/** What a user may type as one mentor question, in characters — the same cap on every channel. */
export const MENTOR_MAX_INPUT_LENGTH = 1000;

export interface MentorModels {
  model: string;
  fallbackModel: string | null;
  maxTokens: number;
  /** CEFR level per language code, so answers land at the right difficulty. */
  levels: Record<string, string>;
}

/**
 * The mentor model: the admin-managed override wins; an empty override follows the
 * regular chain (plan-routed → default → fallback), so a wiped setting degrades to
 * the default model instead of killing the feature. Grammar check uses it too: a
 * check is a grammar explanation, which is what the mentor model was chosen for.
 */
export async function resolveMentorModels(
  deps: Pick<ServiceContainer, "settings" | "userRepository">,
  userId: number,
  plan: string | undefined,
): Promise<MentorModels> {
  const mentorConfig = await deps.settings.getMentorConfig();
  const overrideModel = mentorConfig.modelId.trim();
  const [model, fallbackModel, levelRows] = await Promise.all([
    overrideModel ? Promise.resolve(overrideModel) : resolveDefaultAIModel(deps.settings, plan),
    resolveFallbackAIModel(deps.settings),
    deps.userRepository.getLanguageLevels(userId),
  ]);
  return {
    model,
    fallbackModel,
    maxTokens: mentorConfig.maxTokens,
    levels: Object.fromEntries(levelRows.map((row) => [row.languageCode, row.proficiencyLevel])),
  };
}

export interface MentorSetup extends MentorModels {
  systemPrompt: string;
}

export async function resolveMentorSetup(
  deps: Pick<ServiceContainer, "settings" | "userRepository">,
  user: { id: number; subscriptionPlan?: string },
  settings: { nativeLang?: string | null; learningLangs?: string[] | null } | null,
  interfaceLang: string,
): Promise<MentorSetup> {
  const models = await resolveMentorModels(deps, user.id, user.subscriptionPlan);
  const systemPrompt = buildMentorSystemPrompt({
    nativeLang: settings?.nativeLang ?? "en",
    learningLangs: settings?.learningLangs ?? [],
    levels: models.levels,
    interfaceLang,
  });
  return { ...models, systemPrompt };
}
