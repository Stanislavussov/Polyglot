export interface Me {
  id: number;
  username: string | null;
  plan: string;
  onboarded: boolean;
  interfaceLang: string;
}

export interface Language {
  code: string;
  name: string;
  flag: string;
}

export interface Settings {
  interfaceLang: string;
  nativeLang: string;
  learningLangs: string[];
  interfaceLanguages: string[];
  languages: Language[];
}

export type SettingsPatch = Partial<Pick<Settings, "interfaceLang" | "nativeLang" | "learningLangs">>;

export interface DictionaryItem {
  id: number;
  original: string;
  sourceLang: string;
  emoji: string | null;
  createdAt: string;
  translations: { lang: string; text: string }[];
}

export interface DictionaryPage {
  items: DictionaryItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface EntryReviewState {
  dueAt: string | null;
  intervalDays: number;
  reviewCount: number;
}

export interface EntryDetailTarget {
  lang: string;
  text: string;
  expressionType: string | null;
  equivalentNote: string | null;
  usageNote: string | null;
  connotationWarning: string | null;
  synonyms: string[];
  alternatives: string[];
  examples: TranslateExample[];
  review: EntryReviewState;
}

export interface EntryDetail {
  id: number;
  original: string;
  sourceLang: string;
  emoji: string | null;
  createdAt: string;
  translations: { lang: string; text: string }[];
  inputType: "word" | "phrase" | "sentence";
  nativeMeaning: string | null;
  difficulty: "hard" | "normal" | "easy" | null;
  sourceUsage: TranslateResult["sourceUsage"];
  details: EntryDetailTarget[];
}

export type DictionarySort = "recent" | "alpha";

export type DictionaryType = "word" | "phrase" | "sentence";
export type DictionaryDifficulty = "hard" | "normal" | "easy";
export type DictionaryReview = "due" | "new" | "learned";

/** An empty string means "no filter". */
export interface DictionaryFilterState {
  lang: string;
  type: DictionaryType | "";
  difficulty: DictionaryDifficulty | "";
  review: DictionaryReview | "";
}

export interface TranslateExample {
  context: string;
  target: string;
  native: string | null;
}

export interface TranslateTarget {
  lang: string;
  text: string;
  expressionType: string | null;
  equivalentNote: string | null;
  usageNote: string | null;
  connotationWarning: string | null;
  alternatives: string[];
  synonyms: string[];
  examples: TranslateExample[];
}

export interface TranslateResult {
  original: string;
  sourceLang: string;
  targetLangs: string[];
  sentence: boolean;
  emoji: string | null;
  nativeMeaning: string | null;
  unverified: boolean;
  correction: { original: string; corrected: string; explanation: string } | null;
  sourceUsage: {
    headword: string | null;
    explanation: string;
    synonyms: string[];
    examples: TranslateExample[];
  } | null;
  translations: TranslateTarget[];
  savedEntryId: number | null;
}

export interface ReviewCard {
  entryId: number;
  original: string;
  sourceLang: string;
  emoji: string | null;
  back: { lang: string; text: string }[];
}

export interface ReviewState {
  card: ReviewCard | null;
  dueCount: number;
}

export type Rating = "again" | "hard" | "good" | "easy";
export type PageName = "translate" | "dictionary" | "review" | "settings";

export interface LoaderPhrases {
  emoji: string[];
  stages: string[][];
}
