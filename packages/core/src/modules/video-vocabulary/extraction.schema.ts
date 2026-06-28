import { z } from "zod";

export const extractedPhraseSchema = z.object({
  phrase: z.string().describe("The phrase, collocation, idiom, or word extracted from the transcript"),
  nativeTranslation: z.string().describe("Translation of the phrase into the user's native language"),
  emoji: z.string().describe("A single emoji that represents the meaning of this phrase"),
  type: z.enum(["word", "phrase", "idiom", "collocation"]).describe("Type of linguistic unit"),
  level: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]).describe("CEFR proficiency level"),
  context: z.string().describe("The original sentence from the transcript where this phrase appears"),
  timestampSeconds: z.number().describe("Approximate timestamp in seconds where this phrase appears in the video"),
});

export const extractionResultSchema = z.object({
  phrases: z.array(extractedPhraseSchema).describe("Extracted phrases sorted by learning value (most useful first)"),
});
