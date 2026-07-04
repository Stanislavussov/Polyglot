/**
 * Video vocabulary extraction service.
 * Pure core logic — no adapter imports. AI function is injected.
 */

import type { GenerateObjectFn } from "../../ports/ai.port.js";
import { buildExtractionPrompt } from "./extraction.prompt.js";
import { extractionResultSchema } from "./extraction.schema.js";
import { normalizePhrase } from "./normalize.js";
import type { ExtractedPhrase, ExtractionResult } from "./types.js";

/** Rough output-token budget per extracted phrase (phrase + translation + context + metadata). */
const TOKENS_PER_PHRASE = 160;
const MIN_OUTPUT_TOKENS = 4096;

/**
 * Extract phrases from a video transcript using AI.
 *
 * @param transcript - Full transcript text
 * @param videoLanguage - Language of the transcript (e.g. "English", "en")
 * @param userLevel - CEFR level of the user (e.g. "B2")
 * @param targetPhrases - Desired number of phrases to extract (scaled by video length)
 * @param generateObjectFn - AI generation function (injected from adapter)
 * @param modelId - AI model ID to use
 * @param nativeLanguage - The user's native language for translations
 * @param knownPhrases - Phrases the learner already has (saved dictionary + prior videos)
 *   in this language; excluded from the result so they are never regenerated. Passed to
 *   the prompt as a soft hint and enforced as a hard post-filter.
 * @returns Extracted phrases sorted by learning value, with known phrases removed
 */
export async function extractPhrasesFromTranscript(
  transcript: string,
  videoLanguage: string,
  userLevel: string,
  targetPhrases: number,
  generateObjectFn: GenerateObjectFn,
  modelId: string,
  nativeLanguage: string,
  knownPhrases: string[] = [],
): Promise<ExtractedPhrase[]> {
  const prompt = buildExtractionPrompt(
    transcript,
    videoLanguage,
    userLevel,
    targetPhrases,
    nativeLanguage,
    knownPhrases,
  );
  const maxTokens = Math.max(MIN_OUTPUT_TOKENS, targetPhrases * TOKENS_PER_PHRASE);
  const result = await generateObjectFn<ExtractionResult>(prompt, extractionResultSchema, modelId, { maxTokens });

  // Hard guarantee: drop anything the learner already knows even if the model ignored the hint.
  const known = new Set(knownPhrases.map(normalizePhrase));
  const fresh = known.size === 0 ? result.phrases : result.phrases.filter((p) => !known.has(normalizePhrase(p.phrase)));
  return fresh.slice(0, targetPhrases);
}
