const BASE_URL = import.meta.env.PUBLIC_API_URL || "http://localhost:3001";

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function getToken(): string | null {
  if (typeof localStorage === "undefined") {
    return null;
  }
  return localStorage.getItem("admin_token");
}

function setToken(token: string): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem("admin_token", token);
  // Mirror the token into a same-origin cookie so the SSR /reports/* endpoint
  // can authenticate direct/iframe report requests, which don't carry the
  // Authorization header (T09). Same JS-readable exposure as localStorage.
  if (typeof document !== "undefined") {
    // biome-ignore lint/suspicious/noDocumentCookie: document.cookie is the universally-supported API; the async CookieStore is not available in all target browsers.
    document.cookie = `admin_token=${token}; path=/; SameSite=Strict`;
  }
}

function clearToken(): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.removeItem("admin_token");
  if (typeof document !== "undefined") {
    // biome-ignore lint/suspicious/noDocumentCookie: document.cookie is the universally-supported API; the async CookieStore is not available in all target browsers.
    document.cookie = "admin_token=; path=/; Max-Age=0; SameSite=Strict";
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  };

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    clearToken();
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
    throw new ApiError(401, "Unauthorized");
  }

  if (!response.ok) {
    const body = await response.text();
    throw new ApiError(response.status, body || response.statusText);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

function get<T>(path: string): Promise<T> {
  return request<T>(path, { method: "GET" });
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) });
}

function put<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "PUT", body: JSON.stringify(body) });
}

function del<T>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" });
}

// Auth
export interface LoginResponse {
  token: string;
  admin: { id: string; email: string };
}

export interface AdminInfo {
  id: string;
  email: string;
}

export const auth = {
  login: (email: string, password: string): Promise<LoginResponse> => {
    clearToken();
    return post<LoginResponse>("/api/auth/login", { email, password }).then((res) => {
      setToken(res.token);
      return res;
    });
  },
  me: () => get<AdminInfo>("/api/auth/me"),
  logout: () => {
    clearToken();
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
  },
};

// Stats
export interface Stats {
  totalUsers: number;
  activeToday: number;
  translationsToday: number;
  totalTranslations: number;
}

export const stats = {
  get: () => get<Stats>("/api/stats"),
};

export interface AIRequestLatencySummary {
  modelId: string;
  requestCount: number;
  averageDurationMs: number;
  maxDurationMs: number;
  successRate: number;
  averageInputTokens: number;
  averageOutputTokens: number;
}

export const aiLatencyStats = {
  list: () => get<AIRequestLatencySummary[]>("/api/stats/ai-latency"),
};

export interface RequestTimingSegmentSummary {
  date: string;
  requestCount: number;
  avgPreflightMs: number;
  avgDbLookupMs: number;
  avgAiRequestMs: number;
  avgTotalMs: number;
  p95TotalMs: number;
  successRate: number;
}

export interface RequestTimingModelSummary {
  modelId: string;
  requestCount: number;
  avgPreflightMs: number;
  avgDbLookupMs: number;
  avgAiRequestMs: number;
  avgTotalMs: number;
  successRate: number;
}

export interface RequestTimingsResponse {
  byDay: RequestTimingSegmentSummary[];
  byModel: RequestTimingModelSummary[];
}

export const requestTimings = {
  list: (days = 7) => get<RequestTimingsResponse>(`/api/stats/request-timings?days=${days}`),
};

export interface UserRequestCount {
  userId: number;
  username: string | null;
  telegramId: number;
  subscriptionPlan: string;
  total: number;
  counts: Record<string, number>;
}

export interface UserRequestCountsResponse {
  days: string[];
  users: UserRequestCount[];
}

export const requestStats = {
  getUserRequestCounts: (days = 30) => get<UserRequestCountsResponse>(`/api/stats/user-request-counts?days=${days}`),
};

export interface LanguageDetectionDaySummary {
  date: string;
  warningShown: number;
  confirmed: number;
  cancelled: number;
}

