/**
 * Topic module types.
 *
 * Defines the public API types for topic management,
 * built-in datasets, cache status, and dependency injection.
 */
import type { TranslateOutput } from "../translation/types.js";

// ─────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────

/** Metadata for a topic (no translations, just info) */
export interface TopicMeta {
  id: string;
  name: string;
  emoji: string;
  wordCount: number;
}

/** A word within a topic, with translations for each target language */
export interface TopicWord {
  original: string;
  translations: Record<string, LanguageTranslationEntry>;
}

/**
 * A single language translation entry stored in topics.
 * Mirrors the LanguageTranslation from the translation module
 * but kept as a plain type to avoid tight coupling.
 */
export interface LanguageTranslationEntry {
  text: string;
  cefr: string;
  transcription?: string;
  register: string;
  synonyms: Array<{ text: string; register: string }>;
  examples: Array<{ context: string; target: string; native: string }>;
}

/** A full topic with metadata and translated words */
export interface Topic {
  meta: TopicMeta;
  words: TopicWord[];
}

/** Cache status for a topic + language pair */
export interface CacheStatus {
  total: number;
  cached: number;
  missing: number;
  status: "hit" | "miss" | "partial";
}

// ─────────────────────────────────────────────
// Internal types
// ─────────────────────────────────────────────

/** Raw dataset JSON structure (loaded from file) */
export interface TopicDataset {
  id: string;
  name: string;
  emoji: string;
  words: string[];
}

// ─────────────────────────────────────────────
// Dependency injection
// ─────────────────────────────────────────────

/** Cached translation row from the database */
export interface CachedTranslation {
  id: number;
  topicId: string;
  original: string;
  sourceLang: string;
  targetLang: string;
  content: unknown;
  isValid: boolean;
  invalidReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Data needed to store a new cache entry */
export interface NewCachedTranslation {
  topicId: string;
  original: string;
  sourceLang: string;
  targetLang: string;
  content: unknown;
}

/**
 * Dependencies injected into the topic service.
 * Keeps core independent of adapters (db, ai).
 */
export interface TopicDeps {
  /** Batch translate words into target languages */
  translateBatch: (
    words: string[],
    sourceLang: string,
    targetLangs: string[],
  ) => Promise<TranslateOutput[]>;

  /** Translate a single word for one target language (for partial regeneration) */
  translateOne?: (
    word: string,
    sourceLang: string,
    targetLang: string,
  ) => Promise<LanguageTranslationEntry>;

  /** Get a cached translation for a specific word+lang combo */
  getCached: (
    topicId: string,
    original: string,
    sourceLang: string,
    targetLang: string,
  ) => Promise<CachedTranslation | null>;

  /** Store a translation in cache */
  setCached: (data: NewCachedTranslation) => Promise<unknown>;

  /** Generate a list of words for a custom topic (via AI) */
  generateWords?: (prompt: string) => Promise<{
    name: string;
    emoji: string;
    words: string[];
  }>;
}
