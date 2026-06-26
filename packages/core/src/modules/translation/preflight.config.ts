export interface PreflightScoringConfig {
  /** Skip clarification when upstream confidence is at least this high. */
  autoProceedAboveConfidence: number;
  /** Ask for clarification when AI preflight confidence is below this value. */
  clarifyBelowConfidence: number;
  /** Maximum options the AI preflight may return. */
  maxOptions: number;
}

export const PREFLIGHT_DEFAULTS: PreflightScoringConfig = {
  autoProceedAboveConfidence: 0.86,
  clarifyBelowConfidence: 0.72,
  maxOptions: 4,
};
