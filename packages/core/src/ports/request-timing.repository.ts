/**
 * Port interface for the Request Timing Repository.
 *
 * The translate pipeline records per-request timing segments (preflight, DB
 * lookup, AI request, total) as advisory telemetry. Only the write path is
 * part of the DI contract; analytics reads live in the admin surface and use
 * the adapter directly.
 */

export interface RecordRequestTimingInput {
  userId?: number;
  requestType: string;
  preflightMs: number;
  dbLookupMs: number;
  aiRequestMs: number;
  totalMs: number;
  modelId?: string;
  sourceLang?: string;
  targetLangs?: string[];
  inputType?: string;
  success: boolean;
  error?: string;
}

export interface RequestTimingRepository {
  record(input: RecordRequestTimingInput): Promise<void>;
}
