import { getLogger } from "@polyglot/core";
import { z } from "zod";
import type { NotificationServiceDeps, SuggestedWord } from "./types.js";

const contextualSentenceSchema = z.object({
  sentence: z.string().describe("A natural sentence in the target language"),
  translations: z
    .record(z.string(), z.string())
    .describe("Translations of the sentence into other languages, keyed by language code"),
});

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

    let entryTranslations = entry.translations;

    // JIT translation for entries with no translations (e.g. video vocabulary lazy saves)
    if (entryTranslations.length === 0 && deps.translateEntry) {
      logger.info(
        { userId, entryId: entry.id },
        "pickDictionaryWord: entry has no translations — attempting JIT translation",
      );
      try {
        const jitTranslations = await deps.translateEntry(userId, entry.id);
        if (jitTranslations && jitTranslations.length > 0) {
          entryTranslations = jitTranslations;
        }
      } catch (err) {
        logger.warn({ err, userId, entryId: entry.id }, "pickDictionaryWord: JIT translation failed");
      }
    }

    const translations: Record<string, string> = {};
    const translationDetails: Record<string, { synonyms: string[] }> = {};
    for (const t of entryTranslations) {
      const code = deps.getLangCode(t.targetLangId);
      if (code) {
        translations[code] = t.text;
        if (t.synonyms && t.synonyms.length > 0) {
          translationDetails[code] = { synonyms: t.synonyms };
        }
      }
    }

    if (Object.keys(translations).length === 0) {
      logger.warn({ userId, entryId: entry.id }, "pickDictionaryWord: entry has no resolvable translations");
      return null;
    }

    return {
      original: entry.original,
      emoji: entry.emoji ?? "📖",
      nativeMeaning: entry.nativeMeaning ?? undefined,
      translations,
      ...(Object.keys(translationDetails).length > 0 ? { translationDetails } : {}),
      source: "srs" as const,
      entryId: entry.id,
    };
  }

  async function pickContextualWord(
    userId: number,
    context: string,
    langs: { nativeLang: string; learningLangs: string[] },
    _recentWords: string[] = [],
  ): Promise<SuggestedWord | null> {
    if (!deps.generateObject) {
      logger.warn({ userId }, "pickContextualWord: missing generateObject dep");
      return null;
    }

    const allLangs = [langs.nativeLang, ...langs.learningLangs].filter(Boolean);
    if (allLangs.length === 0) {
      logger.warn({ userId }, "pickContextualWord: no languages configured");
      return null;
    }

    const langList = allLangs.join(", ");
    const primaryLang = allLangs[0]!;

    const prompt = `You are a language learning assistant. Generate a useful, natural sentence relevant to this context: "${context}"

Requirements:
- The sentence should be 8-15 words
- It should be practical and useful for everyday communication
- Write the sentence in ${primaryLang}
- Then translate it into these languages: ${langList}

Return ONLY valid JSON with this structure:
{
  "sentence": "the sentence in ${primaryLang}",
  "translations": {
    "${primaryLang}": "the sentence in ${primaryLang}",
    "lang_code": "translation"
  }
}

Do NOT include any text outside the JSON.`;

    try {
      const model = deps.contextualModel;
      if (!model) {
        logger.warn({ userId }, "pickContextualWord: no contextualModel configured");
        return null;
      }
      const result = await deps.generateObject<z.infer<typeof contextualSentenceSchema>>(
        prompt,
        contextualSentenceSchema,
        model,
        { userId },
      );

      const translations = result.translations;
      const sentence = result.sentence;

      if (Object.keys(translations).length === 0) {
        logger.warn({ userId }, "pickContextualWord: no translations returned");
        return null;
      }

      return {
        original: sentence,
        emoji: "🎯",
        translations,
        source: "contextual" as const,
      };
    } catch (err) {
      logger.error({ err, userId }, "pickContextualWord: AI generation failed");
      return null;
    }
  }

  return { pickDictionaryWord, pickContextualWord };
}
