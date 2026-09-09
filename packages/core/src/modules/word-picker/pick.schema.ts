import { z } from "zod";

export const pickedItemSchema = z.object({
  word: z.string().describe("The word or phrase in the language being learned, in its dictionary form"),
  nativeTranslation: z.string().describe("Short translation into the learner's native language"),
  emoji: z.string().describe("A single emoji capturing the meaning"),
  type: z.enum(["word", "phrase", "idiom", "collocation"]).describe("Type of linguistic unit"),
  level: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]).describe("CEFR level of the item"),
  exampleTarget: z.string().describe("One natural sentence in the language being learned using the item"),
  exampleNative: z.string().describe("Translation of that sentence into the learner's native language"),
  note: z
    .string()
    .describe("One sentence in the learner's native language explaining what this angle reveals about the item"),
});

export const pickResultSchema = z.object({
  items: z.array(pickedItemSchema).describe("Picked items, most striking first"),
});
