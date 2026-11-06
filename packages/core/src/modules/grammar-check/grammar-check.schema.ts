import { z } from "zod";

/** What kind of mistake an issue is. The bot renders each as a localized label. */
export const GRAMMAR_ISSUE_CATEGORIES = [
  "grammar",
  "vocabulary",
  "preposition",
  "article",
  "word_order",
  "agreement",
  "tense",
  "spelling",
  "punctuation",
  "other",
] as const;

export type GrammarIssueCategory = (typeof GRAMMAR_ISSUE_CATEGORIES)[number];

// Every field is required (nullable where it can be empty): structured-output
// providers reject optional properties, and an absent field would only reach the
// renderer as `undefined`.
export const grammarIssueSchema = z.object({
  fragment: z.string().describe("The wrong part, copied exactly from the text"),
  correction: z.string().describe("The correct form of that part"),
  category: z.enum(GRAMMAR_ISSUE_CATEGORIES).describe("What kind of mistake it is"),
  explanation: z.string().describe("Why it is wrong: the rule, in the explanation language"),
  example: z.string().describe("One new sentence in the text's language that applies the rule correctly"),
});

export const grammarCheckResultSchema = z.object({
  detectedLanguage: z.string().describe("ISO 639-1 code of the language the text is written in"),
  errors: z
    .array(grammarIssueSchema)
    .describe("Every mistake, in the order it appears; empty when the text is correct"),
  correctedText: z.string().describe("The whole text with every correction applied"),
  naturalAlternative: z
    .string()
    .nullable()
    .describe("Only for a correct text: a more natural way a native speaker would say it, or null"),
});

export type GrammarIssue = z.infer<typeof grammarIssueSchema>;
export type GrammarCheckAiResult = z.infer<typeof grammarCheckResultSchema>;
