import type { AIModel } from "../../ports/ai.port.js";
import type {
  AIGenerationDefaults,
  DictionaryConfig,
  NotificationDefaults,
  PlanLimitConfig,
  SettingsPort,
  SrsConfig,
  TranslationPresetConfig,
  VideoVocabularyConfig,
} from "../../ports/settings.port.js";
import type { SubscriptionPlan } from "../../ports/user.repository.js";

const CACHE_TTL_MS = 60_000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const FALLBACK_PLAN_LIMITS: PlanLimitConfig[] = [
  {
    name: "free",
    label: "Free",
    creditsPerDay: 50,
    windowMs: 86_400_000,
    creditCost: 1,
    isActive: true,
    isDefault: true,
  },
  {
    name: "plus",
    label: "Plus",
    creditsPerDay: 300,
    windowMs: 86_400_000,
    creditCost: 1,
    isActive: true,
    isDefault: false,
  },
  {
    name: "pro",
    label: "Pro",
    creditsPerDay: 1500,
    windowMs: 86_400_000,
    creditCost: 1,
    isActive: true,
    isDefault: false,
  },
  {
    name: "unlimited",
    label: "Unlimited",
    creditsPerDay: null,
    windowMs: 86_400_000,
    creditCost: 1,
    isActive: true,
    isDefault: false,
  },
];

const FALLBACK_AI_MODELS: AIModel[] = [
  {
    id: "openai/gpt-4o",
    name: "GPT-4o",
    provider: "openai",
    maxTokens: 16_384,
    costPer1kInput: 0.0025,
    costPer1kOutput: 0.01,
  },
  {
    id: "openai/gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "openai",
    maxTokens: 16_384,
    costPer1kInput: 0.00015,
    costPer1kOutput: 0.0006,
  },
  {
    id: "openai/gpt-5-nano",
    name: "GPT-5 Nano",
    provider: "openai",
    maxTokens: 16_384,
    costPer1kInput: 0.0001,
    costPer1kOutput: 0.0004,
  },
  {
    id: "anthropic/claude-sonnet-4-20250514",
    name: "Claude Sonnet 4",
    provider: "anthropic",
    maxTokens: 8_192,
    costPer1kInput: 0.003,
    costPer1kOutput: 0.015,
  },
  {
    id: "anthropic/claude-haiku-3.5",
    name: "Claude 3.5 Haiku",
    provider: "anthropic",
    maxTokens: 8_192,
    costPer1kInput: 0.0008,
    costPer1kOutput: 0.004,
  },
  {
    id: "google/gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "google",
    maxTokens: 65_536,
    costPer1kInput: 0.00125,
    costPer1kOutput: 0.01,
  },
  {
    id: "google/gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "google",
    maxTokens: 65_536,
    costPer1kInput: 0.00015,
    costPer1kOutput: 0.0006,
  },
];

const FALLBACK_AI_DEFAULTS: AIGenerationDefaults = {
  maxTokens: 4096,
  temperature: 0.3,
  frequencyPenalty: 0.5,
  maxRetries: 2,
};

const FALLBACK_SRS: SrsConfig = { minEaseFactor: 1.3, defaultEaseFactor: 2.5 };

const FALLBACK_NOTIFICATIONS: NotificationDefaults = {
  defaultTime: "08:00",
  defaultType: "srs",
  inactivityDays: 14,
};

const FALLBACK_DICTIONARY: DictionaryConfig = {
  flashcardLimit: 10,
  notificationDictLimit: 1,
  wordOfDayLimit: 1,
};

const FALLBACK_PRESETS: TranslationPresetConfig[] = [
  {
    name: "full",
    label: "Full Output",
    config: {
      synonyms: true,
      examples: true,
      alternatives: true,
      equivalentNote: true,
      connotationWarning: true,
    },
    isActive: true,
  },
  {
    name: "reliable",
    label: "Reliable Output",
    config: {
      synonyms: false,
      examples: false,
      alternatives: false,
      equivalentNote: false,
      connotationWarning: false,
    },
    isActive: true,
  },
  {
    name: "minimal",
    label: "Minimal Output",
    config: {
      synonyms: false,
      examples: false,
      alternatives: false,
      equivalentNote: false,
      connotationWarning: false,
    },
    isActive: true,
  },
  {
    name: "notification",
    label: "Notification Output",
    config: {
      synonyms: false,
      examples: true,
      alternatives: false,
      equivalentNote: false,
      connotationWarning: false,
    },
    isActive: true,
  },
  {
    name: "sentence",
    label: "Sentence Output",
    config: {
      synonyms: false,
      examples: false,
      alternatives: false,
      equivalentNote: false,
      connotationWarning: false,
    },
    isActive: true,
  },
];

export class SettingsService implements SettingsPort {
  private port: SettingsPort;
  private cache = new Map<string, CacheEntry<unknown>>();

  constructor(port: SettingsPort) {
    this.port = port;
  }

