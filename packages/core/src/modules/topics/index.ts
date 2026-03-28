// Topic service — public API
export {
  createTopicService,
  getBuiltinTopics,
  getDataset,
} from "./topic.service.js";

// Types
export type {
  CachedTranslation,
  CacheStatus,
  LanguageTranslationEntry,
  NewCachedTranslation,
  Topic,
  TopicDataset,
  TopicDeps,
  TopicExpressionType,
  TopicMeta,
  TopicTranslationVariant,
  TopicWord,
} from "./types.js";
