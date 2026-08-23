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
  /** Display price in US cents for the upgrade screen. null = not for sale. */
  priceUsdCents: number | null;
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

/**
 * Text-to-speech settings for the pronunciation button on translation cards.
 *
 * `modelId` lives here rather than in a constant for the reason Task 73 records:
 * a hardcoded slug OpenRouter rejects is unfixable without a redeploy. An empty
 * `modelId` is treated the same as `enabled: false` — there is nothing to call.
 */
export interface TtsConfig {
  /** Master switch. The pronunciation button is not rendered when false. */
  enabled: boolean;
  /** OpenRouter speech model id, e.g. "google/gemini-3.1-flash-tts-preview". */
  modelId: string;
  /** Voice name for models that expose one; empty string when the model has none. */
  voice: string;
  /** Hard cap on characters sent for synthesis. Longer text is refused, not truncated. */
  maxChars: number;
}

/**
 * Speech-to-text settings for voice message translation (Task 80).
 *
 * Mirrors `TtsConfig`'s empty-model-means-disabled convention: `modelId` lives
 * here rather than a constant so a bad slug is fixable without a redeploy, and an
 * empty `modelId` means the same thing as `enabled: false` (see
 * `pronunciation.service.ts:74` for the same rule on the TTS side).
 */
export interface SttConfig {
  /** Master switch. Voice message handling is not offered when false. */
  enabled: boolean;
  /** OpenRouter speech-to-text model id. Empty string = feature disabled. */
  modelId: string;
  /** Hard cap on voice message duration accepted for transcription. */
  maxDurationSec: number;
}

export interface SettingsPort {
  getPlanLimits(): Promise<PlanLimitConfig[]>;
  getPlanLimit(plan: SubscriptionPlan): Promise<PlanLimitConfig | null>;
  getAIModels(): Promise<AIModel[]>;
  getEnabledAIModels(): Promise<AIModel[]>;
  getDefaultAIModel(): Promise<string | null>;
  /** The model explicitly routed to this plan (`rate_limit_plans.ai_model_id`), or null to use the global default. */
  getDefaultAIModelForPlan(plan: SubscriptionPlan): Promise<string | null>;
  /**
   * Admin-chosen model the AI failover retries on after the primary fails.
   * `null` when no enabled model carries the flag — the caller then falls back to
   * its own emergency constant instead of skipping failover.
   */
  getFallbackAIModel(): Promise<string | null>;
  getAIGenerationDefaults(): Promise<AIGenerationDefaults>;
  getSrsConfig(): Promise<SrsConfig>;
  getNotificationDefaults(): Promise<NotificationDefaults>;
  getDictionaryConfig(): Promise<DictionaryConfig>;
  getTranslationPresets(): Promise<TranslationPresetConfig[]>;
  getVideoVocabularyConfig(): Promise<VideoVocabularyConfig>;
  getTtsConfig(): Promise<TtsConfig>;
  getSttConfig(): Promise<SttConfig>;
}
