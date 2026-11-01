import type { GenerateObjectFn } from "../../ports/ai.port.js";
import { pickExpressionAngle } from "./expression-angle.js";
import { buildExpressionPrompt } from "./expression-prompt.js";
import { type Expression, expressionSchema } from "./expression-schema.js";

/** High on purpose: the admin-wide default (0.3) keeps returning the same few classics. */
const EXPRESSION_TEMPERATURE = 0.9;

export interface ExpressionRequest {
  userId: number;
  nativeLang: string;
  learningLangs: readonly string[];
  seed: number;
  /** Recently shown expressions, newest first. */
  avoid: readonly string[];
}

export interface GenerateExpressionDeps {
  generateObjectFn: GenerateObjectFn;
  modelId: string;
}

/** An expression plus the ISO code of the language it is in. */
export type GeneratedExpression = Expression & { lang: string };

export async function generateExpression(
  request: ExpressionRequest,
  deps: GenerateExpressionDeps,
): Promise<GeneratedExpression> {
  const langs = [...new Set([request.nativeLang, ...request.learningLangs].filter(Boolean))];
  const angle = pickExpressionAngle(request.seed, langs);
  const prompt = buildExpressionPrompt({ angle, nativeLang: request.nativeLang, avoid: request.avoid });

  const result = await deps.generateObjectFn<Expression>(prompt, expressionSchema, deps.modelId, {
    userId: request.userId,
    temperature: EXPRESSION_TEMPERATURE,
  });

  const { translation, ...rest } = result;
  const keepTranslation = angle.lang !== request.nativeLang && translation?.trim();
  return { ...rest, ...(keepTranslation ? { translation } : {}), lang: angle.lang };
}
