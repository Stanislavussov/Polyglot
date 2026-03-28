/**
 * Topic Service — manages topics, datasets, and translation caching.
 *
 * Rules:
 * 1. Always checks cache before calling the translation agent
 * 2. Calls translation in batch only — never one word at a time
 * 3. Knows nothing about the user — works with language pairs
 * 4. Built-in datasets are loaded once at startup
 *
 * Dependencies (db, ai) are injected via TopicDeps — core stays platform-independent.
 */

import { createRequire } from "node:module";
import { MINIMAL_OUTPUT } from "../../shared/translation-output.presets.js";
import type {
  CacheStatus,
  LanguageTranslationEntry,
  Topic,
  TopicDataset,
  TopicDeps,
  TopicMeta,
  TopicWord,
} from "./types.js";

// ─────────────────────────────────────────────
// Load built-in datasets once at startup
// ─────────────────────────────────────────────

const require = createRequire(import.meta.url);

const foodData = require("./datasets/food.json") as TopicDataset;
const travelData = require("./datasets/travel.json") as TopicDataset;
const itTermsData = require("./datasets/it-terms.json") as TopicDataset;

const datasets: TopicDataset[] = [foodData, travelData, itTermsData];

// ─────────────────────────────────────────────
// Pure functions (no dependencies needed)
// ─────────────────────────────────────────────

/**
 * Get metadata for all built-in topics.
 * Pure function — no dependencies, no I/O.
 */
export function getBuiltinTopics(): TopicMeta[] {
  return datasets.map((d) => ({
    id: d.id,
    name: d.name,
    emoji: d.emoji,
    wordCount: d.words.length,
  }));
}

/**
 * Get a dataset by topic ID.
 * Internal helper — returns undefined if not found.
 */
export function getDataset(topicId: string): TopicDataset | undefined {
  return datasets.find((d) => d.id === topicId);
}

// ─────────────────────────────────────────────
// Service factory — creates functions bound to injected deps
// ─────────────────────────────────────────────

/**
 * Create a topic service with injected dependencies.
 *
 * @param deps - Injected dependencies (translateBatch, getCached, setCached, generateWords)
 * @returns Object with getTopicWords, generateCustomTopic, getCacheStatus
 */
