// Moved to core so every channel resolves the model the same way; re-exported so bot imports (and their mocks) stay put.
export {
  AIModelNotConfiguredError,
  buildAiFailover,
  MIN_FAILOVER_BUDGET_MS,
  RESERVED_FALLBACK_MS,
  resolveDefaultAIModel,
  resolveFallbackAIModel,
} from "@polyglot/core";
