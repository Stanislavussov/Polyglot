import type { ZodSchema } from 'zod';

/** Classification result for translation quality */
export type IdiomClassification =
  | 'CORRECT_IDIOMATIC_TRANSLATION' // Natural, commonly used expression
  | 'LITERAL_BUT_UNNATURAL' // Word-for-word, sounds artificial
  | 'INCORRECT_MEANING'; // Translation doesn't convey same meaning

/** Type of idiomatic expression */
export type SourceExpressionType =
  | 'idiom'
  | 'proverb'
  | 'slang'
  | 'figurative'
  | 'fixed_expression';

/** Input for idiom analysis */
export interface IdiomAnalysisInput {
  sourcePhrase: string;
  sourceLang: string;
  translatedPhrase: string;
  targetLang: string;
}

/** Full analysis result */
export interface IdiomAnalysisResult {
  /** Whether the source phrase is idiomatic */
  sourceIsIdiomatic: boolean;
  /** Type of expression if idiomatic */
  sourceExpressionType?: SourceExpressionType;
  /** Literal meaning of source (if idiomatic) */
  sourceLiteralMeaning?: string;
  /** Intended/figurative meaning of source */
  sourceIntendedMeaning: string;

  /** Classification of the translation */
  classification: IdiomClassification;
  /** Confidence score 0-1 */
  confidence: number;

  /** Whether both phrases convey same emotional tone */
  toneMatch: boolean;
  /** Whether intensity/emphasis is preserved */
  intensityMatch: boolean;

  /** Explanation of the classification decision */
  explanation: string;

  /** Suggested natural alternative (if classification !== CORRECT_IDIOMATIC_TRANSLATION) */
  suggestedAlternative?: string;
  /** Explanation for the suggested alternative */
  alternativeExplanation?: string;
}

/** Generate function signature (injected dependency) */
export type GenerateObjectFn = <T>(
  prompt: string,
  schema: ZodSchema<T>,
  model: string
) => Promise<T>;
