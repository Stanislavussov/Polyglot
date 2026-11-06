import { expressionSeed, generateExpression, getLogger } from "@polyglot/core";
import type { ExpressionPickerDeps, SuggestedWord } from "./types.js";

/**
 * Expressions notification picker. One AI call per send and no database read of
 * its own: variety comes from the seeded angle, and `recentWords` — already read
 * by the scheduler on every tick — is the only "do not repeat" memory.
 */
export function createExpressionPicker(deps: ExpressionPickerDeps) {
  const logger = getLogger();
  const now = deps.now ?? (() => new Date());

  async function pickExpression(
    user: { userId: number; nativeLang: string; learningLangs: string[] },
    recentWords: string[] = [],
  ): Promise<SuggestedWord | null> {
    if (!deps.model) {
      logger.warn({ userId: user.userId }, "pickExpression: no model configured");
      return null;
    }

    const at = now();
    try {
      const expression = await generateExpression(
        {
          userId: user.userId,
          nativeLang: user.nativeLang,
          learningLangs: user.learningLangs,
          seed: expressionSeed(user.userId, at, at.getUTCHours()),
          avoid: recentWords,
        },
        { generateObjectFn: deps.generateObject, modelId: deps.model },
      );
      return {
        original: expression.expression,
        emoji: "🎭",
        sourceLang: expression.lang,
        translations: {},
        source: "expressions",
        expression,
      };
    } catch (err) {
      logger.error({ err, userId: user.userId }, "pickExpression: AI generation failed");
      return null;
    }
  }

  return { pickExpression };
}
