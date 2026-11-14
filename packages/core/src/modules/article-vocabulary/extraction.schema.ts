import { z } from "zod";

export const articlePhraseSchema = z.object({
  phrase: z.string().describe("The word, phrase, collocation or idiom, in its dictionary form"),
  nativeTranslation: z.string().describe("Translation of the phrase into the learner's native language"),
  emoji: z.string().describe("A single emoji for the meaning"),
  type: z.enum(["word", "phrase", "idiom", "collocation"]),
  level: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]).describe("CEFR level"),
  context: z.string().describe("The sentence from the article where it appears, copied verbatim"),
});

export const articleExtractionResultSchema = z.object({
  language: z.string().describe("ISO 639-1 code of the language the article is written in"),
  phrases: z.array(articlePhraseSchema).describe("Sorted by learning value, most useful first"),
});

export type ArticleExtractedPhrase = z.infer<typeof articlePhraseSchema>;
export type ArticleExtractionResult = z.infer<typeof articleExtractionResultSchema>;
