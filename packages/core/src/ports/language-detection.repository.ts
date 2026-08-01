/**
 * Port interface for the Language Detection Repository.
 *
 * The bot records language-detection lifecycle events (warning shown,
 * confirmed, cancelled, detected, out_of_set, and the doubtful-source
 * override menu shown/used) as advisory telemetry. Only the write path is
 * part of the DI contract; analytics reads live in the admin surface and use
 * the adapter directly.
 */

export interface RecordLanguageDetectionEventInput {
  userId?: number;
  eventType:
    | "warning_shown"
    | "confirmed"
    | "cancelled"
    | "detected"
    | "out_of_set"
    | "override_shown"
    | "override_used";
  word: string;
  sourceLang?: string;
  targetLangs?: string[];
}

export interface LanguageDetectionRepository {
  record(input: RecordLanguageDetectionEventInput): Promise<void>;
}
