import type {
  AIGenerationDefaults,
  AIModel,
  DictionaryConfig,
  NotificationDefaults,
  PlanLimitConfig,
  SettingsPort,
  SrsConfig,
  TranslationPresetConfig,
  TtsConfig,
  VideoVocabularyConfig,
} from "@polyglot/core";
import { parseAIGenerationDefaults } from "@polyglot/core";
import { aiModelRepository } from "./repositories/ai-model.repository.js";
import { rateLimitPlanRepository } from "./repositories/rate-limit-plan.repository.js";
import { systemSettingsRepository } from "./repositories/system-settings.repository.js";
import { translationPresetRepository } from "./repositories/translation-preset.repository.js";

/**
 * TTS is ON by default (the pronunciation button is offered out of the box).
 *
 * Unlike the primary completion model — which Task 73 requires to come from
 * `ai_models` with NO code-level default, because a bad value there takes
 * translation down — a bad value here costs a toast on one button. So this
 * follows the `videoVocabulary.extractionModelId` precedent instead: a working
 * default in code, overridable by a `tts` row in `system_settings` without a
 * redeploy.
 *
 * Why this model and this format, both verified against the live API on
 * 2026-08-22 rather than taken from the model card:
 *   - `response_format: "mp3"` is non-negotiable — Telegram `sendVoice` takes mp3
 *     directly, so no ffmpeg. Gemini 3.1 Flash TTS, the obvious pick on language
 *     coverage, REJECTS mp3 outright ("only supports response_format=pcm") and
 *     would have failed on every call.
 *   - Grok Voice TTS returned valid `audio/mpeg` for all 11 supported learning
 *     languages (cs de en es fr it kk pl pt ru uk) in ~0.5-1s, Kazakh included,
 *     and auto-detects the language, so one voice serves every language. Most
 *     rivals lock voices to a locale (`de-DE-Klaus`, `en_paul_neutral`), which a
 *     single global default cannot use.
 */
const DEFAULTS: {
  srs: SrsConfig;
  notifications: NotificationDefaults;
  dictionary: DictionaryConfig;
  videoVocabulary: VideoVocabularyConfig;
  tts: TtsConfig;
} = {
  srs: { minEaseFactor: 1.3, defaultEaseFactor: 2.5 },
  notifications: { defaultTime: "19:00", defaultType: "srs", inactivityDays: 14, notificationTimesLimit: 12 },
  dictionary: { flashcardLimit: 10, notificationDictLimit: 1, wordOfDayLimit: 1 },
  videoVocabulary: {
    monthlyLimit: 3,
    minPhrases: 15,
    maxPhrases: 40,
    extractionModelId: "google/gemini-3.1-flash-lite",
  },
  tts: { enabled: true, modelId: "x-ai/grok-voice-tts-1.0", voice: "eve", maxChars: 200 },
};

async function getWithFallback<T>(key: string, fallback: T): Promise<T> {
  const value = await systemSettingsRepository.get<T>(key);
  // Backfill keys ABSENT from a partial/legacy blob from the complete defaults.
  // A plain `value ?? fallback` returns a stored object verbatim, so a blob
  // written before a field existed (e.g. `ai.defaults` predating `requestTimeoutMs`,
  // added in Fable T27) comes back with that field `undefined` — the whole
  // fallback is only used when the row is null. Applies to every settings group
  // read through this helper (ai/srs/notifications/dictionary/videoVocabulary),
  // all flat objects, so a shallow merge is correct. NOTE: this heals MISSING
  // keys only; a present-but-invalid value (e.g. `requestTimeoutMs: null`) still
  // survives the merge and is caught downstream at each budget-consuming site.
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return { ...fallback, ...value };
  }
  return value ?? fallback;
}

export const settingsAdapter: SettingsPort = {
  async getPlanLimits(): Promise<PlanLimitConfig[]> {
    const plans = await rateLimitPlanRepository.findAll();
    return plans.map((p) => ({
      name: p.name,
      label: p.label,
      translationLimit: p.translationLimit,
      creditCost: p.creditCost,
      videoLimit: p.videoLimit,
      videoWindow: p.videoWindow,
      priceUsdCents: p.priceUsdCents,
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
      translationLimit: p.translationLimit,
      creditCost: p.creditCost,
      videoLimit: p.videoLimit,
      videoWindow: p.videoWindow,
      priceUsdCents: p.priceUsdCents,
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

  async getDefaultAIModel(): Promise<string | null> {
    const model = await aiModelRepository.findDefault();
    return model?.id ?? null;
  },

  async getDefaultAIModelForPlan(plan: string): Promise<string | null> {
    const model = await aiModelRepository.findForPlan(plan);
    return model?.id ?? null;
  },

  async getFallbackAIModel(): Promise<string | null> {
    const model = await aiModelRepository.findFallback();
    return model?.id ?? null;
  },

  async getAIGenerationDefaults(): Promise<AIGenerationDefaults> {
    // Validate at the read boundary (parse, not cast): a legacy/partial/invalid
    // `ai.defaults` blob can never surface a non-finite requestTimeoutMs downstream.
    return parseAIGenerationDefaults(await systemSettingsRepository.get("ai.defaults"));
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

  async getTtsConfig(): Promise<TtsConfig> {
    return getWithFallback<TtsConfig>("tts", DEFAULTS.tts);
  },
};
