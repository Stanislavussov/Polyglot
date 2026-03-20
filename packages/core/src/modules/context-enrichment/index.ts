// Context Enrichment — public API
export {
  translateWithContext,
  translateOneWithContext,
  translateBatchWithContext,
} from "./context-enrichment.service.js";

// Types
export type {
  ContextLookupFn,
  ContextEnrichmentDeps,
  EnrichedTranslateInput,
} from "./types.js";