  private getCached<T>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.value;
  }

  private setCache<T>(key: string, value: T): void {
    this.cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  invalidate(key?: string): void {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }

  async getPlanLimits(): Promise<PlanLimitConfig[]> {
    const cached = this.getCached<PlanLimitConfig[]>("planLimits");
    if (cached) return cached;
    const dbPlans = await this.port.getPlanLimits();
    const result = dbPlans.length > 0 ? dbPlans : FALLBACK_PLAN_LIMITS;
    this.setCache("planLimits", result);
    return result;
  }

  async getPlanLimit(plan: SubscriptionPlan): Promise<PlanLimitConfig | null> {
    const plans = await this.getPlanLimits();
    return plans.find((p) => p.name === plan) ?? null;
  }

  async getAIModels(): Promise<AIModel[]> {
    const cached = this.getCached<AIModel[]>("aiModels");
    if (cached) return cached;
    const dbModels = await this.port.getAIModels();
    const result = dbModels.length > 0 ? dbModels : FALLBACK_AI_MODELS;
    this.setCache("aiModels", result);
    return result;
  }

  async getEnabledAIModels(): Promise<AIModel[]> {
    const cached = this.getCached<AIModel[]>("enabledAIModels");
    if (cached) return cached;
    const dbModels = await this.port.getEnabledAIModels();
    const result = dbModels.length > 0 ? dbModels : FALLBACK_AI_MODELS;
    this.setCache("enabledAIModels", result);
    return result;
  }

  async getEnabledAIModelsForPlan(plan: SubscriptionPlan): Promise<AIModel[]> {
    const cacheKey = `enabledAIModels:${plan}`;
    const cached = this.getCached<AIModel[]>(cacheKey);
    if (cached) return cached;
    const dbModels = await this.port.getEnabledAIModelsForPlan(plan);
    const result = dbModels.length > 0 ? dbModels : await this.getEnabledAIModels();
    this.setCache(cacheKey, result);
    return result;
  }

  async getDefaultAIModel(): Promise<string | null> {
    const cached = this.getCached<string | null>("defaultAIModel");
    if (cached) return cached;
    const dbDefault = await this.port.getDefaultAIModel();
    const result = dbDefault ?? "openai/gpt-5-nano";
    this.setCache("defaultAIModel", result);
    return result;
  }

  async getDefaultAIModelForPlan(plan: SubscriptionPlan): Promise<string | null> {
    const cacheKey = `defaultAIModel:${plan}`;
    const cached = this.getCached<string | null>(cacheKey);
    if (cached) return cached;
    const dbDefault = await this.port.getDefaultAIModelForPlan(plan);
    const result = dbDefault ?? (await this.getDefaultAIModel());
    this.setCache(cacheKey, result);
    return result;
  }

  async getAIGenerationDefaults(): Promise<AIGenerationDefaults> {
    const cached = this.getCached<AIGenerationDefaults>("aiDefaults");
    if (cached) return cached;
    const dbDefaults = await this.port.getAIGenerationDefaults();
    this.setCache("aiDefaults", dbDefaults);
    return dbDefaults;
  }

  async getSrsConfig(): Promise<SrsConfig> {
    const cached = this.getCached<SrsConfig>("srsConfig");
    if (cached) return cached;
    const dbConfig = await this.port.getSrsConfig();
    this.setCache("srsConfig", dbConfig);
    return dbConfig;
  }

  async getNotificationDefaults(): Promise<NotificationDefaults> {
    const cached = this.getCached<NotificationDefaults>("notifDefaults");
    if (cached) return cached;
    const dbDefaults = await this.port.getNotificationDefaults();
    this.setCache("notifDefaults", dbDefaults);
    return dbDefaults;
  }

  async getDictionaryConfig(): Promise<DictionaryConfig> {
    const cached = this.getCached<DictionaryConfig>("dictionaryConfig");
    if (cached) return cached;
    const dbConfig = await this.port.getDictionaryConfig();
    this.setCache("dictionaryConfig", dbConfig);
    return dbConfig;
  }

  async getTranslationPresets(): Promise<TranslationPresetConfig[]> {
    const cached = this.getCached<TranslationPresetConfig[]>("presets");
    if (cached) return cached;
    const dbPresets = await this.port.getTranslationPresets();
    const result = dbPresets.length > 0 ? dbPresets : FALLBACK_PRESETS;
    this.setCache("presets", result);
    return result;
  }

  async getVideoVocabularyConfig(): Promise<VideoVocabularyConfig> {
    const cached = this.getCached<VideoVocabularyConfig>("videoVocabulary");
    if (cached) return cached;
    const config = await this.port.getVideoVocabularyConfig();
    this.setCache("videoVocabulary", config);
    return config;
  }
}

export {
  FALLBACK_AI_DEFAULTS,
  FALLBACK_AI_MODELS,
  FALLBACK_DICTIONARY,
  FALLBACK_NOTIFICATIONS,
  FALLBACK_PLAN_LIMITS,
  FALLBACK_PRESETS,
  FALLBACK_SRS,
};
