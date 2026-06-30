import type {
  AIGenerationDefaults,
  AIModel,
  DictionaryConfig,
  NotificationDefaults,
  PlanLimitConfig,
  SettingsPort,
  SrsConfig,
  TranslationPresetConfig,
  VideoVocabularyConfig,
} from "@polyglot/core";
import { aiModelRepository } from "./repositories/ai-model.repository.js";
import { rateLimitPlanRepository } from "./repositories/rate-limit-plan.repository.js";
import { systemSettingsRepository } from "./repositories/system-settings.repository.js";
import { translationPresetRepository } from "./repositories/translation-preset.repository.js";

const DEFAULTS: {
  ai: AIGenerationDefaults;
  srs: SrsConfig;
  notifications: NotificationDefaults;
  dictionary: DictionaryConfig;
  videoVocabulary: VideoVocabularyConfig;
} = {
  ai: { maxTokens: 4096, temperature: 0.3, frequencyPenalty: 0.5, maxRetries: 2 },
  srs: { minEaseFactor: 1.3, defaultEaseFactor: 2.5 },
  notifications: { defaultTime: "08:00", defaultType: "srs", inactivityDays: 14, notificationTimesLimit: 12 },
  dictionary: { flashcardLimit: 10, notificationDictLimit: 1, wordOfDayLimit: 1 },
  videoVocabulary: {
    monthlyLimit: 3,
    minPhrases: 15,
    maxPhrases: 40,
    extractionModelId: "google/gemini-3.1-flash-lite",
  },
};

async function getWithFallback<T>(key: string, fallback: T): Promise<T> {
  const value = await systemSettingsRepository.get<T>(key);
  return value ?? fallback;
}

export const settingsAdapter: SettingsPort = {
  async getPlanLimits(): Promise<PlanLimitConfig[]> {
    const plans = await rateLimitPlanRepository.findAll();
    return plans.map((p) => ({
      name: p.name,
      label: p.label,
      creditsPerDay: p.creditsPerDay,
      windowMs: p.windowMs,
      creditCost: p.creditCost,
      isActive: p.isActive,
      isDefault: p.isDefault,
    }));
  },

  async getPlanLimit(plan: string): Promise<PlanLimitConfig | null> {
    const p = await rateLimitPlanRepository.findByName(plan);
    if (!p) return null;
    return {
      name: p.name,
      label: p.label,
      creditsPerDay: p.creditsPerDay,
      windowMs: p.windowMs,
      creditCost: p.creditCost,
      isActive: p.isActive,
      isDefault: p.isDefault,
    };
  },

  async getAIModels(): Promise<AIModel[]> {
    const models = await aiModelRepository.findAll();
    return models.map((m) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      maxTokens: m.maxTokens,
      costPer1kInput: m.costPer1kInput,
      costPer1kOutput: m.costPer1kOutput,
    }));
  },

  async getEnabledAIModels(): Promise<AIModel[]> {
    const models = await aiModelRepository.findEnabled();
    return models.map((m) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      maxTokens: m.maxTokens,
      costPer1kInput: m.costPer1kInput,
      costPer1kOutput: m.costPer1kOutput,
    }));
  },

  async getEnabledAIModelsForPlan(plan: string): Promise<AIModel[]> {
    const models = await aiModelRepository.findEnabledForPlan(plan);
    return models.map((m) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      maxTokens: m.maxTokens,
      costPer1kInput: m.costPer1kInput,
      costPer1kOutput: m.costPer1kOutput,
    }));
  },

  async getDefaultAIModel(): Promise<string | null> {
    const model = await aiModelRepository.findDefault();
    return model?.id ?? null;
  },

  async getDefaultAIModelForPlan(plan: string): Promise<string | null> {
    const model = await aiModelRepository.findDefaultForPlan(plan);
    return model?.id ?? null;
  },

  async getAIGenerationDefaults(): Promise<AIGenerationDefaults> {
    return getWithFallback<AIGenerationDefaults>("ai.defaults", DEFAULTS.ai);
  },

  async getSrsConfig(): Promise<SrsConfig> {
    return getWithFallback<SrsConfig>("srs", DEFAULTS.srs);
  },

  async getNotificationDefaults(): Promise<NotificationDefaults> {
    return getWithFallback<NotificationDefaults>("notifications", DEFAULTS.notifications);
  },

  async getDictionaryConfig(): Promise<DictionaryConfig> {
    return getWithFallback<DictionaryConfig>("dictionary", DEFAULTS.dictionary);
  },

  async getTranslationPresets(): Promise<TranslationPresetConfig[]> {
    const presets = await translationPresetRepository.findAll();
    return presets.map((p) => ({
      name: p.name,
      label: p.label,
      config: p.config,
      isActive: p.isActive,
    }));
  },

  async getVideoVocabularyConfig(): Promise<VideoVocabularyConfig> {
    return getWithFallback<VideoVocabularyConfig>("videoVocabulary", DEFAULTS.videoVocabulary);
  },
};
