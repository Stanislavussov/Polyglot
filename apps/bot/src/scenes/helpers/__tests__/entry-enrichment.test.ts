/**
 * Background enrichment must ask for the same languages the translate card shows.
 *
 * The incident: a phrase saved from a video ("give pause", native ru, learning
 * cs+en) came back from enrichment carrying only Czech. `updateAllTranslations`
 * deletes rows for languages absent from the new set, so leaving the native
 * language out of the request destroyed the Russian translation the optimistic
 * save had just written — and the card, with no answer block left, fell back to
 * showing the stored description under 💡.
 *
 * These assert the persisted outcome (which languages survive the enrichment),
 * not the shape of the request: the request is the mechanism, the surviving
 * native row is the behavior.
 */
import type { EnrichedTranslateInput, ServiceContainer } from "@polyglot/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const translateWithContext = vi.fn();

vi.mock("@polyglot/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@polyglot/core")>()),
  translateWithContext: (...args: unknown[]) => translateWithContext(...args),
}));

import { createServicesStub } from "../../../test-helpers/services-stub.js";
import type { BotContext } from "../../../types.js";
import { enrichEntryInBackground } from "../entry-enrichment.helper.js";

/** Stable ids so a persisted `targetLangId` maps back to a readable code. */
const LANG_IDS: Record<string, number> = { ru: 1, cs: 2, en: 3, es: 4, de: 5 };
const codeOf = (id: number): string => Object.keys(LANG_IDS).find((code) => LANG_IDS[code] === id) ?? String(id);

const updateAllTranslations = vi.fn();

function createCtx(settings: { nativeLang: string; learningLangs: string[] }): BotContext {
  return {
    user: { id: 1, subscriptionPlan: "free" },
    services: createServicesStub({
      userRepository: {
        getSettings: vi.fn().mockResolvedValue({ ...settings, interfaceLang: "ru" }),
      } as unknown as ServiceContainer["userRepository"],
      translationTemplateRepository: {
        getByUserId: vi.fn().mockResolvedValue(null),
      } as unknown as ServiceContainer["translationTemplateRepository"],
      languageCache: {
        getLang: (code: string) => (LANG_IDS[code] ? { id: LANG_IDS[code], code } : null),
      } as unknown as ServiceContainer["languageCache"],
      vocabularyRepository: {
        updateEntry: vi.fn().mockResolvedValue(undefined),
        updateAllTranslations,
      } as unknown as ServiceContainer["vocabularyRepository"],
    }),
  } as unknown as BotContext;
}

/** The AI boundary as it really behaves: one translation block per requested language. */
function answerEveryRequestedLanguage(): void {
  translateWithContext.mockImplementation(async (request: EnrichedTranslateInput) => ({
    status: "accepted",
    output: {
      original: request.word,
      sourceLang: request.sourceLang,
      emoji: "🤔",
      nativeMeaning: "a description of the phrase",
      nativeSynonyms: [],
      translations: Object.fromEntries(
        request.targetLangs.map((code: string) => [
          code,
          { text: `${request.word} in ${code}`, synonyms: [], examples: [] },
        ]),
      ),
    },
  }));
}

/** Language codes the enrichment actually persisted on the entry. */
function persistedLangs(): string[] {
  const written = updateAllTranslations.mock.calls[0]?.[1] as Array<{ targetLangId: number }> | undefined;
  return (written ?? []).map((row) => codeOf(row.targetLangId));
}

async function enrich(ctx: BotContext, sourceLangCode: string): Promise<void> {
  await enrichEntryInBackground(ctx, {
    entryId: 763,
    word: "give pause",
    inputType: "phrase",
    sourceLangCode,
    userId: 1,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  answerEveryRequestedLanguage();
});

describe("enrichEntryInBackground — which languages survive", () => {
  it("keeps the native translation when the word is in a learning language", async () => {
    // The reported incident, exactly: ru native, learning cs+en, phrase saved from
    // an English video. Czech alone is what the card was left with.
    const ctx = createCtx({ nativeLang: "ru", learningLangs: ["cs", "en"] });

    await enrich(ctx, "en");

    expect(persistedLangs()).toContain("ru");
    expect(persistedLangs()).toEqual(expect.arrayContaining(["ru", "cs"]));
  });

  it("leads with the native language, then the learning languages", async () => {
    const ctx = createCtx({ nativeLang: "ru", learningLangs: ["cs", "en"] });

    await enrich(ctx, "en");

    expect(persistedLangs()).toEqual(["ru", "cs"]);
  });

  it("never asks for the source language itself", async () => {
    const ctx = createCtx({ nativeLang: "ru", learningLangs: ["cs", "en"] });

    await enrich(ctx, "cs");

    expect(persistedLangs()).not.toContain("cs");
    expect(persistedLangs()).toEqual(["ru", "en"]);
  });

  it("asks for a language once when the native language is also listed as a learning one", async () => {
    // Real production data: learning_langs carries the native language too.
    const ctx = createCtx({ nativeLang: "ru", learningLangs: ["ru", "cs", "es", "en"] });

    await enrich(ctx, "en");

    expect(persistedLangs()).toEqual(["ru", "cs", "es"]);
  });

  it("drops the native language when the word is already in it", async () => {
    const ctx = createCtx({ nativeLang: "en", learningLangs: ["cs", "de"] });

    await enrich(ctx, "en");

    expect(persistedLangs()).toEqual(["cs", "de"]);
  });

  it("leaves the entry alone rather than translating a word into its own language", async () => {
    const ctx = createCtx({ nativeLang: "en", learningLangs: [] });

    await enrich(ctx, "en");

    expect(translateWithContext).not.toHaveBeenCalled();
    expect(updateAllTranslations).not.toHaveBeenCalled();
  });
});
