/**
 * Localizes an author's words into a pack: one AI call per batch, then the
 * guarantees the model cannot be trusted with are enforced here.
 */
import type { GenerateObjectFn } from "../../ports/ai.port.js";
import { normalizeWord } from "../word-picker/normalize.js";
import type { CefrLevel } from "../word-picker/types.js";
import { buildPackLocalizationPrompt } from "./localize.prompt.js";
import { packLocalizationSchema } from "./localize.schema.js";
import type {
  LocalizedPackWord,
  PackLocalizationOutcome,
  PackLocalizationRequest,
  PackLocalizationResult,
  PackSourceWord,
} from "./types.js";

/** Words below this level stay out of a pack: a lapsed learner is won back by surprise, not by "cat". */
export const WORD_PACK_MIN_LEVEL: CefrLevel = "B2";

const BATCH_SIZE = 10;
const MAX_OUTPUT_TOKENS = 4096;
const CEFR_ORDER: readonly CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

export interface LocalizePackWordsDeps {
  generateObjectFn: GenerateObjectFn;
  modelId: string;
}

export function meetsLevel(level: CefrLevel, minLevel: CefrLevel): boolean {
  return CEFR_ORDER.indexOf(level) >= CEFR_ORDER.indexOf(minLevel);
}

function uniqueWords(words: readonly PackSourceWord[]): PackSourceWord[] {
  const seen = new Set<string>();
  const unique: PackSourceWord[] = [];
  for (const word of words) {
    const headword = word.headword.trim();
    const key = `${word.lang}:${normalizeWord(headword)}`;
    if (headword.length === 0 || seen.has(key)) continue;
    seen.add(key);
    unique.push({ headword, lang: word.lang });
  }
  return unique;
}

function toPackWord(
  source: PackSourceWord,
  answer: PackLocalizationResult["words"][number],
  wanted: ReadonlySet<string>,
): LocalizedPackWord {
  const headwords: Record<string, string> = {};
  for (const { languageCode, headword } of answer.equivalents) {
    const text = headword.trim();
    if (text.length > 0 && wanted.has(languageCode)) headwords[languageCode] = text;
  }
  // The author's word is the reason the pack exists; the model only fills the others.
  headwords[source.lang] = source.headword;
  return {
    sourceLang: source.lang,
    sourceHeadword: source.headword,
    level: answer.level,
    emoji: answer.emoji,
    headwords,
  };
}

export async function localizePackWords(
  request: PackLocalizationRequest,
  deps: LocalizePackWordsDeps,
): Promise<PackLocalizationOutcome> {
  const words = uniqueWords(request.words);
  const wanted = new Set(request.languages.map((language) => language.code));
  const langName = (code: string): string => request.languages.find((l) => l.code === code)?.name ?? code;
  const outcome: PackLocalizationOutcome = { items: [], tooEasy: [], unresolved: [] };

  for (let start = 0; start < words.length; start += BATCH_SIZE) {
    const batch = words.slice(start, start + BATCH_SIZE);
    const result = await deps.generateObjectFn<PackLocalizationResult>(
      buildPackLocalizationPrompt(batch, request.languages, langName),
      packLocalizationSchema,
      deps.modelId,
      { maxTokens: MAX_OUTPUT_TOKENS },
    );

    const answers = new Map(result.words.map((answer) => [answer.index, answer]));
    for (const [position, source] of batch.entries()) {
      const answer = answers.get(position + 1);
      if (!answer) outcome.unresolved.push(source.headword);
      else if (!meetsLevel(answer.level, request.minLevel)) outcome.tooEasy.push(source.headword);
      else outcome.items.push(toPackWord(source, answer, wanted));
    }
  }

  return outcome;
}
