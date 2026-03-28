import { buildIdiomAnalysisPrompt } from "./prompt.builder.js";
import { idiomAnalysisResultSchema } from "./schemas/idiom-analysis.schema.js";
import type { GenerateObjectFn, IdiomAnalysisInput, IdiomAnalysisResult } from "./types.js";

export interface AnalyzeInput extends IdiomAnalysisInput {
  model: string;
}

/**
 * Analyze a translation for idiomatic correctness
 */
export async function analyzeIdiom(
  input: AnalyzeInput,
  generateObjectFn: GenerateObjectFn,
): Promise<IdiomAnalysisResult> {
  const prompt = buildIdiomAnalysisPrompt(input);
  const result = await generateObjectFn(prompt, idiomAnalysisResultSchema, input.model);
  return result;
}

/**
 * Batch analyze multiple translations
 */
export async function analyzeIdiomBatch(
  inputs: AnalyzeInput[],
  generateObjectFn: GenerateObjectFn,
): Promise<IdiomAnalysisResult[]> {
  const results: IdiomAnalysisResult[] = [];
  for (const input of inputs) {
    const result = await analyzeIdiom(input, generateObjectFn);
    results.push(result);
  }
  return results;
}

/**
 * Quick check if a translation needs review (returns true if not CORRECT)
 */
export async function needsIdiomReview(input: AnalyzeInput, generateObjectFn: GenerateObjectFn): Promise<boolean> {
  const result = await analyzeIdiom(input, generateObjectFn);
  return result.classification !== "CORRECT_IDIOMATIC_TRANSLATION";
}
