import type {
  ClarificationOption,
  DictionaryFilterState,
  DictionaryPage,
  DictionarySort,
  EntryDetail,
  LoaderPhrases,
  Me,
  Rating,
  ReviewState,
  Settings,
  SettingsPatch,
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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
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
  dictionary: (query: { q: string; sort: DictionarySort; page: number } & DictionaryFilterState) => {
    const params = new URLSearchParams({ q: query.q, sort: query.sort, page: String(query.page) });
    for (const key of ["lang", "type", "difficulty", "review"] as const) {
      if (query[key]) params.set(key, query[key]);
    }
    return request<DictionaryPage>("GET", `/dictionary?${params}`);
  },
  loaderPhrases: (kind: "translate") => request<LoaderPhrases>("GET", `/loader/${kind}`),
  translate: (text: string, answer: TranslateAnswer = {}) =>
    request<TranslateResult>("POST", "/translate", { text, ...answer }),
  entry: (entryId: number) => request<EntryDetail>("GET", `/dictionary/${entryId}`),
  removeEntry: (entryId: number) => request<void>("DELETE", `/dictionary/${entryId}`),
  restoreEntry: (entryId: number) => request<void>("POST", `/dictionary/${entryId}/restore`),
  reviewNext: () => request<ReviewState>("GET", "/review/next"),
  reviewCard: (entryId: number) => request<ReviewState>("GET", `/review/card/${entryId}`),
  rate: (entryId: number, rating: Rating) => request<ReviewState>("POST", `/review/${entryId}`, { rating }),
};
