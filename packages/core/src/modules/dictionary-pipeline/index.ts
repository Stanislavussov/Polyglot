/**
 * Dictionary Word Pipeline — barrel exports.
 *
 * Config-driven pipeline for reading words from a user's dictionary
 * and delivering them to any output format (flash cards, notifications, quizzes).
 */

export { createDictionaryPipeline } from "./pipeline.js";

export {
  FLASHCARD_CONFIG,
  NOTIFICATION_DICT_CONFIG,
  WORD_OF_DAY_DICT_CONFIG,
} from "./presets.js";
export type {
  DictionaryPipelineDeps,
  DictionaryWordConfig,
  FlashCardPresentationConfig,
  PipelineEntry,
  PipelineTranslationRow,
  PresentationConfig,
  WordDisplayData,
  WordDisplayTranslation,
  WordFilter,
  WordPipelineResult,
  WordSelectionConfig,
  WordSelectionStrategy,
} from "./types.js";