export interface LanguageDetectionOutcomeSummary {
  totalWarnings: number;
  totalConfirmed: number;
  totalCancelled: number;
  confirmRate: number;
}

export interface LanguageDetectionResponse {
  byDay: LanguageDetectionDaySummary[];
  outcome: LanguageDetectionOutcomeSummary;
}

export const languageDetection = {
  list: (days = 7) => get<LanguageDetectionResponse>(`/api/stats/language-detection?days=${days}`),
};

export interface DictionaryLookupLog {
  id: number;
  lookupInput: string;
  normalizedInput: string;
  langCode: string;
  matched: boolean;
  matchCount: number;
  matchedWord: string | null;
  matchType: string | null;
  matchedPos: string | null;
  matchedGlosses: string[] | null;
  error: string | null;
  createdAt: string;
}

export interface DictionaryLookupSummary {
  totalLookups: number;
  matchedLookups: number;
  failedLookups: number;
  matchRate: number;
}

export interface DictionaryLookupLogResponse {
  logs: DictionaryLookupLog[];
  total: number;
  page: number;
  limit: number;
  summary: DictionaryLookupSummary;
}

export const dictionaryLookupLogs = {
  list: (page = 1, limit = 50, days = 7) => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      days: String(days),
    });
    return get<DictionaryLookupLogResponse>(`/api/stats/dictionary-lookups?${params}`);
  },
};

// Rate Limits
export interface PlanLimitConfig {
  name: string;
  label: string;
  translationLimit: number | null;
  creditCost: number;
  videoLimit: number | null;
  videoWindow: "none" | "lifetime" | "monthly";
  isActive: boolean;
  isDefault: boolean;
  /** Model this plan's users are served by. null = use the globally default model. */
  aiModelId: string | null;
}

export const rateLimits = {
  list: () => get<PlanLimitConfig[]>("/api/settings/rate-limits"),
  update: (plan: PlanLimitConfig) => put<PlanLimitConfig>("/api/settings/rate-limits", plan),
  delete: (name: string) =>
    del<{ fallbackPlan: string; reassignedUsers: number }>(`/api/settings/rate-limits/${encodeURIComponent(name)}`),
};

// AI Models
export interface AIModel {
  id: string;
  name: string;
  provider: string;
  maxTokens: number;
  costPer1kInput: number;
  costPer1kOutput: number;
  isEnabled: boolean;
  isDefault?: boolean;
  /** Model the bot fails over to when the main model fails. At most one. */
  isFallback?: boolean;
}

export type OpenRouterModel = Omit<AIModel, "isDefault" | "isFallback" | "isEnabled"> & {
  purpose: string;
};

function modelPath(id: string): string {
  return encodeURIComponent(id);
}

export const aiModels = {
  list: () => get<AIModel[]>("/api/settings/ai-models"),
  listOpenRouter: () => get<OpenRouterModel[]>("/api/settings/ai-models/openrouter"),
  create: (model: Omit<AIModel, "isDefault" | "isFallback">) => post<AIModel>("/api/settings/ai-models", model),
  setFallback: (modelId: string | null) => put<void>("/api/settings/ai-models/fallback", { modelId }),
  update: (id: string, model: Partial<AIModel>) => put<AIModel>(`/api/settings/ai-models/${modelPath(id)}`, model),
  delete: (id: string) => del<void>(`/api/settings/ai-models/${modelPath(id)}`),
  setDefault: (id: string) => put<void>(`/api/settings/ai-models/${modelPath(id)}/set-default`, {}),
};

export type OpenRouterKeyStatus = "active" | "expiring_soon" | "expired" | "unknown" | "not_configured";

export interface OpenRouterKeyInfo {
  configured: boolean;
  label: string | null;
  expiresAt: string | null;
  status: OpenRouterKeyStatus;
  daysRemaining: number | null;
}

export const openRouter = {
  key: () => get<OpenRouterKeyInfo>("/api/settings/openrouter/key"),
};

