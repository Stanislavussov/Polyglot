/** AC 2 — the web dictionary lists the words the user saved in the bot, with search and sort. */
import { getLang, vocabularyDictionaryRepository, vocabularyRepository } from "@polyglot/adapter-db";
import { describe, expect, it } from "vitest";
import { arrangeOnboardedTranslator } from "../../bot/src/test-helpers/integration/arrange.js";
import { uniqueTelegramId } from "../../bot/src/test-helpers/integration/id-factory.js";
import { createWebHarness } from "./test-helpers/web-harness.js";

async function saveInBot(userId: number, original: string): Promise<number> {
  const entry = await vocabularyRepository.create(userId, {
    original,
    sourceLangId: getLang("cs")!.id,
    inputType: "word",
    unverified: false,
    translations: [
      { targetLangId: getLang("en")!.id, text: `${original}-en`, details: { synonyms: [], examples: [] } },
    ],
  });
  await vocabularyDictionaryRepository.addEntryToDefault(userId, entry.id);
  return entry.id;
}

interface Page {
  items: { original: string; sourceLang: string; translations: { lang: string; text: string }[] }[];
  total: number;
}

describe("web dictionary", () => {
  it("shows the bot's saved words, searchable and sortable", async () => {
    const web = await createWebHarness();
    const telegramId = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(telegramId);
    await saveInBot(userId, "pes");
    await saveInBot(userId, "auto");
    await saveInBot(userId, "kočka");
    const { cookie } = await web.login(telegramId);

    const all = (await web.call(cookie, "GET", "/api/dictionary?sort=alpha")).body as Page;
    expect(all.total).toBe(3);
    expect(all.items.map((i) => i.original)).toEqual(["auto", "kočka", "pes"]);
    expect(all.items[0]).toMatchObject({ sourceLang: "cs", translations: [{ lang: "en", text: "auto-en" }] });

    const found = (await web.call(cookie, "GET", "/api/dictionary?q=pe")).body as Page;
    expect(found.items.map((i) => i.original)).toEqual(["pes"]);
  });

  it("removes and restores a word for both channels, and shows details only to its owner", async () => {
    const web = await createWebHarness();
    const telegramId = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(telegramId);
    const entryId = await saveInBot(userId, "pes");
    const { cookie } = await web.login(telegramId);

    const detail = await web.call(cookie, "GET", `/api/dictionary/${entryId}`);
    expect(detail).toMatchObject({
      status: 200,
      body: { original: "pes", details: [{ lang: "en", text: "pes-en", review: { reviewCount: 0 } }] },
    });

    expect((await web.call(cookie, "DELETE", `/api/dictionary/${entryId}`)).status).toBe(204);
    // The bot reads the same row: removed on the web is removed in the bot.
    expect((await vocabularyRepository.findById(entryId))?.isActive).toBe(false);
    expect(((await web.call(cookie, "GET", "/api/dictionary")).body as Page).total).toBe(0);
    expect((await web.call(cookie, "GET", `/api/dictionary/${entryId}`)).status).toBe(404);

    expect((await web.call(cookie, "POST", `/api/dictionary/${entryId}/restore`)).status).toBe(204);
    expect((await vocabularyRepository.findById(entryId))?.isActive).toBe(true);

    const intruder = uniqueTelegramId();
    await arrangeOnboardedTranslator(intruder);
    const other = await web.login(intruder);
    expect((await web.call(other.cookie, "GET", `/api/dictionary/${entryId}`)).status).toBe(404);
    expect((await web.call(other.cookie, "DELETE", `/api/dictionary/${entryId}`)).status).toBe(404);
  });

  it("opens one word as a review card", async () => {
    const web = await createWebHarness();
    const telegramId = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(telegramId);
    const entryId = await saveInBot(userId, "kůň");
    const { cookie } = await web.login(telegramId);

    const res = await web.call(cookie, "GET", `/api/review/card/${entryId}`);
    expect(res).toMatchObject({
      status: 200,
      body: { card: { entryId, front: { headword: "kůň" }, detail: { details: [{ lang: "en" }] } } },
    });
  });

  it("filters by language, type, grade and review state", async () => {
    const web = await createWebHarness();
    const telegramId = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(telegramId);
    const pes = await saveInBot(userId, "pes"); // cs → en
    const phrase = await vocabularyRepository.create(userId, {
      original: "good morning",
      sourceLangId: getLang("en")!.id,
      inputType: "phrase",
      unverified: false,
      translations: [
        { targetLangId: getLang("de")!.id, text: "guten Morgen", details: { synonyms: [], examples: [] } },
      ],
    });
    await vocabularyDictionaryRepository.addEntryToDefault(userId, phrase.id);
    await vocabularyRepository.setDifficulty(pes, userId, "hard");
    const [row] = await vocabularyRepository.findEntrySrsRows(userId, pes);
    await vocabularyRepository.updateSrsState(row!.translationId, {
      easeFactor: 2.5,
      interval: 30,
      dueDate: new Date("2020-01-01T00:00:00Z"),
      reviewCount: 5,
    });
    const { cookie } = await web.login(telegramId);
    const list = async (query: string) =>
      ((await web.call(cookie, "GET", `/api/dictionary?sort=alpha&${query}`)).body as Page).items.map(
        (i) => i.original,
      );

    // The word itself is in that language; a translation into it does not count.
    expect(await list("lang=cs")).toEqual(["pes"]);
    expect(await list("lang=en")).toEqual(["good morning"]);
    expect(await list("lang=de")).toEqual([]);
    expect(await list("type=phrase")).toEqual(["good morning"]);
    expect(await list("difficulty=hard")).toEqual(["pes"]);
    expect(await list("difficulty=normal")).toEqual(["good morning"]); // never graded counts as normal
    expect(await list("review=due")).toEqual(["pes"]);
    expect(await list("review=new")).toEqual(["good morning"]);
    expect(await list("review=learned")).toEqual(["pes"]);
    expect(await list("lang=cs&review=new")).toEqual([]);
    const page = (await web.call(cookie, "GET", "/api/dictionary?type=phrase")).body as Page;
    expect(page.total).toBe(1);
    expect((await web.call(cookie, "GET", "/api/dictionary?lang=xx")).status).toBe(400);
  });
});
