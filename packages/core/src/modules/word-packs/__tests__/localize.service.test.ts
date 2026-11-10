/**
 * Word-pack localization — turning an author's saved words into a pack every
 * learner can receive in the language they study.
 *
 * The guarantees the re-engagement card depends on: the author's own word is
 * never rewritten, a language with no real equivalent is left out rather than
 * filled with a literal translation, and words too easy to surprise anyone are
 * dropped before they reach a lapsed user.
 */
import { describe, expect, it, vi } from "vitest";
import type { GenerateObjectFn } from "../../../ports/ai.port.js";
import { localizePackWords } from "../localize.service.js";
import type { PackLocalizationResult } from "../types.js";

const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "de", name: "German" },
  { code: "es", name: "Spanish" },
];

type AiWord = PackLocalizationResult["words"][number];

/** An AI stub that answers each batch with whatever `answer` makes of its words. */
function aiAnswering(answer: (index: number, headword: string) => Omit<AiWord, "index"> | null) {
  return vi.fn(async (prompt: string) => {
    const words: AiWord[] = [];
    const wordList = prompt.split("## Target languages")[0] ?? "";
    for (const match of wordList.matchAll(/^(\d+)\. (.+?) \(/gm)) {
      const index = Number(match[1]);
      const result = answer(index, match[2]!);
      if (result) words.push({ index, ...result });
    }
    return { words };
  });
}

const deps = (ai: ReturnType<typeof aiAnswering>) => ({
  generateObjectFn: ai as unknown as GenerateObjectFn,
  modelId: "test-model",
});

describe("localizePackWords", () => {
  it("keeps the author's own word for its language and adds an equivalent for each other language", async () => {
    const ai = aiAnswering(() => ({
      level: "C1",
      emoji: "🧳",
      equivalents: [
        { languageCode: "de", headword: "Fernweh" },
        { languageCode: "es", headword: "ganas de viajar" },
        // The model must not be able to rewrite the author's word.
        { languageCode: "en", headword: "travel bug" },
      ],
    }));

    const result = await localizePackWords(
      { words: [{ headword: " wanderlust ", lang: "en" }], languages: LANGUAGES, minLevel: "B2" },
      deps(ai),
    );

    expect(result.items).toEqual([
      {
        sourceLang: "en",
        sourceHeadword: "wanderlust",
        level: "C1",
        emoji: "🧳",
        headwords: { en: "wanderlust", de: "Fernweh", es: "ganas de viajar" },
      },
    ]);
  });

  it("drops a word below the minimum level and names it, so the author knows why the pack is smaller", async () => {
    const ai = aiAnswering((_, headword) => ({
      level: headword === "cat" ? "A1" : "C2",
      emoji: "✨",
      equivalents: [{ languageCode: "de", headword: `${headword}-de` }],
    }));

    const result = await localizePackWords(
      {
        words: [
          { headword: "cat", lang: "en" },
          { headword: "petrichor", lang: "en" },
        ],
        languages: LANGUAGES,
        minLevel: "B2",
      },
      deps(ai),
    );

    expect(result.items.map((item) => item.sourceHeadword)).toEqual(["petrichor"]);
    expect(result.tooEasy).toEqual(["cat"]);
  });

  it("leaves a language out when the model has no real equivalent, instead of sending an empty word", async () => {
    const ai = aiAnswering(() => ({
      level: "C1",
      emoji: "🌧",
      equivalents: [
        { languageCode: "de", headword: "  " },
        { languageCode: "es", headword: "olor a lluvia" },
        // Not one of the requested languages.
        { languageCode: "xx", headword: "nonsense" },
      ],
    }));

    const [item] = (
      await localizePackWords(
        { words: [{ headword: "petrichor", lang: "en" }], languages: LANGUAGES, minLevel: "B2" },
        deps(ai),
      )
    ).items;

    expect(item?.headwords).toEqual({ en: "petrichor", es: "olor a lluvia" });
  });

  it("asks in batches and accounts for every word, reporting the ones the model skipped rather than inventing them", async () => {
    const words = Array.from({ length: 23 }, (_, index) => ({ headword: `word${index}`, lang: "en" }));
    const ai = aiAnswering((_, headword) =>
      headword === "word7" ? null : { level: "C1", emoji: "✨", equivalents: [] },
    );

    const result = await localizePackWords({ words, languages: LANGUAGES, minLevel: "B2" }, deps(ai));

    expect(ai).toHaveBeenCalledTimes(3);
    expect(result.items).toHaveLength(22);
    expect(result.unresolved).toEqual(["word7"]);
  });

  it("asks once for a word saved twice", async () => {
    const ai = aiAnswering(() => ({ level: "C1", emoji: "✨", equivalents: [] }));

    const result = await localizePackWords(
      {
        words: [
          { headword: "Saudade", lang: "pt" },
          { headword: "saudade", lang: "pt" },
        ],
        languages: LANGUAGES,
        minLevel: "B2",
      },
      deps(ai),
    );

    expect(result.items).toHaveLength(1);
  });
});
