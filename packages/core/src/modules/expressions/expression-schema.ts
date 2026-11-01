import { z } from "zod";

export const EXPRESSION_SOURCE_KINDS = [
  "film",
  "series",
  "book",
  "person",
  "song",
  "folk",
  "history",
  "sport",
  "other",
] as const;

export type ExpressionSourceKind = (typeof EXPRESSION_SOURCE_KINDS)[number];

export const expressionSchema = z.object({
  expression: z.string().min(1).describe("The expression exactly as native speakers say it"),
  meaning: z.string().min(1).describe("Short explanation in the learner's native language"),
  translation: z.string().nullish().describe("Literal or close translation into the native language"),
  sourceKind: z.enum(EXPRESSION_SOURCE_KINDS),
  sourceTitle: z.string().nullish().describe("Real film, book, series, song or person it comes from"),
  example: z.string().min(1).describe("One everyday sentence using the expression"),
});

export type Expression = z.infer<typeof expressionSchema>;
