/**
 * Video vocabulary extraction service.
 * Pure core logic — no adapter imports. AI function is injected.
 */

import type { ZodSchema } from "zod";
import { buildExtractionPrompt } from "./extraction.prompt.js";
import { extractionResultSchema } from "./extraction.schema.js";
import type { ExtractedPhrase, ExtractionResult } from "./types.js";

type GenerateObjectFn = <T>(prompt: string, schema: ZodSchema<T>, model: string) => Promise<T>;

/**
 * Extract phrases from a video transcript using AI.
 *
 * @param transcript - Full transcript text
 * @param videoLanguage - Language of the transcript (e.g. "English", "en")
 * @param userLevel - CEFR level of the user (e.g. "B2")
 * @param maxPhrases - Maximum number of phrases to extract
 * @param generateObjectFn - AI generation function (injected from adapter)
 * @param modelId - AI model ID to use
 * @returns Extracted phrases sorted by learning value
 */
export async function extractPhrasesFromTranscript(
  transcript: string,
  videoLanguage: string,
  userLevel: string,
  maxPhrases: number,
  generateObjectFn: GenerateObjectFn,
  modelId: string,
  nativeLanguage: string,
): Promise<ExtractedPhrase[]> {
  const prompt = buildExtractionPrompt(transcript, videoLanguage, userLevel, maxPhrases, nativeLanguage);
  const result = await generateObjectFn<ExtractionResult>(prompt, extractionResultSchema, modelId);
  return result.phrases.slice(0, maxPhrases);
}
