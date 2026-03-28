// Context Enrichment — public API
export {
  translateBatchWithContext,
  translateOneWithContext,
  translateWithContext,
} from "./context-enrichment.service.js";

// Types
export type {
  ContextEnrichmentDeps,
  ContextLookupFn,
  EnrichedTranslateInput,
} from "./types.js";
