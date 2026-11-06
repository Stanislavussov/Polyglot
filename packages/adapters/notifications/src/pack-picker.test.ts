/**
 * Pack picker (Task 87) — the word a lapsed learner is won back with.
 *
 * Guarantees: the word arrives in a language the learner studies, a word is
 * never sent twice, the pack hands over to the other layers once it has nothing
 * new rather than recycling, and two learners do not walk the same queue.
 */
import type { ActiveWordPackItem } from "@polyglot/core";
import { initLanguageRegistry } from "@polyglot/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPackWordPicker, type PackWordPickerDeps } from "./pack-picker.js";

const user = { userId: 1, nativeLang: "ru", learningLangs: ["de"] };

let nextItemId = 1;

function item(sourceHeadword: string, headwords: Record<string, string>): ActiveWordPackItem {
  return {
    itemId: nextItemId++,
    packId: 7,
    packEmoji: "📦",
    packTitle: "Standard 55",
    packTitleI18n: {},
    sourceLang: "en",
    sourceHeadword,
    level: "C1",
    emoji: "🧳",
    headwords,
  };
}

function buildDeps(items: ActiveWordPackItem[], overrides: Partial<PackWordPickerDeps> = {}): PackWordPickerDeps {
  return {
    findActivePackItems: vi.fn().mockResolvedValue(items),
    findDemoCard: vi.fn().mockResolvedValue(null),
    translateHeadword: vi.fn(async (headword: string) => ({ translations: { ru: `${headword}-ru` } })),
    ...overrides,
  };
}

beforeEach(() => {
  initLanguageRegistry([
    { code: "ru", name: "Russian", nativeName: "Русский", flag: "🇷🇺", isSupported: true },
    { code: "de", name: "German", nativeName: "Deutsch", flag: "🇩🇪", isSupported: true },
    { code: "en", name: "English", nativeName: "English", flag: "🇬🇧", isSupported: true },
  ]);
});

describe("createPackWordPicker", () => {
  it("sends the word in the language the learner studies, explained in their own", async () => {
    const pick = createPackWordPicker(buildDeps([item("wanderlust", { en: "wanderlust", de: "Fernweh" })]));

    const word = await pick(user, []);

    expect(word).toMatchObject({
      original: "Fernweh",
      sourceLang: "de",
      emoji: "🧳",
      translations: { ru: "Fernweh-ru" },
      source: "pack",
    });
  });

  it("skips a word that has no equivalent in any language the learner studies", async () => {
    const pick = createPackWordPicker(buildDeps([item("wanderlust", { en: "wanderlust", ru: "тяга к странствиям" })]));

    expect(await pick(user, [])).toBeNull();
  });

  it("never sends a word twice, and hands over to the other layers once every word was sent", async () => {
    const deps = buildDeps([
      item("wanderlust", { en: "wanderlust", de: "Fernweh" }),
      item("petrichor", { en: "petrichor", de: "Regengeruch" }),
    ]);
    const pick = createPackWordPicker(deps);

    const first = await pick(user, []);
    const second = await pick(user, [first!.original]);
    const third = await pick(user, [second!.original, first!.original]);

    expect(new Set([first?.original, second?.original])).toEqual(new Set(["Fernweh", "Regengeruch"]));
    expect(third).toBeNull();
  });

  it("serves a reviewed card for free before paying for a translation", async () => {
    const deps = buildDeps([item("wanderlust", { en: "wanderlust", de: "Fernweh" })], {
      findDemoCard: vi.fn().mockResolvedValue({
        emoji: "✈️",
        nativeMeaning: "тоска по дальним краям",
        translations: { ru: "тяга к путешествиям" },
      }),
    });

    const word = await createPackWordPicker(deps)(user, []);

    expect(word).toMatchObject({ original: "Fernweh", nativeMeaning: "тоска по дальним краям" });
    expect(deps.translateHeadword).not.toHaveBeenCalled();
  });

  it("gives two learners different first words so a cohort is not mailed the same one on the same day", async () => {
    const items = Array.from({ length: 20 }, (_, index) => item(`word${index}`, { de: `Wort${index}` }));
    const pick = createPackWordPicker(buildDeps(items));

    const firsts = new Set<string | undefined>();
    for (let userId = 1; userId <= 5; userId++) {
      firsts.add((await pick({ ...user, userId }, []))?.original);
    }

    expect(firsts.size).toBeGreaterThan(1);
  });

  it("gives up after a few failed translations instead of spending a call on every word", async () => {
    const items = Array.from({ length: 20 }, (_, index) => item(`word${index}`, { de: `Wort${index}` }));
    const deps = buildDeps(items, { translateHeadword: vi.fn().mockResolvedValue(null) });

    expect(await createPackWordPicker(deps)(user, [])).toBeNull();
    expect(deps.translateHeadword).toHaveBeenCalledTimes(3);
  });
});
