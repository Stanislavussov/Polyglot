/**
 * YouTube transcript fetching — wraps youtube-transcript package.
 * Prioritizes manual subtitles, falls back to auto-generated.
 */

import {
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptNotAvailableLanguageError,
  YoutubeTranscriptVideoUnavailableError,
  fetchTranscript as ytFetchTranscript,
} from "youtube-transcript";
import type { TranscriptResult, TranscriptSegment } from "./types.js";

/**
 * Format transcript segments with timestamp markers for AI consumption.
 * Inserts `[Ns]` markers (seconds) every ~5 seconds so the AI can
 * anchor extracted phrases to real timestamps with high accuracy.
 * Uses plain seconds (e.g. `[120s]`) to avoid M:SS→seconds conversion errors by AI.
 */
export function formatSegmentedTranscript(segments: TranscriptSegment[]): string {
  if (segments.length === 0) return "";

  const parts: string[] = [];
  let lastMarkerTime = -Infinity;

  for (const seg of segments) {
    if (seg.offset - lastMarkerTime >= 5) {
      parts.push(`[${Math.round(seg.offset)}s]`);
      lastMarkerTime = seg.offset;
    }
    parts.push(seg.text);
  }

  return parts.join(" ");
}

export class TranscriptNotAvailableError extends Error {
  constructor(videoId: string, language?: string) {
    const msg = language
      ? `No transcript available for video ${videoId} in language "${language}"`
      : `No transcript available for video ${videoId}`;
    super(msg);
    this.name = "TranscriptNotAvailableError";
  }
}

export class VideoNotFoundError extends Error {
  constructor(videoId: string) {
    super(`Video not found or unavailable: ${videoId}`);
    this.name = "VideoNotFoundError";
  }
}

/**
 * Fetch transcript for a YouTube video.
 * Attempts the requested language first; falls back to default if unavailable.
 */
export async function fetchTranscript(videoId: string, language?: string): Promise<TranscriptResult> {
  try {
    const responses = await ytFetchTranscript(videoId, language ? { lang: language } : undefined);

    if (responses.length === 0) {
      throw new TranscriptNotAvailableError(videoId, language);
    }

    const segments: TranscriptSegment[] = responses.map((r) => ({
      text: r.text,
      offset: r.offset / 1000, // youtube-transcript returns ms, we want seconds
      duration: r.duration / 1000,
    }));

    const text = segments.map((s) => s.text).join(" ");

    // Determine language from first response with lang, fallback to requested or "unknown"
    const detectedLang = responses[0]?.lang ?? language ?? "unknown";

    // We can't reliably distinguish manual vs auto-generated from this API,
    // so default to "auto-generated" and let upstream override if known
    const type: TranscriptResult["type"] = "auto-generated";

    return { text, segments, type, language: detectedLang };
  } catch (error) {
    if (error instanceof YoutubeTranscriptVideoUnavailableError) {
      throw new VideoNotFoundError(videoId);
    }
    if (
      error instanceof YoutubeTranscriptDisabledError ||
      error instanceof YoutubeTranscriptNotAvailableError ||
      error instanceof YoutubeTranscriptNotAvailableLanguageError
    ) {
      throw new TranscriptNotAvailableError(videoId, language);
    }
    throw error;
  }
}
