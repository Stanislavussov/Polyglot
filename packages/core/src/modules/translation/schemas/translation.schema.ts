import { z } from "zod";

/** Zod schema for validating a translation request */
export const translationRequestSchema = z.object({
  text: z.string().min(1, "Text is required"),
  sourceLang: z.string().min(2),
  targetLang: z.string().min(2),
  topic: z.string().optional(),
});

/** Zod schema for validating a translation result */
export const translationResultSchema = z.object({
  original: z.string(),
  translated: z.string(),
  sourceLang: z.string(),
  targetLang: z.string(),
  alternatives: z.array(z.string()).optional(),
});
