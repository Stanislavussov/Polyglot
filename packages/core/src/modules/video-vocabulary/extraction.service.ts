/**
 * Video vocabulary extraction service.
 * Pure core logic — no adapter imports. AI function is injected.
 */

import type { ZodSchema } from "zod";
import type { GenerateOptions } from "../../ports/ai.port.js";
import { buildExtractionPrompt } from "./extraction.prompt.js";
import { extractionResultSchema } from "./extraction.schema.js";
import type { ExtractedPhrase, ExtractionResult } from "./types.js";

type GenerateObjectFn = <T>(
  prompt: string,
  schema: ZodSchema<T>,
  model: string,
  options?: GenerateOptions,
) => Promise<T>;

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
 * @returns Extracted phrases sorted by learning value
 */
export async function extractPhrasesFromTranscript(
  transcript: string,
  videoLanguage: string,
  userLevel: string,
  targetPhrases: number,
  generateObjectFn: GenerateObjectFn,
  modelId: string,
  nativeLanguage: string,
): Promise<ExtractedPhrase[]> {
  const prompt = buildExtractionPrompt(transcript, videoLanguage, userLevel, targetPhrases, nativeLanguage);
  const maxTokens = Math.max(MIN_OUTPUT_TOKENS, targetPhrases * TOKENS_PER_PHRASE);
  const result = await generateObjectFn<ExtractionResult>(prompt, extractionResultSchema, modelId, { maxTokens });
  return result.phrases.slice(0, targetPhrases);
}
