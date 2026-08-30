import {
  buildContextSentencePrompt,
  type ContextualSentence,
  contextualSentenceSchema,
  getLogger,
} from "@polyglot/core";
import type {
  ContextualWordPickerDeps,
  DictionaryWordPickerDeps,
  NotificationServiceDeps,
  SuggestedWord,
  VocabEntry,
} from "./types.js";

/** How much more often a "hard"-rated word is picked than a normal/unrated one. */
const HARD_WEIGHT = 3;

/**
 * Weighted lottery over the candidate pool: "hard" entries carry {@link HARD_WEIGHT}
 * tickets, everything else one. Uniform when nothing is rated.
 */
function pickWeighted(pool: VocabEntry[]): VocabEntry {
  const weights = pool.map((e) => (e.difficulty === "hard" ? HARD_WEIGHT : 1));
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i]!;
    if (roll < 0) return pool[i]!;
  }
  return pool[pool.length - 1]!;
}

/**
 * Dictionary word picker — selects a word from the user's saved vocabulary.
 *
 * All required lookups are non-optional deps (Fable T29/A16), so a half-wired
 * service is a compile error rather than a silent no-op.
 */
export function createDictionaryWordPicker(deps: DictionaryWordPickerDeps) {
  const logger = getLogger();

  async function pickDictionaryWord(userId: number, recentWords: string[] = []): Promise<SuggestedWord | null> {
    let entries: Awaited<ReturnType<DictionaryWordPickerDeps["getUserVocabulary"]>>;
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

    // Task 70 — never suggest entries flagged unverified (translated as written
    // for an unrecognized word).
    const verified = entries.filter((e) => e.unverified !== true);
    if (verified.length === 0) {
      logger.info({ userId }, "pickDictionaryWord: all entries are unverified — nothing to suggest");
      return null;
    }

    const candidates = verified.filter((e) => !recentWords.includes(e.original));
    if (candidates.length === 0) {
      // Exhausted, not empty. Repeating a word the user just saw is what makes a
      // reminder feel like spam, so the dictionary declines and the caller falls
      // through to the curated preset layer instead.
      logger.info({ userId }, "pickDictionaryWord: every word was recently sent — deferring to the preset layer");
      return null;
    }

    // Words the user marked "easy" (I know it) stay out of rotation until every
    // hard/normal word is exhausted — then they return as a last resort before
    // the preset layer takes over.
    const inRotation = candidates.filter((e) => e.difficulty !== "easy");
    const entry = pickWeighted(inRotation.length > 0 ? inRotation : candidates);

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

    const sourceLang = entry.sourceLangId === undefined ? undefined : deps.getLangCode(entry.sourceLangId);

    return {
      original: entry.original,
      ...(entry.headword?.trim() ? { headword: entry.headword } : {}),
      emoji: entry.emoji ?? "📖",
      ...(sourceLang ? { sourceLang } : {}),
      nativeMeaning: entry.nativeMeaning ?? undefined,
      translations,
      ...(Object.keys(translationDetails).length > 0 ? { translationDetails } : {}),
      source: "srs" as const,
      entryId: entry.id,
    };
  }

  return { pickDictionaryWord };
}

/**
 * Contextual word picker — generates a natural sentence relevant to the user's
 * chosen context via AI. `generateObject` is a required dep (Fable T29/A16); the
 * prompt + schema are owned by core (Fable T29/A15).
 */
export function createContextualWordPicker(deps: ContextualWordPickerDeps) {
  const logger = getLogger();

  async function pickContextualWord(
    userId: number,
    context: string,
    langs: { nativeLang: string; learningLangs: string[] },
    _recentWords: string[] = [],
  ): Promise<SuggestedWord | null> {
    const allLangs = [langs.nativeLang, ...langs.learningLangs].filter(Boolean);
    if (allLangs.length === 0) {
      logger.warn({ userId }, "pickContextualWord: no languages configured");
      return null;
    }

    const model = deps.contextualModel;
    if (!model) {
      logger.warn({ userId }, "pickContextualWord: no contextualModel configured");
      return null;
    }

    const prompt = buildContextSentencePrompt(context, allLangs);

    try {
      const result = await deps.generateObject<ContextualSentence>(prompt, contextualSentenceSchema, model, { userId });

      const translations = result.translations;
      const sentence = result.sentence;

      if (Object.keys(translations).length === 0) {
        logger.warn({ userId }, "pickContextualWord: no translations returned");
        return null;
      }

      return {
        original: sentence,
        emoji: "🎯",
        // `buildContextSentencePrompt` writes the sentence in the first language
        // it is given, so that is the language of `original`.
        ...(allLangs[0] ? { sourceLang: allLangs[0] } : {}),
        translations,
        source: "contextual" as const,
      };
    } catch (err) {
      logger.error({ err, userId }, "pickContextualWord: AI generation failed");
      return null;
    }
  }

  return { pickContextualWord };
}

/**
 * Composes the dictionary and contextual pickers into the full notification
 * service. Requires both dep sets, so the composition root cannot forget one.
 */
export function createNotificationService(deps: NotificationServiceDeps) {
  return {
    ...createDictionaryWordPicker(deps),
    ...createContextualWordPicker(deps),
  };
}
