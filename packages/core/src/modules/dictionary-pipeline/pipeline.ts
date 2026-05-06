/**
 * Dictionary Word Pipeline — core function.
 *
 * Pure function: config + userId + deps → WordPipelineResult.
 * No DB imports — all data access via injected deps.
 */

import { getLogger } from "../../logger.js";
import type { Register } from "../translation/types.js";
import type {
  DictionaryPipelineDeps,
  DictionaryWordConfig,
  PipelineEntry,
  PipelineTranslationRow,
  WordDisplayData,
  WordDisplayTranslation,
  WordPipelineResult,
} from "./types.js";

/* ------------------------------------------------------------------ */
/*  Filtering                                                          */
/* ------------------------------------------------------------------ */

/**
 * Apply WordFilter to a list of entries.
 * All filters are AND — every condition must be satisfied.
 */
function applyFilters(entries: PipelineEntry[], config: DictionaryWordConfig): PipelineEntry[] {
  const { filter } = config.selection;
  if (!filter) return entries;

  let result = entries;

  // inputType filter
  if (filter.inputType && filter.inputType.length > 0) {
    const allowed = new Set(filter.inputType);
    result = result.filter((e) => allowed.has(e.inputType as "word" | "phrase"));
  }

  // sourceLangId filter
  if (filter.sourceLangId != null) {
    result = result.filter((e) => e.sourceLangId === filter.sourceLangId);
  }

  // targetLang filter — entry must have a translation for this language
  if (filter.targetLang) {
    const lang = filter.targetLang;
    result = result.filter((e) => e.translations.some((t) => t.targetLangCode === lang));
  }

  // excludeIds
  if (filter.excludeIds && filter.excludeIds.length > 0) {
    const excluded = new Set(filter.excludeIds);
    result = result.filter((e) => !excluded.has(e.id));
  }

  return result;
}

/* ------------------------------------------------------------------ */
/*  Selection strategies                                               */
/* ------------------------------------------------------------------ */

/**
 * Apply the selection strategy: sort/shuffle, then take `limit`.
 */
async function selectByStrategy(
  entries: PipelineEntry[],
  config: DictionaryWordConfig,
  deps: DictionaryPipelineDeps,
  userId: number,
): Promise<PipelineEntry[]> {
  const { strategy, limit } = config.selection;
  let sorted: PipelineEntry[];

  switch (strategy) {
    case "random":
      sorted = shuffleArray([...entries]);
      break;

    case "oldest_first":
      sorted = [...entries].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      break;

    case "newest_first":
      sorted = [...entries].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      break;

    case "least_reviewed": {
      const reviewCounts = deps.getReviewCounts ? await deps.getReviewCounts(userId) : new Map<number, number>();

      sorted = [...entries].sort((a, b) => {
        const countA = reviewCounts.get(a.id) ?? 0;
        const countB = reviewCounts.get(b.id) ?? 0;
        if (countA !== countB) return countA - countB;
        // Tiebreaker: oldest first
        return a.createdAt.getTime() - b.createdAt.getTime();
      });
      break;
    }

    default: {
      const _exhaustive: never = strategy;
      throw new Error(`Unknown selection strategy: ${_exhaustive}`);
    }
  }

  return sorted.slice(0, limit);
}

/**
 * Fisher-Yates shuffle (in-place).
 */
function shuffleArray<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/* ------------------------------------------------------------------ */
/*  Display data building                                              */
/* ------------------------------------------------------------------ */

/**
 * Build a single WordDisplayTranslation from a PipelineTranslationRow,
 * applying presentation field masking.
 */
