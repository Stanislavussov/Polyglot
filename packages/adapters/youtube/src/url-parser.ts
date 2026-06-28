/**
 * YouTube URL detection and video ID extraction.
 */

const YOUTUBE_PATTERNS = [
  // youtube.com/watch?v=ID
  /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?[^#]*v=([a-zA-Z0-9_-]{11})/,
  // youtu.be/ID
  /(?:https?:\/\/)?youtu\.be\/([a-zA-Z0-9_-]{11})/,
  // youtube.com/shorts/ID
  /(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  // m.youtube.com/watch?v=ID
  /(?:https?:\/\/)?m\.youtube\.com\/watch\?[^#]*v=([a-zA-Z0-9_-]{11})/,
  // youtube.com/embed/ID
  /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
];

const VIDEO_PLATFORM_PATTERNS = [
  /(?:https?:\/\/)?(?:www\.)?vimeo\.com/i,
  /(?:https?:\/\/)?(?:www\.)?dailymotion\.com/i,
  /(?:https?:\/\/)?(?:www\.)?tiktok\.com/i,
  /(?:https?:\/\/)?(?:vm\.)?tiktok\.com/i,
  /(?:https?:\/\/)?(?:www\.)?twitch\.tv/i,
  /(?:https?:\/\/)?(?:www\.)?rumble\.com/i,
];

/**
 * Check if text contains a YouTube URL.
 */
export function isYouTubeUrl(text: string): boolean {
  return YOUTUBE_PATTERNS.some((p) => p.test(text));
}

/**
 * Check if text contains a non-YouTube video platform URL.
 * Used to show "only YouTube supported" message.
 */
export function isVideoUrl(text: string): boolean {
  if (isYouTubeUrl(text)) return false;
  return VIDEO_PLATFORM_PATTERNS.some((p) => p.test(text));
}

/**
 * Extract YouTube video ID from a URL.
 * Returns null if no valid YouTube URL found.
 */
export function extractVideoId(text: string): string | null {
  for (const pattern of YOUTUBE_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}
