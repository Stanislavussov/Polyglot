export type ArticleProcessStatus = "pending" | "processing" | "completed" | "failed";

export interface ArticleProcess {
  id: number;
  userId: number;
  url: string;
  title: string;
  siteName: string | null;
  language: string;
  /** The cleaned, length-capped article body the extraction reads. */
  content: string;
  wordCount: number;
  truncated: boolean;
  status: ArticleProcessStatus;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ArticlePhrase {
  id: number;
  articleProcessId: number;
  phrase: string;
  nativeTranslation: string | null;
  emoji: string | null;
  phraseType: string | null;
  level: string | null;
  context: string | null;
  sortOrder: number;
  savedEntryId: number | null;
  createdAt: Date;
}

export interface CreateArticleProcessInput {
  userId: number;
  url: string;
  title: string;
  siteName: string | null;
  language: string;
  content: string;
  wordCount: number;
  truncated: boolean;
}

export interface SaveArticlePhraseInput {
  phrase: string;
  nativeTranslation?: string;
  emoji?: string;
  phraseType?: string;
  level?: string;
  context?: string;
  sortOrder: number;
}

export interface ArticleVocabularyRepository {
  createProcess(input: CreateArticleProcessInput): Promise<ArticleProcess>;
  updateProcessStatus(processId: number, status: ArticleProcessStatus, errorMessage?: string): Promise<void>;
  /** The declared page language is a hint; the extraction reports what the text really is. */
  updateProcessLanguage(processId: number, language: string): Promise<void>;
  /** Marks runs stuck in pending/processing for longer than `maxAgeMinutes` as failed. */
  expireStaleProcesses(maxAgeMinutes: number): Promise<number>;
  findProcessById(processId: number): Promise<ArticleProcess | null>;
  findProcessByUserAndUrl(userId: number, url: string): Promise<ArticleProcess | null>;
  findProcessesByUser(
    userId: number,
    page: number,
    pageSize: number,
    excludeFailed: boolean,
  ): Promise<ArticleProcess[]>;
  countProcessesByUser(userId: number, excludeFailed: boolean): Promise<number>;
  savePhrases(processId: number, phrases: SaveArticlePhraseInput[]): Promise<void>;
  findPhrasesByProcess(processId: number, offset: number, limit: number): Promise<ArticlePhrase[]>;
  countPhrasesByProcess(processId: number): Promise<number>;
  findPhraseById(phraseId: number): Promise<ArticlePhrase | null>;
  markPhraseSaved(phraseId: number, entryId: number): Promise<void>;
  /** Every phrase already extracted for this user from earlier articles in `language`. */
  findKnownPhrasesByUser(userId: number, language: string, excludeProcessId: number): Promise<string[]>;
}
