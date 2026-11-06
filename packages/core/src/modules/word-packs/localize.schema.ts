import { z } from "zod";

// Arrays rather than records, and no optional fields: the failover provider
// accepts only strict schemas (Task 73).
export const packLocalizationSchema = z.object({
  words: z.array(
    z.object({
      index: z.number().int().describe("The number of the word in the list you were given"),
      level: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]).describe("CEFR level of the source word"),
      emoji: z.string().describe("A single emoji capturing the meaning"),
      equivalents: z
        .array(
          z.object({
            languageCode: z.string().describe("ISO 639-1 code of the target language"),
            headword: z
              .string()
              .describe("The natural equivalent in that language, or an empty string when none exists"),
          }),
        )
        .describe("One entry per target language"),
    }),
  ),
});
