import type { AIModel } from "./ai.port.js";
import type { SubscriptionPlan } from "./user.repository.js";

export interface PlanLimitConfig {
  name: string;
  label: string;
  creditsPerDay: number | null;
  windowMs: number;
  creditCost: number;
  isActive: boolean;
  isDefault: boolean;
}

export interface AIGenerationDefaults {
  maxTokens: number;
  temperature: number;
  frequencyPenalty: number;
  maxRetries: number;
}

export interface SrsConfig {
  minEaseFactor: number;
  defaultEaseFactor: number;
}

export interface NotificationDefaults {
  defaultTime: string;
  defaultType: "suggested" | "srs" | "contextual";
  inactivityDays: number;
}

export interface DictionaryConfig {
  flashcardLimit: number;
  notificationDictLimit: number;
  wordOfDayLimit: number;
}

export interface TranslationPresetConfig {
  name: string;
  label: string;
  config: {
    synonyms: boolean;
    examples: boolean;
    alternatives: boolean;
    equivalentNote: boolean;
    connotationWarning: boolean;
  };
  isActive: boolean;
}

export interface VideoVocabularyConfig {
  monthlyLimit: number;
  maxPhrasesDefault: number;
  extractionModelId: string;
}

export interface SettingsPort {
  getPlanLimits(): Promise<PlanLimitConfig[]>;
  getPlanLimit(plan: SubscriptionPlan): Promise<PlanLimitConfig | null>;
  getAIModels(): Promise<AIModel[]>;
  getEnabledAIModels(): Promise<AIModel[]>;
  getEnabledAIModelsForPlan(plan: SubscriptionPlan): Promise<AIModel[]>;
  getDefaultAIModel(): Promise<string | null>;
  getDefaultAIModelForPlan(plan: SubscriptionPlan): Promise<string | null>;
  getAIGenerationDefaults(): Promise<AIGenerationDefaults>;
  getSrsConfig(): Promise<SrsConfig>;
  getNotificationDefaults(): Promise<NotificationDefaults>;
  getDictionaryConfig(): Promise<DictionaryConfig>;
  getTranslationPresets(): Promise<TranslationPresetConfig[]>;
  getVideoVocabularyConfig(): Promise<VideoVocabularyConfig>;
}
