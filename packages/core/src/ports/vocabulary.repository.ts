/**
 * Vocabulary Repository Port.
 * Types match the adapter implementation.
 */

// Re-export from core types for use in port interface
import type { Example, Synonym, TranslationVariant } from "../modules/translation/types.js";

export type { Example, Synonym, TranslationVariant } from "../modules/translation/types.js";

// Types matching the adapter implementation
export interface VocabularyTranslation {
  id: number;
  entryId: number;
  targetLangId: number;
  text: string;
  expressionType: string | null;
  equivalentNote: string | null;
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

export interface VocabularyEntry {
  id: number;
  userId: number;
  original: string;
  sourceLangId: number;
  inputType: "word" | "phrase";
  emoji: string | null;
  nativeMeaning: string | null;
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
  inputType: "word" | "phrase";
  emoji: string;
  nativeMeaning?: string;
  translations: Array<{
    targetLangId: number;
    text: string;
    expressionType?: string;
    equivalentNote?: string;
    connotationWarning?: string;
    details: VocabTranslationDetails;
  }>;
}

export interface UpdateTranslationData {
  text?: string;
  expressionType?: string | null;
  equivalentNote?: string | null;
  connotationWarning?: string | null;
  details?: VocabTranslationDetails;
}

export interface SrsDueVocabularyCard {
  translationId: number;
  entryId: number;
  original: string;
  sourceLangId: number;
  targetLangId: number;
  inputType: "word" | "phrase";
  emoji: string | null;
  nativeMeaning: string | null;
  text: string;
  expressionType: string | null;
  equivalentNote: string | null;
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

export interface VocabularyRepository {
  findById(id: number): Promise<VocabularyEntryWithTranslations | null>;
  findByUser(userId: number, page?: number, pageSize?: number): Promise<VocabularyEntryWithTranslations[]>;
  findByOriginalAndSource(
    userId: number,
    original: string,
    sourceLangId: number,
  ): Promise<VocabularyEntryWithTranslations | null>;
  findByUserWithSourceLang(
    userId: number,
    langResolver: (id: number) => string | undefined,
  ): Promise<VocabularyEntryWithSourceLang[]>;
  create(userId: number, input: CreateVocabularyInput): Promise<{ id: number }>;
  updateTranslation(entryId: number, targetLangId: number, data: UpdateTranslationData): Promise<void>;
  findDueForSrs(userId: number, now: Date, limit: number): Promise<SrsDueVocabularyCard[]>;
  updateSrsState(translationId: number, state: UpdateSrsStateInput): Promise<void>;
  search(userId: number, query: string): Promise<VocabularyEntryWithTranslations[]>;
  countByUser(userId: number): Promise<number>;
  delete(entryId: number, userId: number): Promise<void>;
}
