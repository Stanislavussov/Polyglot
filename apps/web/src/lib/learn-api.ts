import { request } from "./api";
import type { MentorTurn } from "./types";

export interface GrammarIssue {
  fragment: string;
  correction: string;
  category: string;
  categoryLabel: string;
  explanation: string;
  example: string;
}

export type GrammarResult =
  | {
      status: "checked";
      language: string;
      correctedText: string;
      naturalAlternative: string | null;
      errors: GrammarIssue[];
    }
  | { status: "unsupported_language"; languages: string[] };

export interface Expression {
  expression: string;
  translation?: string | null;
  meaning: string;
  sourceKind: string;
  sourceTitle?: string | null;
  example: string;
  lang: string;
}

export interface LangOption {
  code: string;
  flag: string | null;
  name: string;
}

export interface PickPreset {
  id: number;
  emoji: string;
  title: string;
  langs: LangOption[];
}

export interface PickItem {
  id: number;
  word: string;
  nativeTranslation: string;
  emoji: string | null;
  type: string | null;
  level: string | null;
  exampleTarget: string | null;
  exampleNative: string | null;
  note: string | null;
  saved: boolean;
}

export interface PickedSet {
  run: { id: number; presetId: number | null; title: string; emoji: string; lang: LangOption };
  items: PickItem[];
}

export type PickOutcome = ({ status: "generated" } & PickedSet) | { status: "empty"; others: PickPreset[] };

export interface Video {
  id: number;
  title: string | null;
  url: string;
  durationSeconds: number | null;
  language: string;
  status: "pending" | "processing" | "completed" | "failed";
  createdAt: string;
}

export interface VideoSuggestion {
  lang: string;
  index: number;
  title: string;
  channel: string;
  flag: string | null;
}

export interface VideoPhrase {
  id: number;
  phrase: string;
  nativeTranslation: string | null;
  emoji: string | null;
  type: string | null;
  level: string | null;
  context: string | null;
  timestampSeconds: number | null;
  saved: boolean;
}

export type VideoSubmit =
  | { status: "existing"; video: Video }
  | { status: "confirm"; video: Video; remaining: number | null; limit: number | null };

export interface Article {
  id: number;
  title: string;
  url: string;
  siteName: string | null;
  language: string;
  wordCount: number;
  truncated: boolean;
  status: "pending" | "processing" | "completed" | "failed";
  createdAt: string;
}

export interface ArticlePhrase {
  id: number;
  phrase: string;
  nativeTranslation: string | null;
  emoji: string | null;
  type: string | null;
  level: string | null;
  context: string | null;
  saved: boolean;
}

export type ArticleSubmit =
  | { status: "existing"; article: Article }
  | { status: "confirm"; article: Article; excerpt: string };

export interface SaveResult {
  saved: number;
  alreadySaved: boolean;
}

export const learnApi = {
  mentorChat: (question: string, history: MentorTurn[]) =>
    request<{ question: string; answer: string }>("POST", "/mentor/chat", { question, history }),
  grammarCheck: (text: string) => request<GrammarResult>("POST", "/grammar-check", { text }),
  expression: (avoid: string[]) => request<{ expression: Expression }>("POST", "/expressions", { avoid }),
  pickPresets: () => request<{ presets: PickPreset[]; noLanguage: boolean }>("GET", "/word-picker/presets"),
  pickSet: (presetId: number, lang: string) => request<PickOutcome>("POST", "/word-picker/sets", { presetId, lang }),
  pickSave: (itemId: number) => request<SaveResult>("POST", `/word-picker/items/${itemId}/save`),
  pickSaveAll: (runId: number) => request<SaveResult>("POST", `/word-picker/runs/${runId}/save-all`),
  videos: (page: number) =>
    request<{ videos: Video[]; page: number; totalPages: number; suggestions: VideoSuggestion[] }>(
      "GET",
      `/videos?page=${page}`,
    ),
  submitVideo: (body: { url: string } | { suggestion: { lang: string; index: number } }) =>
    request<VideoSubmit>("POST", "/videos", body),
  confirmVideo: (id: number) => request<{ status: "processing" }>("POST", `/videos/${id}/confirm`),
  cancelVideo: (id: number) => request<void>("POST", `/videos/${id}/cancel`),
  video: (id: number, page: number) =>
    request<{ video: Video; page: number; totalPages: number; phrases: VideoPhrase[] }>(
      "GET",
      `/videos/${id}?page=${page}`,
    ),
  saveVideoPhrase: (phraseId: number) => request<SaveResult>("POST", `/videos/phrases/${phraseId}/save`),
  saveAllVideoPhrases: (id: number) => request<SaveResult>("POST", `/videos/${id}/save-all`),
  articles: (page: number) =>
    request<{ articles: Article[]; page: number; totalPages: number }>("GET", `/articles?page=${page}`),
  submitArticle: (url: string) => request<ArticleSubmit>("POST", "/articles", { url }),
  confirmArticle: (id: number) => request<{ status: "processing" }>("POST", `/articles/${id}/confirm`),
  cancelArticle: (id: number) => request<void>("POST", `/articles/${id}/cancel`),
  article: (id: number, page: number) =>
    request<{ article: Article; page: number; totalPages: number; phrases: ArticlePhrase[] }>(
      "GET",
      `/articles/${id}?page=${page}`,
    ),
  saveArticlePhrase: (phraseId: number) => request<SaveResult>("POST", `/articles/phrases/${phraseId}/save`),
  saveAllArticlePhrases: (id: number) => request<SaveResult>("POST", `/articles/${id}/save-all`),
};
