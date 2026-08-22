/**
 * Vocabulary Repository Port.
 * Types match the adapter implementation.
 */

// Re-export from core types for use in port interface
import type { Example, SourceUsage, Synonym, TranslationVariant } from "../modules/translation/types.js";

export type { Example, SourceUsage, Synonym, TranslationVariant } from "../modules/translation/types.js";

// Types matching the adapter implementation
export interface VocabularyTranslation {
  id: number;
  entryId: number;
  targetLangId: number;
  text: string;
  expressionType: string | null;
  equivalentNote: string | null;
  usageNote: string | null;
  connotationWarning: string | null;
  details: VocabTranslationDetails | null;
  srsEaseFactor: number;
  srsInterval: number;
  srsDueDate: Date | null;
  srsReviewCount: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface VocabTranslationDetails {
  synonyms: Synonym[];
  examples: Example[];
  alternatives?: TranslationVariant[];
}

export type VocabularySource =
  | {
      type: "video";
      videoUrl: string;
      videoTitle: string;
      timestampSeconds: number | null;
    }
  | {
      /** Saved from a word-picker set; `runId` links back to `word_picker_runs`. */
      type: "wordPicker";
      runId: number;
      presetTitle: string;
    };

export interface VocabularyEntry {
  id: number;
  userId: number;
  original: string;
  sourceLangId: number;
  inputType: "word" | "phrase" | "sentence";
  emoji: string | null;
  nativeMeaning: string | null;
  sourceUsage: SourceUsage | null;
  source: VocabularySource | null;
  /** Task 70 — translated on a "translate as written" override; excluded from notifications/SRS. */
  unverified: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface VocabularyEntryWithTranslations extends VocabularyEntry {
  translations: VocabularyTranslation[];
}

/** Vocabulary entry with resolved source language code (for dictionary pipeline). */
export interface VocabularyEntryWithSourceLang extends VocabularyEntryWithTranslations {
  sourceLangCode: string;
}

export interface CreateVocabularyInput {
  original: string;
  sourceLangId: number;
  inputType: "word" | "phrase" | "sentence";
  /** Card-header emoji. Optional: sentence entries omit it (persisted as null). */
  emoji?: string;
  nativeMeaning?: string;
  sourceUsage?: SourceUsage;
  source?: VocabularySource;
  /** Task 70 — flag the entry as unverified (translated as written). Defaults to false. */
  unverified?: boolean;
  translations: Array<{
    targetLangId: number;
    text: string;
    expressionType?: string;
    equivalentNote?: string;
    usageNote?: string;
    connotationWarning?: string;
    details: VocabTranslationDetails;
  }>;
}

export interface UpdateTranslationData {
  text?: string;
  expressionType?: string | null;
  equivalentNote?: string | null;
  usageNote?: string | null;
  connotationWarning?: string | null;
  details?: VocabTranslationDetails;
}

export interface SrsDueVocabularyCard {
  translationId: number;
  entryId: number;
  original: string;
  sourceLangId: number;
  targetLangId: number;
  inputType: "word" | "phrase" | "sentence";
  emoji: string | null;
  nativeMeaning: string | null;
  sourceUsage: SourceUsage | null;
  text: string;
  expressionType: string | null;
  equivalentNote: string | null;
  usageNote: string | null;
  connotationWarning: string | null;
  details: VocabTranslationDetails | null;
  srsEaseFactor: number;
  srsInterval: number;
  srsDueDate: Date | null;
  srsReviewCount: number;
}

export interface UpdateSrsStateInput {
  easeFactor: number;
  interval: number;
  dueDate: Date;
  reviewCount: number;
}

/** Sort order for the dictionary browse list. */
export type DictionaryListSort = "recent" | "alpha";

/** Optional filters/ordering for the paginated dictionary browse list. */
export interface DictionaryListOptions {
  /** Ordering: "recent" = newest first (default), "alpha" = A→Z by original. */
  sort?: DictionaryListSort;
  /** Case-insensitive substring filter on the original term. Empty/whitespace = no filter. */
  search?: string;
}

export interface VocabularyRepository {
  findById(id: number): Promise<VocabularyEntryWithTranslations | null>;
  findByUser(userId: number, page?: number, pageSize?: number): Promise<VocabularyEntryWithTranslations[]>;
  findByOriginalAndSource(
    userId: number,
    original: string,
    sourceLangId: number,
  ): Promise<VocabularyEntryWithTranslations | null>;
  findOriginalsByUserAndSource(userId: number, sourceLangId: number): Promise<string[]>;
  findByUserWithSourceLang(
    userId: number,
    langResolver: (id: number) => string | undefined,
  ): Promise<VocabularyEntryWithSourceLang[]>;
  create(userId: number, input: CreateVocabularyInput): Promise<{ id: number }>;
  updateEntry(
    entryId: number,
    data: {
      emoji?: string | null;
      nativeMeaning?: string | null;
      sourceUsage?: SourceUsage | null;
      source?: VocabularySource | null;
    },
  ): Promise<void>;
  updateTranslation(entryId: number, targetLangId: number, data: UpdateTranslationData): Promise<VocabularyTranslation>;
  /** Replace all translations for an entry (full card regen) — see adapter for upsert/SRS-preserving semantics. */
  updateAllTranslations(
    entryId: number,
    translations: Array<{
      targetLangId: number;
      text: string;
      expressionType?: string;
      equivalentNote?: string;
      usageNote?: string;
      connotationWarning?: string;
      details: VocabTranslationDetails;
    }>,
  ): Promise<VocabularyTranslation[]>;
  /** Permanently delete an entry (used after the last dictionary membership is removed). */
  hardDelete(entryId: number): Promise<void>;
  findDueForSrs(userId: number, now: Date, limit: number): Promise<SrsDueVocabularyCard[]>;
  updateSrsState(translationId: number, state: UpdateSrsStateInput): Promise<void>;
  search(userId: number, query: string): Promise<VocabularyEntryWithTranslations[]>;
  countByUser(userId: number, dictionaryId?: number, search?: string): Promise<number>;
  findByUserPaginated(
    userId: number,
    offset: number,
    limit: number,
    dictionaryId?: number,
    options?: DictionaryListOptions,
  ): Promise<VocabularyEntryWithTranslations[]>;
  delete(entryId: number, userId: number): Promise<void>;
}
