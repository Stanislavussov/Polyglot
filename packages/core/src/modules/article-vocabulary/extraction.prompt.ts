import { buildKnownPhrasesSection } from "../video-vocabulary/extraction.prompt.js";

export interface ArticlePromptInput {
  title: string;
  text: string;
  /** Human-readable name of the language the page declares; the model confirms or corrects it. */
  declaredLanguage: string;
  userLevel: string;
  nativeLanguage: string;
  targetPhrases: number;
  knownPhrases: string[];
}

// Kept short on purpose: the article body is already the bulk of the input, and
// every instruction line is paid for on every run.
export function buildArticleExtractionPrompt(input: ArticlePromptInput): string {
  const { targetPhrases: n, userLevel: level } = input;
  return `You are a language teacher. From the article below (declared language: ${input.declaredLanguage}), pick ${n} items worth learning for a ${level} learner whose native language is ${input.nativeLanguage}.

- Mix idioms, phrasal verbs, collocations and single words that are new or nuanced at ${level}; prefer items at or slightly above ${level}, skip trivial and ultra-rare ones.
- Take them from the whole article, not just the opening. No proper nouns, brand names, numbers or duplicates.
- phrase: dictionary form. nativeTranslation: short, in ${input.nativeLanguage}. context: the sentence it appears in, copied verbatim (trim to ~25 words if longer).
- language: the ISO 639-1 code of the language the article is actually written in.
- Return fewer than ${n} only if the text is too short to yield them. Most useful first.
${buildKnownPhrasesSection(input.knownPhrases, "previously processed articles")}
## ${input.title}

${input.text}`;
}
