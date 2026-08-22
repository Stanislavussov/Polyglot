/**
 * Pronunciation policy: turn a translated word into delivered audio, spending as
 * little as possible on the way.
 *
 * Everything Telegram- and OpenRouter-specific is injected, so the decision logic
 * — cap enforcement, cache lookup, self-healing on a rejected `file_id` — is
 * exercised in plain unit tests. See `@docs/tasks/77-word-pronunciation-tts.md`.
 */
import { createHash } from "node:crypto";
import type { TtsCacheRepository } from "../../ports/tts-cache.repository.js";

/** Why a pronunciation request produced no audio. */
export type PronunciationFailure = "disabled" | "empty" | "too_long" | "synthesis_failed";

export type PronunciationResult =
  | { ok: true; cached: boolean; charCount: number; generationId: string | null }
  | { ok: false; reason: PronunciationFailure };

export interface SynthesizedSpeech {
  bytes: Uint8Array;
  generationId: string | null;
}

export interface PronunciationDeps {
  cache: TtsCacheRepository;
  /** Calls the speech model. Throws on any provider failure. */
  synthesize: (input: { text: string; modelId: string; voice: string }) => Promise<SynthesizedSpeech>;
  /**
   * Delivers audio to the user and returns the resulting Telegram `file_id`.
   * Throws when Telegram rejects the payload — for a cached `file_id` that is the
   * signal the entry has gone stale.
   */
  deliver: (payload: { fileId: string } | { bytes: Uint8Array }) => Promise<string>;
}

export interface PronunciationInput {
  text: string;
  langCode: string;
  modelId: string;
  voice: string;
  maxChars: number;
}

/**
 * Collapse whitespace and trim. Normalization is part of the cache key, so
 * "  Haus " and "Haus" must not synthesize twice — and must not be spoken
 * differently either.
 */
export function normalizeTtsText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Stable cache-key digest for the normalized text. */
export function hashTtsText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Resolve a pronunciation: serve it from cache when possible, otherwise
 * synthesize once and cache the result.
 *
 * A cached `file_id` that Telegram rejects is not an error the user should see —
 * the entry is dropped and the synthesis path runs once to heal it. Only a second
 * failure surfaces.
 */
export async function playPronunciation(
  input: PronunciationInput,
  deps: PronunciationDeps,
): Promise<PronunciationResult> {
  const text = normalizeTtsText(input.text);
  if (text.length === 0) {
    return { ok: false, reason: "empty" };
  }
  if (!input.modelId) {
    // No model configured is the same condition as the feature being off: there is
    // nothing to call. Task 73 — never substitute a guessed model id here.
    return { ok: false, reason: "disabled" };
  }
  if (text.length > input.maxChars) {
    return { ok: false, reason: "too_long" };
  }

  const key = { text, langCode: input.langCode, modelId: input.modelId, voice: input.voice };

  const hit = await deps.cache.find(key);
  if (hit) {
    try {
      await deps.deliver({ fileId: hit.telegramFileId });
      await deps.cache.touch(hit.id);
      return { ok: true, cached: true, charCount: text.length, generationId: null };
    } catch {
      // Stale file_id (token rotated, file expired server-side). Drop it and fall
      // through to synthesis so the user still hears the word.
      await deps.cache.remove(hit.id);
    }
  }

  let speech: SynthesizedSpeech;
  try {
    speech = await deps.synthesize({ text, modelId: input.modelId, voice: input.voice });
  } catch {
    return { ok: false, reason: "synthesis_failed" };
  }

  let fileId: string;
  try {
    fileId = await deps.deliver({ bytes: speech.bytes });
  } catch {
    return { ok: false, reason: "synthesis_failed" };
  }

  // Caching is an optimization, never a reason to fail a delivery the user already
  // received — a losing race on the unique index must not surface as an error.
  try {
    await deps.cache.save({ ...key, telegramFileId: fileId, charCount: text.length });
  } catch {
    // Intentionally swallowed; the audio was delivered.
  }

  return { ok: true, cached: false, charCount: text.length, generationId: speech.generationId };
}