export function createTopicService(deps: TopicDeps) {
  /**
   * Get words with translations for a topic (cache-first, then AI batch).
   *
   * Flow:
   * 1. Load dataset words for the topic
   * 2. Check cache for each word × each target language
   * 3. Collect words not fully cached
   * 4. Batch translate uncached words via translateBatch
   * 5. Store newly translated results in cache
   * 6. Return all words with merged translations
   *
   * @param topicId - Built-in topic ID (e.g., "food", "travel")
   * @param sourceLang - Source language code (e.g., "en")
   * @param targetLangs - Target language codes (e.g., ["cs", "de"])
   * @returns Array of TopicWord with translations per language
   * @throws Error if topicId not found
   */
  async function getTopicWords(topicId: string, sourceLang: string, targetLangs: string[]): Promise<TopicWord[]> {
    const dataset = getDataset(topicId);
    if (!dataset) {
      throw new Error(`Topic not found: "${topicId}"`);
    }

    const cachedWords: TopicWord[] = [];
    const uncachedOriginals: string[] = [];

    // Phase 1: Check cache for each word
    for (const word of dataset.words) {
      const translations: Record<string, LanguageTranslationEntry> = {};
      let allCached = true;

      for (const lang of targetLangs) {
        const cached = await deps.getCached(topicId, word, sourceLang, lang);
        if (cached) {
          translations[lang] = cached.content as LanguageTranslationEntry;
        } else {
          allCached = false;
          break; // No need to check remaining langs — word needs translation
        }
      }

      if (allCached) {
        cachedWords.push({ original: word, translations });
      } else {
        uncachedOriginals.push(word);
      }
    }

    // Phase 2: Batch translate uncached words (rule: never one at a time)
    // Context enrichment is handled by the injected translateBatch function.
    // Uses MINIMAL_OUTPUT preset — topics only need core fields + transcription.
    let translatedWords: TopicWord[] = [];
    if (uncachedOriginals.length > 0) {
      const outputs = await deps.translateBatch(uncachedOriginals, sourceLang, targetLangs, MINIMAL_OUTPUT);

      translatedWords = await Promise.all(
        outputs.map(async (output) => {
          // Store each language's translation in cache
          for (const lang of targetLangs) {
            const langTranslation = output.translations[lang];
            if (langTranslation) {
              await deps.setCached({
                topicId,
                original: output.original,
                sourceLang,
                targetLang: lang,
                content: langTranslation,
              });
            }
          }

          return {
            original: output.original,
            translations: output.translations as Record<string, LanguageTranslationEntry>,
          };
        }),
      );
    }

    // Merge cached + translated, preserving dataset order
    const wordMap = new Map<string, TopicWord>();
    for (const w of cachedWords) wordMap.set(w.original, w);
    for (const w of translatedWords) wordMap.set(w.original, w);

    return dataset.words.map((word) => wordMap.get(word)).filter((w): w is TopicWord => w !== undefined);
  }

  /**
   * Generate a custom topic via AI.
   *
   * Flow:
   * 1. Call generateWords to get a word list from AI
   * 2. Batch translate all generated words
   * 3. Return a full Topic with meta + translated words
   *
   * @param prompt - User's topic description (e.g., "20 words about sport")
   * @param sourceLang - Source language code
   * @param targetLangs - Target language codes
   * @returns A complete Topic with translations
   * @throws Error if generateWords dependency is not provided
   */
  async function generateCustomTopic(prompt: string, sourceLang: string, targetLangs: string[]): Promise<Topic> {
    if (!deps.generateWords) {
      throw new Error("generateWords dependency is required for custom topic generation");
    }

    // Step 1: Generate word list via AI
    const generated = await deps.generateWords(prompt);

    // Step 2: Batch translate all words
    // Context enrichment is handled by the injected translateBatch function.
    // Uses MINIMAL_OUTPUT preset — topics only need core fields + transcription.
    const outputs = await deps.translateBatch(generated.words, sourceLang, targetLangs, MINIMAL_OUTPUT);

    // Step 3: Build Topic
    const words: TopicWord[] = outputs.map((output) => ({
      original: output.original,
      translations: output.translations as Record<string, LanguageTranslationEntry>,
    }));

    return {
      meta: {
        id: `custom-${Date.now()}`,
        name: generated.name,
        emoji: generated.emoji,
        wordCount: words.length,
      },
      words,
    };
  }

  /**
   * Check cache status for a topic + language combination.
   *
   * Returns how many words are cached vs total for the given language pair.
   *
   * @param topicId - Built-in topic ID
   * @param sourceLang - Source language code
   * @param targetLangs - Target language codes
   * @returns CacheStatus with total, cached, missing counts and status label
   * @throws Error if topicId not found
   */
  async function getCacheStatus(topicId: string, sourceLang: string, targetLangs: string[]): Promise<CacheStatus> {
    const dataset = getDataset(topicId);
    if (!dataset) {
      throw new Error(`Topic not found: "${topicId}"`);
    }

    const total = dataset.words.length;
    let cached = 0;

    for (const word of dataset.words) {
      let allLangsCached = true;

      for (const lang of targetLangs) {
        const entry = await deps.getCached(topicId, word, sourceLang, lang);
        if (!entry) {
          allLangsCached = false;
          break;
        }
      }

      if (allLangsCached) {
        cached++;
      }
    }

    const missing = total - cached;
    let status: CacheStatus["status"];
    if (cached === total) {
      status = "hit";
    } else if (cached === 0) {
      status = "miss";
    } else {
      status = "partial";
    }

    return { total, cached, missing, status };
  }

  /**
   * Regenerate a single language translation for a topic word.
   *
   * Used for partial regeneration — re-translates only the specified
   * target language while keeping other languages intact in cache.
   *
   * Flow:
   * 1. Validate topic and word exist in dataset
   * 2. Call translateOne for the single target language
   * 3. Overwrite the cache entry for that word+lang
   * 4. Return the new LanguageTranslationEntry
   *
   * @param topicId - Built-in topic ID (e.g., "food", "travel")
   * @param original - The word to regenerate (must exist in dataset)
   * @param sourceLang - Source language code (e.g., "en")
   * @param targetLang - Single target language to regenerate (e.g., "cs")
   * @returns The newly translated LanguageTranslationEntry
   * @throws Error if topicId not found, word not in dataset, or translateOne not provided
   */
  async function regenerateTopicWord(
    topicId: string,
    original: string,
    sourceLang: string,
    targetLang: string,
  ): Promise<LanguageTranslationEntry> {
    const dataset = getDataset(topicId);
    if (!dataset) {
      throw new Error(`Topic not found: "${topicId}"`);
    }

    if (!dataset.words.includes(original)) {
      throw new Error(`Word "${original}" not found in topic "${topicId}"`);
    }

    if (!deps.translateOne) {
      throw new Error("translateOne dependency is required for partial regeneration");
    }

    // Re-translate for the single target language.
    // Context enrichment is handled by the injected translateOne function.
    // Uses MINIMAL_OUTPUT preset — topics only need core fields + transcription.
    const newTranslation = await deps.translateOne(original, sourceLang, targetLang, MINIMAL_OUTPUT);

    // Overwrite the cache entry
    await deps.setCached({
      topicId,
      original,
      sourceLang,
      targetLang,
      content: newTranslation,
    });

    return newTranslation;
  }

  return {
    getTopicWords,
    generateCustomTopic,
    getCacheStatus,
    regenerateTopicWord,
  };
}