function buildDisplayTranslation(row: PipelineTranslationRow, config: DictionaryWordConfig): WordDisplayTranslation {
  const { fields, showRegister } = config.presentation;

  const result: WordDisplayTranslation = {
    text: row.text,
  };

  if (fields.transcription && row.transcription) {
    result.transcription = row.transcription;
  }

  if (showRegister && row.register) {
    result.register = row.register as Register;
  }

  if (fields.synonyms && row.details?.synonyms && row.details.synonyms.length > 0) {
    result.synonyms = row.details.synonyms;
  }

  if (fields.examples && row.details?.examples && row.details.examples.length > 0) {
    result.examples = row.details.examples;
  }

  if (fields.alternatives && row.details?.alternatives && row.details.alternatives.length > 0) {
    result.alternatives = row.details.alternatives;
  }

  if (row.expressionType) {
    result.expressionType = row.expressionType as "literal" | "idiomatic_equivalent";
  }

  if (fields.equivalentNote && row.equivalentNote) {
    result.equivalentNote = row.equivalentNote;
  }

  return result;
}

/**
 * Build WordDisplayData from a PipelineEntry, applying presentation config.
 */
function buildDisplayData(entry: PipelineEntry, config: DictionaryWordConfig): WordDisplayData | null {
  const { targetLangs, showRegister } = config.presentation;

  // Filter translations by target language if specified
  let translationRows = entry.translations;
  if (targetLangs && targetLangs.length > 0) {
    const allowed = new Set(targetLangs);
    translationRows = translationRows.filter((t) => allowed.has(t.targetLangCode));
  }

  // If no renderable translations, skip this word
  if (translationRows.length === 0) return null;

  // Build translations record keyed by language code
  const translations: Record<string, WordDisplayTranslation> = {};
  for (const row of translationRows) {
    translations[row.targetLangCode] = buildDisplayTranslation(row, config);
  }

  return {
    id: entry.id,
    original: entry.original,
    sourceLang: entry.sourceLangCode,
    inputType: entry.inputType as "word" | "phrase",
    emoji: entry.emoji ?? "📝",
    register: showRegister && entry.register ? (entry.register as Register) : "neutral",
    createdAt: entry.createdAt,
    translations,
  };
}

/* ------------------------------------------------------------------ */
/*  Pipeline factory                                                   */
/* ------------------------------------------------------------------ */

/**
 * Create a dictionary pipeline with injected dependencies.
 *
 * Usage:
 * ```typescript
 * const pipeline = createDictionaryPipeline(deps);
 * const result = await pipeline.run(userId, FLASHCARD_CONFIG);
 * ```
 */
export function createDictionaryPipeline(deps: DictionaryPipelineDeps) {
  return {
    async run(userId: number, config: DictionaryWordConfig): Promise<WordPipelineResult> {
      const logger = getLogger();

      // 1. Fetch all entries
      const allEntries = await deps.findEntriesByUser(userId);
      const totalInDictionary = allEntries.length;

      logger.debug({ userId, totalInDictionary }, `[dictionary-pipeline] ${totalInDictionary} entries in dictionary`);

      if (totalInDictionary === 0) {
        return {
          words: [],
          meta: {
            totalInDictionary: 0,
            selectedCount: 0,
            strategy: config.selection.strategy,
          },
        };
      }

      // 2. Apply filters
      const filtered = applyFilters(allEntries, config);
      logger.debug(
        { count: filtered.length, strategy: config.selection.strategy },
        `[dictionary-pipeline] After filters: ${filtered.length} entries`,
      );

      // 3. Apply strategy + limit
      const selected = await selectByStrategy(filtered, config, deps, userId);
      logger.debug(
        { count: selected.length, limit: config.selection.limit },
        `[dictionary-pipeline] Selected ${selected.length} entries`,
      );

      // 4. Build display data
      const words: WordDisplayData[] = [];
      for (const entry of selected) {
        const displayData = buildDisplayData(entry, config);
        if (displayData) {
          words.push(displayData);
        }
      }

      logger.debug({ count: words.length }, `[dictionary-pipeline] Built ${words.length} display items`);

      return {
        words,
        meta: {
          totalInDictionary,
          selectedCount: words.length,
          strategy: config.selection.strategy,
        },
      };
    },
  };
}
