import type { AIModel } from "./ai.port.js";
import type { SubscriptionPlan } from "./user.repository.js";

/** How a plan's video allowance is counted. `none` = video feature unavailable. */
export type VideoWindow = "none" | "lifetime" | "monthly";

export interface PlanLimitConfig {
  name: string;
  label: string;
  /** Max top-level translations per calendar month (UTC). null = unlimited */
  translationLimit: number | null;
  creditCost: number;
  /** Max video analyses within `videoWindow`. null = unlimited */
  videoLimit: number | null;
  videoWindow: VideoWindow;
  isActive: boolean;
  isDefault: boolean;
}

export interface AIGenerationDefaults {
  maxTokens: number;
  temperature: number;
  frequencyPenalty: number;
  maxRetries: number;
  /**
   * Wall-clock budget in ms for a single AI call (including retries) before it
   * is aborted. Keep below the bot's 20 s loader guard so the adapter cancels
   * first and the user still sees the "taking longer" fallback.
   */
  requestTimeoutMs: number;
}

export interface SrsConfig {
  minEaseFactor: number;
  defaultEaseFactor: number;
}

export interface NotificationDefaults {
  defaultTime: string;
  defaultType: "suggested" | "srs" | "contextual";
  inactivityDays: number;
  /** Max number of daily notification times a user can configure. */
  notificationTimesLimit: number;
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
  /** Floor for the per-video phrase target (used for short videos). */
  minPhrases: number;
  /** Ceiling for the per-video phrase target (used for long videos). */
  maxPhrases: number;
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
