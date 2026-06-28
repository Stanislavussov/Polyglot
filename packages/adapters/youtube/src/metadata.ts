/**
 * YouTube video metadata fetching via oEmbed API (no API key required).
 */

import type { VideoMetadata } from "./types.js";

const OEMBED_URL = "https://www.youtube.com/oembed";

interface OEmbedResponse {
  title: string;
  author_name: string;
  thumbnail_url: string;
}

/**
 * Fetch basic video metadata via YouTube oEmbed endpoint.
 * Does not require an API key. Returns title (duration not available via oEmbed).
 */
export async function fetchMetadata(videoId: string): Promise<VideoMetadata> {
  const url = `${OEMBED_URL}?url=https://www.youtube.com/watch?v=${videoId}&format=json`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch metadata for video ${videoId}: ${response.status}`);
  }

  const data = (await response.json()) as OEmbedResponse;

  return {
    videoId,
    title: data.title,
    durationSeconds: 0, // oEmbed doesn't provide duration
  };
}
