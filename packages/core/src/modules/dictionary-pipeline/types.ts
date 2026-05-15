/**
 * Dictionary Word Pipeline — types.
 *
 * Defines the config-driven pipeline that reads words from a user's personal
 * dictionary and delivers them to any output format (flash cards, notifications,
 * quizzes, exports).
 *
 * Architecture:
 * - One config object (DictionaryWordConfig) controls everything
 * - Dependencies injected via DictionaryPipelineDeps — no DB imports
 * - Output is renderer-agnostic WordDisplayData[]
 */

import type { TemplateFields } from "../../shared/translation-template.types.js";
import type { Example, ExpressionType, Synonym, TranslationVariant } from "../translation/types.js";

/* ------------------------------------------------------------------ */
/*  Selection                                                          */
/* ------------------------------------------------------------------ */

/** Strategy for selecting words from the dictionary */
export type WordSelectionStrategy =
  | "random" // random shuffle
  | "oldest_first" // createdAt ASC — review old words
  | "newest_first" // createdAt DESC — review recent additions
  | "least_reviewed"; // fewest entries in word_review_log

/** Filters applied before strategy selects words */
export interface WordFilter {
  /** Only include words of these input types */
  inputType?: Array<"word" | "phrase">;
  /** Only include words with this source language ID */
  sourceLangId?: number;
  /** Only include words that have a translation for this target language code */
  targetLang?: string;
  /** Exclude these entry IDs (already shown in current session) */
  excludeIds?: number[];
}

/** Word selection configuration */
export interface WordSelectionConfig {
  strategy: WordSelectionStrategy;
  /** How many words to select. Default: 10 */
  limit: number;
  filter?: WordFilter;
}

/* ------------------------------------------------------------------ */
/*  Presentation                                                       */
/* ------------------------------------------------------------------ */

/**
 * Which fields to include when presenting a word.
 *
 * Uses TemplateFields from the user's saved translation template (Task 32).
 */

/** Flash-card-specific presentation config */
export interface FlashCardPresentationConfig {
  /** Which side is shown first. Default: 'original' */
  frontSide: "original" | "translation";
}

/** Presentation configuration */
export interface PresentationConfig {
  /** Which target language codes to include. undefined = all stored langs */
  targetLangs?: string[];
  /**
   * Field visibility — loaded from the user's saved template (Task 32).
   * Use resolveTemplate(userTemplate).fields to get TemplateFields.
   */
  fields: TemplateFields;
  flashcard?: FlashCardPresentationConfig;
}

/* ------------------------------------------------------------------ */
/*  Top-level config                                                   */
/* ------------------------------------------------------------------ */

/** Top-level config object — one config drives the entire pipeline */
export interface DictionaryWordConfig {
  selection: WordSelectionConfig;
  presentation: PresentationConfig;
}

/* ------------------------------------------------------------------ */
/*  Display data (renderer-agnostic output)                            */
/* ------------------------------------------------------------------ */

/** Normalized translation data for a single target language (display-ready) */
export interface WordDisplayTranslation {
  text: string;
  transcription?: string;
  synonyms?: Synonym[];
  examples?: Example[];
  alternatives?: TranslationVariant[];
  expressionType?: ExpressionType;
  equivalentNote?: string;
}

/** Normalized word data ready for any renderer (Telegram, export, quiz, etc.) */
export interface WordDisplayData {
  /** DB primary key — used to log reviews, link to saved entry */
  id: number;
  original: string;
  /** ISO 639-1 source language code (e.g. "en") */
  sourceLang: string;
  inputType: "word" | "phrase";
  emoji: string;
  createdAt: Date;
  /** Translations keyed by ISO 639-1 target language code */
  translations: Record<string, WordDisplayTranslation>;
}

/* ------------------------------------------------------------------ */
/*  Pipeline result                                                    */
/* ------------------------------------------------------------------ */

/** Result from running the pipeline for a single user */
export interface WordPipelineResult {
  words: WordDisplayData[];
  meta: {
    /** Total active words in the user's dictionary (before filter/limit) */
    totalInDictionary: number;
    /** Number of words actually selected */
    selectedCount: number;
    strategy: WordSelectionStrategy;
  };
}

/* ------------------------------------------------------------------ */
/*  Dependency injection                                               */
/* ------------------------------------------------------------------ */

/**
 * A single translation row from the normalized vocabulary schema.
 * Mirrors the shape callers will provide from vocabularyTranslations table
 * with the target language code already resolved.
 */
export interface PipelineTranslationRow {
  targetLangCode: string;
  text: string;
  transcription?: string | null;
  register?: string | null;
  expressionType?: string | null;
  equivalentNote?: string | null;
  connotationWarning?: string | null;
  details?: {
    synonyms?: Synonym[];
    examples?: Example[];
    alternatives?: TranslationVariant[];
  } | null;
}

/**
 * A vocabulary entry as provided to the pipeline.
 * Matches the normalized schema shape with resolved language codes.
 */
export interface PipelineEntry {
  id: number;
  original: string;
  sourceLangId: number;
  sourceLangCode: string;
  inputType: string;
  emoji?: string | null;
  createdAt: Date;
  translations: PipelineTranslationRow[];
}

/** Dependencies injected into the pipeline — keeps core free of DB imports */
export interface DictionaryPipelineDeps {
  /**
   * Fetch all active vocabulary entries for a user with resolved language codes.
   * Pipeline applies strategy + filters on top of this.
   */
  findEntriesByUser: (userId: number) => Promise<PipelineEntry[]>;
  /** Fetch review count per entry ID for the given user (for 'least_reviewed') */
  getReviewCounts?: (userId: number) => Promise<Map<number, number>>;
}
