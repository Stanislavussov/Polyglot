import { getLogger } from "@polyglot/core";
import type { NotificationServiceDeps, SuggestedWord } from "./types.js";

export function createNotificationService(deps: NotificationServiceDeps) {
  const logger = getLogger();

  async function pickDictionaryWord(userId: number, recentWords: string[] = []): Promise<SuggestedWord | null> {
    if (!deps.getUserVocabulary || !deps.getLangCode) {
      logger.warn({ userId }, "pickDictionaryWord: missing deps (getUserVocabulary/getLangCode)");
      return null;
    }

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

    const filtered = entries.filter((e) => !recentWords.includes(e.original));
    if (filtered.length === 0) {
      logger.info({ userId }, "pickDictionaryWord: all words recently sent — picking from full set");
    }

    const candidates = filtered.length > 0 ? filtered : entries;
    const entry = candidates[Math.floor(Math.random() * candidates.length)]!;

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

  return { pickDictionaryWord };
}
