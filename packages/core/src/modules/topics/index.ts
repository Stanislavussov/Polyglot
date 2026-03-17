// Topic service — public API
export {
  getBuiltinTopics,
  getDataset,
  createTopicService,
} from "./topic.service.js";

// Types
export type {
  TopicMeta,
  TopicWord,
  Topic,
  CacheStatus,
  TopicDataset,
  TopicDeps,
  TopicExpressionType,
  LanguageTranslationEntry,
  CachedTranslation,
  NewCachedTranslation,
} from "./types.js";
