/**
 * AI Adapter — public API
 *
 * The only module that knows about OpenRouter and Vercel AI SDK.
 * All other modules receive AI responses through this adapter exclusively.
 *
 * Exports: generateObject, generateText, generateChat, and the provider setters
 * (metric sink, model price, request timeout).
 */

export { setAIApiKey } from "./client.js";
export {
  type AIFallbackEvent,
  type AIFallbackObserver,
  type FallbackReason,
  isRetriableProviderError,
  type ModelFailoverConfig,
  retriableReason,
  setAICircuitBreakerEnabled,
  setAIFallbackObserver,
  withModelFailover,
} from "./failover.js";
export { generateChat, generateObject, generateText } from "./generate.js";
export {
  type AIGenerationDefaultsProvider,
  setAIGenerationDefaultsProvider,
} from "./generation-defaults.js";
export { setAIRequestMetricSink } from "./logger.js";
export {
  type AIModelPrice,
  type AIModelPriceProvider,
  setAIModelPriceProvider,
} from "./model-price.js";
export { type GeneratedSpeech, type GenerateSpeechOptions, generateSpeech } from "./speech.js";
export { type AIRequestTimeoutProvider, setAIRequestTimeoutProvider } from "./timeout.js";
export type { AIModel, AIRequestLog, AIRequestMetricSink, GenerateOptions } from "./types.js";
