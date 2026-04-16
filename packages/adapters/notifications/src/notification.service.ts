/**
 * Notification Service — word suggestion and payload building.
 *
 * Rules:
 * 1. Does not import the bot — receives deps via injection
 * 2. On error — log and continue, never stop the scheduler
 * 3. Respect user timezone and language preferences
 * 4. Uses partial regeneration when a topic word is missing a language
 * 5. Uses core's getLogger() — injected at composition root
 */
import { getLogger } from "@polyglot/core";
import type { NotificationServiceDeps, SuggestedWord } from "./types.js";

/**
 * Create a notification service with injected dependencies.
 *
 * @param deps — topic service, user settings, vocabulary, review counts
 * @returns Object with pickSuggestedWord and pickDictionaryWord
 */
export function createNotificationService(deps: NotificationServiceDeps) {
  const logger = getLogger();
  /**
   * Pick a suggested word for a user's notification (AI topic-based).
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
  async function pickSuggestedWord(userId: number): Promise<SuggestedWord | null> {
    // Step 1: Fetch user settings
    const user = await deps.getUserSettings(userId);
    if (!user || user.learningLangs.length === 0) {
      logger.warn({ userId }, "Cannot pick word: user not found or no learning langs");
      return null;
    }

    // Step 2: Pick a random built-in topic
    const topics = deps.getBuiltinTopics();
    if (topics.length === 0) {
      logger.warn({}, "No built-in topics available");
      return null;
    }

    const topic = topics[Math.floor(Math.random() * topics.length)]!;

    // Step 3: Get topic words (cache-first)
    let words: Awaited<ReturnType<typeof deps.getTopicWords>> | undefined;
    try {
      words = await deps.getTopicWords(topic.id, user.nativeLang, user.learningLangs);
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
        const regenerated = await deps.regenerateTopicWord(topic.id, word.original, user.nativeLang, lang);
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
      logger.warn({ original: word.original, userId }, "No translations available for any learning lang");
      return null;
    }

    // Step 7: Return SuggestedWord
    // Dictionary context enrichment is now handled by the context-enrichment
    // layer at the translation level — no longer done here.
    return {
      original: word.original,
      emoji: topic.emoji,
      translations,
      source: "suggested" as const,
    };
  }

  /**
   * Pick a word from the user's dictionary that needs review.
   *
   * Strategy: least reviewed (tie-break: oldest createdAt).
   * Falls back to null if user has no saved vocabulary.
   *
   * @param userId — internal user ID
   * @returns SuggestedWord or null if dictionary is empty
   */
  async function pickDictionaryWord(userId: number): Promise<SuggestedWord | null> {
    if (!deps.getUserVocabulary || !deps.getReviewCounts || !deps.getLangCode) {
      logger.warn({ userId }, "pickDictionaryWord: missing deps (getUserVocabulary/getReviewCounts/getLangCode)");
      return null;
    }

    // Step 1: Get user's vocabulary entries
    let entries: Awaited<ReturnType<NonNullable<typeof deps.getUserVocabulary>>>;
    try {
      entries = await deps.getUserVocabulary(userId);
    } catch (err) {
      logger.error({ err, userId }, "pickDictionaryWord: failed to get user vocabulary");
      return null;
    }

    if (entries.length === 0) {
      logger.info({ userId }, "pickDictionaryWord: user has no vocabulary entries");
      return null;
    }

    // Step 2: Get review counts
    let reviewCounts: Map<number, number>;
    try {
      reviewCounts = await deps.getReviewCounts(userId);
    } catch (err) {
      logger.error({ err, userId }, "pickDictionaryWord: failed to get review counts");
      return null;
    }

    // Step 3: Sort by fewest reviews (tie-break: oldest createdAt)
    const sorted = [...entries].sort((a, b) => {
      const aCount = reviewCounts.get(a.id) ?? 0;
      const bCount = reviewCounts.get(b.id) ?? 0;
      if (aCount !== bCount) return aCount - bCount;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    const entry = sorted[0]!;

    // Step 4: Build translations map (langId → langCode → text)
    const translations: Record<string, string> = {};
    for (const t of entry.translations) {
      const code = deps.getLangCode(t.targetLangId);
      if (code) {
        translations[code] = t.text;
      }
    }

    if (Object.keys(translations).length === 0) {
      logger.warn({ userId, entryId: entry.id }, "pickDictionaryWord: entry has no resolvable translations");
      return null;
    }

    return {
      original: entry.original,
      emoji: entry.emoji ?? "📖",
      translations,
      source: "srs" as const,
    };
  }

  return { pickSuggestedWord, pickDictionaryWord };
}
