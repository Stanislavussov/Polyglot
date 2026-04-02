/**
 * Lite AI Validation — Public API
 *
 * Re-exports all public types, schemas, constants, and functions
 * from the lite-ai validation sub-module.
 */

// Types
export type {
  AsyncValidationParams,
  LiteValidationInput,
  LiteValidationResult,
  LiteValidationScore,
  RiskDetectorInput,
} from "./types.js";

// Schemas and constants
export { liteValidationResultSchema, liteValidationScoreSchema, REVIEW_THRESHOLD } from "./schemas.js";

// Risk detection
export { isHighRisk, SAFE_LANGUAGES } from "./risk-detector.js";

// Service
export { validateWithLiteAI } from "./lite-validation.service.js";
export type { LiteGenerateObjectFn } from "./lite-validation.service.js";

// Prompt builder
export { buildLiteValidationPrompt } from "./prompt.builder.js";

// Async trigger
export { triggerAsyncValidation } from "./async-validator.js";
