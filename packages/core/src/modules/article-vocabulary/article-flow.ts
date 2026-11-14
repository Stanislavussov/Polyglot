/**
 * The article-vocabulary flow: a cleaned article body → phrases worth learning →
 * the dictionary. The page itself is fetched and cleaned by the channel (through
 * the article adapter) before a run exists; core only reads the stored body.
 */
import { logger } from "../../logger.js";
import type {
  ArticlePhrase,
  ArticleProcess,
  ArticleVocabularyRepository,
} from "../../ports/article-vocabulary.repository.js";
import type { ServiceContainer } from "../../ports/container.js";
import { normalizePhrase } from "../video-vocabulary/normalize.js";
import { enrichSavedEntry } from "../vocabulary/enrich-saved-entry.js";
import { buildArticleExtractionPrompt } from "./extraction.prompt.js";
import { type ArticleExtractionResult, articleExtractionResultSchema } from "./extraction.schema.js";
import { computeArticlePhraseTarget } from "./target.js";

export type ArticleFlowDeps = Pick<
  ServiceContainer,
  | "userRepository"
  | "settings"
  | "ai"
  | "languageCache"
  | "vocabularyRepository"
  | "vocabularyDictionaryRepository"
  | "translationTemplateRepository"
> & { articleVocabularyRepository: ArticleVocabularyRepository };

const TOKENS_PER_PHRASE = 120;
const MIN_OUTPUT_TOKENS = 2048;

export type ArticleProcessOutcome = { status: "completed"; phraseCount: number } | { status: "failed"; error: string };

/** Same exclusion as videos: saved originals in that language plus earlier articles' phrases. */
async function collectKnownPhrases(deps: ArticleFlowDeps, process: ArticleProcess): Promise<string[]> {
  const sourceLang = deps.languageCache.getLang(process.language);
  const [saved, prior] = await Promise.all([
    sourceLang ? deps.vocabularyRepository.findOriginalsByUserAndSource(process.userId, sourceLang.id) : [],
    deps.articleVocabularyRepository.findKnownPhrasesByUser(process.userId, process.language, process.id),
  ]);
  return [...saved, ...prior];
}

