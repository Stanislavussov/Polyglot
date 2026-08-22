/**
 * Storage for synthesized pronunciations, keyed by what determines the audio.
 *
 * The stored payload is a Telegram `file_id`, not audio bytes — re-sending one
 * costs neither an OpenRouter call nor an upload.
 */
export interface TtsCacheKey {
  /** Normalized spoken text (see `normalizeTtsText`). */
  text: string;
  langCode: string;
  modelId: string;
  /** Empty string for models with no voice concept. */
  voice: string;
}

export interface TtsCacheHit {
  id: number;
  telegramFileId: string;
}

export interface TtsCacheRepository {
  find(key: TtsCacheKey): Promise<TtsCacheHit | null>;
  /**
   * Insert a freshly synthesized entry. Concurrent first taps on the same word
   * race here, so implementations must ignore a duplicate-key conflict rather
   * than throw — the cost of losing that race is one redundant synthesis.
   */
  save(entry: TtsCacheKey & { telegramFileId: string; charCount: number }): Promise<void>;
  /** Record a cache hit (bumps `use_count` / `last_used_at`) for hit-rate reporting. */
  touch(id: number): Promise<void>;
  /** Drop an entry whose `file_id` Telegram no longer accepts. */
  remove(id: number): Promise<void>;
}
