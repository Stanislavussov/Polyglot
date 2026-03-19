// Service
export {
  analyzeIdiom,
  analyzeIdiomBatch,
  needsIdiomReview,
} from './idiom-analysis.service.js';
export type { AnalyzeInput } from './idiom-analysis.service.js';

// Types
export type {
  IdiomClassification,
  SourceExpressionType,
  IdiomAnalysisInput,
  IdiomAnalysisResult,
  GenerateObjectFn,
} from './types.js';

// Schemas
export {
  idiomClassificationSchema,
  sourceExpressionTypeSchema,
  idiomAnalysisResultSchema,
} from './schemas/idiom-analysis.schema.js';

// Prompt builder
export { buildIdiomAnalysisPrompt } from './prompt.builder.js';