/** Article body → phrases → stored. One AI call, no retries: a failed run is marked failed. Never throws. */
export async function processArticle(deps: ArticleFlowDeps, processId: number): Promise<ArticleProcessOutcome> {
  const repo = deps.articleVocabularyRepository;
  const process = await repo.findProcessById(processId);
  if (!process) return { status: "failed", error: "Process not found" };
  try {
    await repo.updateProcessStatus(processId, "processing");
    const [levels, settings, config, known] = await Promise.all([
      deps.userRepository.getLanguageLevels(process.userId),
      deps.userRepository.getSettings(process.userId),
      deps.settings.getVideoVocabularyConfig(),
      collectKnownPhrases(deps, process),
    ]);
    const userLevel = levels.find((l) => l.languageCode === process.language)?.proficiencyLevel ?? "B1";
    const nativeCode = settings?.nativeLang ?? "en";
    const target = computeArticlePhraseTarget(process.wordCount, config.minPhrases, config.maxPhrases);

    const prompt = buildArticleExtractionPrompt({
      title: process.title,
      text: process.content,
      declaredLanguage: deps.languageCache.getLangName(process.language, "en"),
      userLevel,
      nativeLanguage: deps.languageCache.getLangName(nativeCode, "en"),
      targetPhrases: target,
      knownPhrases: known,
    });
    const result = await deps.ai.generateObject<ArticleExtractionResult>(
      prompt,
      articleExtractionResultSchema,
      config.extractionModelId,
      { maxTokens: Math.max(MIN_OUTPUT_TOKENS, target * TOKENS_PER_PHRASE) },
    );

    // Pages often declare a site-wide lang="en"; the text itself decides what the phrases are saved as.
    const reported = deps.languageCache.normalizeToIso1(result.language.trim().toLowerCase());
    if (reported && reported !== process.language && deps.languageCache.isKnownLang(reported)) {
      await repo.updateProcessLanguage(processId, reported);
    }

    const knownSet = new Set(known.map(normalizePhrase));
    const seen = new Set<string>();
    const fresh = result.phrases.filter((p) => {
      const key = normalizePhrase(p.phrase);
      if (key.length === 0 || knownSet.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    await repo.savePhrases(
      processId,
      fresh.slice(0, target).map((p, i) => ({
        phrase: p.phrase.trim(),
        nativeTranslation: p.nativeTranslation,
        emoji: p.emoji,
        phraseType: p.type,
        level: p.level,
        context: p.context,
        sortOrder: i + 1,
      })),
    );
    await repo.updateProcessStatus(processId, "completed");
    const phraseCount = Math.min(fresh.length, target);
    logger.info(
      { processId, userId: process.userId, phraseCount, words: process.wordCount },
      "Article processing completed",
    );
    return { status: "completed", phraseCount };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await repo.updateProcessStatus(processId, "failed", message);
    logger.error({ processId, userId: process.userId, error: message }, "Article processing failed");
    return { status: "failed", error: message };
  }
}

type SavedPhrase = { phrase: ArticlePhrase; entryId: number; created: boolean };

async function savePhraseEntry(
  deps: ArticleFlowDeps,
  userId: number,
  process: ArticleProcess,
  phrase: ArticlePhrase,
  sourceLangId: number,
  nativeLangCode: string | null | undefined,
): Promise<SavedPhrase> {
  const existing = await deps.vocabularyRepository.findByOriginalAndSource(userId, phrase.phrase, sourceLangId);
  if (existing) {
    await deps.articleVocabularyRepository.markPhraseSaved(phrase.id, existing.id);
    return { phrase, entryId: existing.id, created: false };
  }
  const nativeLang = nativeLangCode ? deps.languageCache.getLang(nativeLangCode) : null;
  const example = phrase.context ? [{ context: phrase.context, target: phrase.nativeTranslation ?? "" }] : [];
  const entry = await deps.vocabularyRepository.create(userId, {
    original: phrase.phrase,
    sourceLangId,
    inputType: phrase.phraseType === "word" ? "word" : "phrase",
    emoji: phrase.emoji ?? "",
    nativeMeaning: phrase.nativeTranslation ?? undefined,
    sourceUsage: phrase.context
      ? { explanation: phrase.nativeTranslation ?? "", synonyms: [], examples: example }
      : undefined,
    source: { type: "article", articleUrl: process.url, articleTitle: process.title },
    translations:
      phrase.nativeTranslation && nativeLang
        ? [
            {
              targetLangId: nativeLang.id,
              text: phrase.nativeTranslation,
              details: { synonyms: [], examples: example },
            },
          ]
        : [],
  });
  await deps.vocabularyDictionaryRepository.addEntryToDefault(userId, entry.id);
  await deps.articleVocabularyRepository.markPhraseSaved(phrase.id, entry.id);
  return { phrase, entryId: entry.id, created: true };
}

function enrich(deps: ArticleFlowDeps, saved: SavedPhrase, process: ArticleProcess, userId: number, plan?: string) {
  return enrichSavedEntry(deps, {
    entryId: saved.entryId,
    word: saved.phrase.phrase,
    inputType: saved.phrase.phraseType === "word" ? "word" : "phrase",
    sourceLangCode: process.language,
    userId,
    ...(plan ? { plan } : {}),
  });
}

/** Saves one phrase (or links the entry the user already has); a new entry is enriched in the background. */
export async function saveArticlePhrase(
  deps: ArticleFlowDeps,
  userId: number,
  process: ArticleProcess,
  phrase: ArticlePhrase,
  sourceLangId: number,
  plan?: string,
): Promise<void> {
  const settings = await deps.userRepository.getSettings(userId);
  const saved = await savePhraseEntry(deps, userId, process, phrase, sourceLangId, settings?.nativeLang);
  if (saved.created) void enrich(deps, saved, process, userId, plan);
}

/** Saves every unsaved phrase of an article; returns how many. New entries enrich one after another. */
export async function saveAllArticlePhrases(
  deps: ArticleFlowDeps,
  userId: number,
  process: ArticleProcess,
  sourceLangId: number,
  plan?: string,
): Promise<number> {
  const all = await deps.articleVocabularyRepository.findPhrasesByProcess(process.id, 0, 100);
  const settings = await deps.userRepository.getSettings(userId);
  const created: SavedPhrase[] = [];
  let count = 0;
  for (const phrase of all.filter((p) => !p.savedEntryId)) {
    const saved = await savePhraseEntry(deps, userId, process, phrase, sourceLangId, settings?.nativeLang);
    if (saved.created) created.push(saved);
    count++;
  }
  if (created.length > 0) {
    void (async () => {
      for (const saved of created) await enrich(deps, saved, process, userId, plan);
    })();
  }
  return count;
}