// Settings
export interface AIDefaults {
  maxTokens: number;
  temperature: number;
  frequencyPenalty: number;
  maxRetries: number;
  requestTimeoutMs: number;
}

export interface NotificationSettings {
  defaultTime: string;
  defaultType: string;
  inactivityDays: number;
}

export interface SRSSettings {
  minEaseFactor: number;
  defaultEaseFactor: number;
}

export interface DictionarySettings {
  [key: string]: string | number | boolean;
}

export interface VideoVocabularySettings {
  monthlyLimit: number;
  minPhrases: number;
  maxPhrases: number;
  extractionModelId: string;
}

export const settings = {
  aiDefaults: {
    get: () => get<AIDefaults>("/api/settings/ai-defaults"),
    update: (s: AIDefaults) => put<AIDefaults>("/api/settings/ai-defaults", s),
  },
  notifications: {
    get: () => get<NotificationSettings>("/api/settings/notifications"),
    update: (s: NotificationSettings) => put<NotificationSettings>("/api/settings/notifications", s),
  },
  srs: {
    get: () => get<SRSSettings>("/api/settings/srs"),
    update: (s: SRSSettings) => put<SRSSettings>("/api/settings/srs", s),
  },
  dictionary: {
    get: () => get<DictionarySettings>("/api/settings/dictionary"),
    update: (s: DictionarySettings) => put<DictionarySettings>("/api/settings/dictionary", s),
  },
  videoVocabulary: {
    get: () => get<VideoVocabularySettings>("/api/settings/video-vocabulary"),
    update: (s: VideoVocabularySettings) => put<VideoVocabularySettings>("/api/settings/video-vocabulary", s),
  },
};

// Presets
export interface Preset {
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

export const presets = {
  list: () => get<Preset[]>("/api/settings/presets"),
  create: (preset: Omit<Preset, "id">) => post<Preset>("/api/settings/presets", preset),
  update: (id: string, preset: Partial<Preset>) => put<Preset>(`/api/settings/presets/${id}`, preset),
  delete: (id: string) => del<void>(`/api/settings/presets/${id}`),
};

// Users
export type AudienceGroup = "admin" | "tester" | "product";

export interface User {
  id: number;
  telegramId: number;
  username: string | null;
  audienceGroup: AudienceGroup;
  subscriptionPlan: string;
  isActive: boolean;
  createdAt: string;
  interfaceLang: string | null;
  nativeLang: string | null;
  learningLangs: string[] | null;
}

export interface UsersResponse {
  users: User[];
  total: number;
}

export const users = {
  list: (page = 1, limit = 20, search = "") => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      ...(search ? { search } : {}),
    });
    return get<UsersResponse>(`/api/users?${params}`);
  },
  changePlan: (id: number, plan: string) => put<void>(`/api/users/${id}/plan`, { plan }),
  changeAudienceGroup: (id: number, audienceGroup: AudienceGroup) =>
    put<void>(`/api/users/${id}/audience-group`, { audienceGroup }),
};

export type IssueType = "bug" | "suggestion" | "other";
export type IssueStatus = "open" | "in_progress" | "resolved" | "rejected";

export interface ReportedIssue {
  id: number;
  userId: number;
  type: IssueType;
  description: string;
  status: IssueStatus;
  createdAt: string;
  updatedAt: string;
  user: {
    id: number;
    telegramId: number;
    username: string | null;
  };
}

export interface ReportedIssuesResponse {
  issues: ReportedIssue[];
  total: number;
  page: number;
  limit: number;
}

export const reportedIssues = {
  list: (page = 1, limit = 20, status: IssueStatus | "" = "", search = "") => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      ...(status ? { status } : {}),
      ...(search ? { search } : {}),
    });
    return get<ReportedIssuesResponse>(`/api/reported-issues?${params}`);
  },
  updateStatus: (id: number, status: IssueStatus) =>
    put<ReportedIssue>(`/api/reported-issues/${id}/status`, { status }),
};

export { ApiError, clearToken, getToken };
