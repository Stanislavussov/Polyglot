export interface TranscriptSegment {
  text: string;
  /** Start time in seconds */
  offset: number;
  /** Duration in seconds */
  duration: number;
}

export interface TranscriptResult {
  /** Full transcript text (all segments joined) */
  text: string;
  /** Individual segments with timestamps */
  segments: TranscriptSegment[];
  /** Whether subtitles are manual or auto-generated */
  type: "manual" | "auto-generated";
  /** Language code of the transcript */
  language: string;
}

export interface VideoMetadata {
  videoId: string;
  title: string;
  /** Duration in seconds (0 if unknown) */
  durationSeconds: number;
}
