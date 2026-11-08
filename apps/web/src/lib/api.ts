import type {
  ClarificationOption,
  Dictionary,
  DictionaryFilterState,
  DictionaryPage,
  DictionarySort,
  EntryDetail,
  IssueType,
  LoaderPhrases,
  Me,
  MentorTurn,
  NotificationPatch,
  PlanInfo,
  Progress,
  Rating,
  ReviewState,
  Settings,
  SettingsPatch,
  TemplateFields,
  TemplateState,
  TranslateAnswer,
  TranslateResult,
} from "./types";

interface ErrorBody {
  code?: string;
  message?: string;
  // limit: "plan" | "daily_ceiling"; rejected: why the text cannot be translated
  reason?: string;
  resetAt?: string;
  maxLength?: number;
  // needs_clarification, needs_language
  sourceLang?: string;
  options?: ClarificationOption[];
  languages?: string[];
  kind?: "ambiguous" | "unrecognized";
  text?: string;
  // add_language
  lang?: string;
  supported?: boolean;
  // feature_locked, mentor_limit
  feature?: string;
  limit?: number;
  // voice_too_long
  max?: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorBody,
  ) {
    super(body.message ?? body.code ?? `HTTP ${status}`);
    this.name = "ApiError";
  }

  get code(): string | undefined {
    return this.body.code;
  }
}

const LOGIN_PATH = "/login/";

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 401 && window.location.pathname !== LOGIN_PATH) {
    window.location.replace(LOGIN_PATH);
  }

  if (!response.ok) {
    const parsed: ErrorBody = await response.json().catch(() => ({}));
    throw new ApiError(response.status, parsed);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const api = {
  authConfig: () => request<{ botId: number; devLogin: boolean }>("GET", "/auth/config"),
  devLogin: () => request<Me>("POST", "/auth/dev"),
  loginWithTelegram: (user: TelegramLoginUser) => request<Me>("POST", "/auth/telegram", user),
  logout: () => request<void>("POST", "/auth/logout"),
  me: () => request<Me>("GET", "/me"),
  settings: () => request<Settings>("GET", "/settings"),
  updateSettings: (patch: SettingsPatch) => request<Settings>("PATCH", "/settings", patch),
  updateNotifications: (patch: NotificationPatch) => request<Settings>("PATCH", "/settings/notifications", patch),
  template: () => request<TemplateState>("GET", "/template"),
  saveTemplate: (fields: TemplateFields) => request<TemplateState>("PUT", "/template", { fields }),
  resetTemplate: () => request<TemplateState>("DELETE", "/template"),
  previewTemplate: (fields: TemplateFields) => request<TranslateResult>("POST", "/template/preview", { fields }),
  plan: () => request<PlanInfo>("GET", "/plan"),
  changes: () => request<{ notes: string[] }>("GET", "/changes"),
  report: (type: IssueType, description: string) => request<void>("POST", "/report", { type, description }),
  dictionaries: () => request<{ items: Dictionary[] }>("GET", "/dictionaries"),
  createDictionary: (name: string) => request<Dictionary>("POST", "/dictionaries", { name }),
  renameDictionary: (id: number, name: string) => request<Dictionary>("PATCH", `/dictionaries/${id}`, { name }),
  deleteDictionary: (id: number) => request<void>("DELETE", `/dictionaries/${id}`),
  /** Into another dictionary; with `from`, out of that one too (move). */
  placeEntry: (entryId: number, to: number, from?: number) =>
    request<Dictionary>("POST", `/dictionary/${entryId}/dictionaries`, { to, from }),
  dictionary: (
    query: { q: string; sort: DictionarySort; page: number; dictionary?: number } & DictionaryFilterState,
  ) => {
    const params = new URLSearchParams({ q: query.q, sort: query.sort, page: String(query.page) });
    if (query.dictionary) params.set("dictionary", String(query.dictionary));
    for (const key of ["lang", "type", "difficulty", "review"] as const) {
      if (query[key]) params.set(key, query[key]);
    }
    return request<DictionaryPage>("GET", `/dictionary?${params}`);
  },
  loaderPhrases: (kind: "translate") => request<LoaderPhrases>("GET", `/loader/${kind}`),
  translate: (text: string, answer: TranslateAnswer = {}) =>
    request<TranslateResult>("POST", "/translate", { text, ...answer }),
  etymology: (card: { original: string; sourceLang: string; inputType: "word" | "phrase" }) =>
    request<{ etymology: string }>("POST", "/translate/etymology", card),
  mentor: (body: {
    card: TranslateResult;
    question?: string;
    explain?: boolean;
    etymology?: string;
    history: MentorTurn[];
  }) => request<{ question: string; answer: string }>("POST", "/mentor", body),
  entry: (entryId: number) => request<EntryDetail>("GET", `/dictionary/${entryId}`),
  // With a dictionary, a word kept in another one only leaves this list (the bot's dictionary delete).
  removeEntry: (entryId: number, dictionary?: number) =>
    request<void>("DELETE", `/dictionary/${entryId}${dictionary ? `?dictionary=${dictionary}` : ""}`),
  restoreEntry: (entryId: number, dictionary?: number) =>
    request<void>("POST", `/dictionary/${entryId}/restore${dictionary ? `?dictionary=${dictionary}` : ""}`),
  /** The spoken word as audio bytes; the server picks the text from the saved entry. */
  audio: async (entryId: number, lang: string): Promise<Blob> => {
    const response = await fetch(`/api/dictionary/${entryId}/audio/${encodeURIComponent(lang)}`, {
      credentials: "same-origin",
    });
    if (!response.ok) {
      const parsed: ErrorBody = await response.json().catch(() => ({}));
      throw new ApiError(response.status, parsed);
    }
    return response.blob();
  },
  onboarding: () =>
    request<{ onboarded: boolean; step: number; hookWords: Record<string, string[]> }>("GET", "/onboarding"),
  onboardingStep: (step: "native" | "languages" | "demo") => request<void>("POST", "/onboarding/step", { step }),
  completeOnboarding: () =>
    request<{ trial: { days: number; words: number; extraDays: number } | null }>("POST", "/onboarding/complete"),
  /** The bot's voice message: the server transcribes a WAV recording with the same model and gate. */
  transcribe: async (audio: Blob): Promise<{ text: string }> => {
    const response = await fetch("/api/voice/transcribe", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "audio/wav" },
      body: audio,
    });
    const parsed: ErrorBody & { text?: string } = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(response.status, parsed);
    return { text: parsed.text ?? "" };
  },
  progress: () => request<Progress>("GET", "/progress"),
  reviewNext: () => request<ReviewState>("GET", "/review/next"),
  reviewCard: (entryId: number) => request<ReviewState>("GET", `/review/card/${entryId}`),
  rate: (entryId: number, rating: Rating) => request<ReviewState>("POST", `/review/${entryId}`, { rating }),
};
