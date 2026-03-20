/**
 * Notification Service — word suggestion and payload building.
 *
 * Rules:
 * 1. Does not import the bot — receives deps via injection
 * 2. On error — log and continue, never stop the scheduler
 * 3. Respect user timezone and language preferences
 * 4. Uses partial regeneration when a topic word is missing a language
 */
import { logger } from "@polyglot/infra";
import type {
  NotificationServiceDeps,
  SuggestedWord,
  UserForNotification,
} from "./types.js";

/**
 * Create a notification service with injected dependencies.
 *
 * @param deps — topic service, user settings, optional regenerateTopicWord
 * @returns Object with pickSuggestedWord
 */
export function createNotificationService(deps: NotificationServiceDeps) {
  /**
   * Pick a suggested word for a user's notification.
   *
   * Flow:
   * 1. Fetch user settings (native lang, learning langs)
   * 2. Pick a random built-in topic
   * 3. Get topic words (cache-first via topic service)
   * 4. Pick a random word from the topic
   * 5. For each learning lang, check if translation exists
   * 6. If missing — use regenerateTopicWord (partial regen) to fill the gap
   * 7. Return SuggestedWord with translations for all user's learning langs
   *
   * @param userId — internal user ID
   * @returns SuggestedWord or null if no word could be picked
   */
  async function pickSuggestedWord(
    userId: number,
  ): Promise<SuggestedWord | null> {
    // Step 1: Fetch user settings
    const user = await deps.getUserSettings(userId);
    if (!user || user.learningLangs.length === 0) {
      logger.warn({ userId }, "Cannot pick word: user not found or no learning langs");
      return null;
    }

    // Step 2: Pick a random built-in topic
    const topics = deps.getBuiltinTopics();
    if (topics.length === 0) {
      logger.warn("No built-in topics available");
      return null;
    }

    const topic = topics[Math.floor(Math.random() * topics.length)]!;

    // Step 3: Get topic words (cache-first)
    let words;
    try {
      words = await deps.getTopicWords(
        topic.id,
        user.nativeLang,
        user.learningLangs,
      );
    } catch (err) {
      logger.error({ err, topicId: topic.id, userId }, "Failed to get topic words");
      return null;
    }

    if (words.length === 0) {
      logger.warn({ topicId: topic.id }, "Topic has no words");
      return null;
    }

    // Step 4: Pick a random word
    const word = words[Math.floor(Math.random() * words.length)]!;

    // Step 5–6: Check each learning lang and regenerate if missing
    const translations: Record<string, string> = {};

    for (const lang of user.learningLangs) {
      const existing = word.translations[lang];

      if (existing) {
        translations[lang] = existing.text;
        continue;
      }

      // Missing translation — attempt partial regeneration
      if (!deps.regenerateTopicWord) {
        logger.warn(
          { original: word.original, lang, topicId: topic.id },
          "Missing translation and regenerateTopicWord not available — skipping lang",
        );
        continue;
      }

      try {
        const regenerated = await deps.regenerateTopicWord(
          topic.id,
          word.original,
          user.nativeLang,
          lang,
        );
        translations[lang] = regenerated.text;
        logger.info(
          { original: word.original, lang, topicId: topic.id },
          "Partially regenerated missing translation for notification word",
        );
      } catch (err) {
        logger.error(
          { err, original: word.original, lang, topicId: topic.id },
          "Partial regeneration failed for notification word — skipping lang",
        );
        // On error — log and continue (rule: never stop the scheduler)
      }
    }

    // If no translations were resolved, return null
    if (Object.keys(translations).length === 0) {
      logger.warn(
        { original: word.original, userId },
        "No translations available for any learning lang",
      );
      return null;
    }

    // Step 7: Return SuggestedWord
    // Dictionary context enrichment is now handled by the context-enrichment
    // layer at the translation level — no longer done here.
    return {
      original: word.original,
      emoji: topic.emoji,
      translations,
    };
  }

  return { pickSuggestedWord };
}
