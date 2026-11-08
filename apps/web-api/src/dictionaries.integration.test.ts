/**
 * Several dictionaries on the web, as in the bot's dict:* switcher:
 * - list (default first, with counts), create, rename, delete — the default one refuses rename/delete;
 * - a name must be unique (case-insensitive) and 1..32 characters;
 * - open one dictionary's words; add a word to another, or move it there;
 * - removing a word from a dictionary that is not its only one only leaves that list,
 *   and the undo puts it back; removing its last membership soft-deletes the word;
 * - everything is owner-scoped.
 */
import { getLang, vocabularyDictionaryRepository, vocabularyRepository } from "@polyglot/adapter-db";
import { describe, expect, it } from "vitest";
import { arrangeOnboardedTranslator } from "../../bot/src/test-helpers/integration/arrange.js";
import { uniqueTelegramId } from "../../bot/src/test-helpers/integration/id-factory.js";
import { createWebHarness } from "./test-helpers/web-harness.js";

interface DictionaryView {
  id: number;
  name: string;
  isDefault: boolean;
  count: number;
}

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

async function setUp() {
  const web = await createWebHarness();
  const telegramId = uniqueTelegramId();
  const userId = await arrangeOnboardedTranslator(telegramId);
  const { cookie } = await web.login(telegramId);
  const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown) =>
    web.call(cookie, method, url, payload);
  const list = async () => ((await call("GET", "/api/dictionaries")).body as { items: DictionaryView[] }).items;
  const words = async (dictionaryId: number) =>
    (
      (await call("GET", `/api/dictionary?dictionary=${dictionaryId}`)).body as { items: { original: string }[] }
    ).items.map((i) => i.original);
  return { web, userId, call, list, words };
}

describe("web dictionaries", () => {
  it("creates, renames and deletes a dictionary; the default one stays", async () => {
    const { userId, call, list } = await setUp();
    await saveInBot(userId, "pes");

    const created = await call("POST", "/api/dictionaries", { name: "  Travel   words " });
    expect(created).toMatchObject({ status: 201, body: { name: "Travel words", isDefault: false } });
    const travel = created.body as DictionaryView;

    expect((await call("POST", "/api/dictionaries", { name: "travel WORDS" })).status).toBe(400);
    expect((await call("POST", "/api/dictionaries", { name: "   " })).status).toBe(400);
    expect((await call("POST", "/api/dictionaries", { name: "x".repeat(33) })).status).toBe(400);

    const [first, second] = await list();
    expect(first).toMatchObject({ isDefault: true, count: 1 });
    expect(second).toMatchObject({ id: travel.id, count: 0 });

    expect(await call("PATCH", `/api/dictionaries/${travel.id}`, { name: "Trips" })).toMatchObject({
      status: 200,
      body: { name: "Trips" },
    });
    expect((await call("PATCH", `/api/dictionaries/${first!.id}`, { name: "Renamed" })).status).toBe(404);
    expect((await call("DELETE", `/api/dictionaries/${first!.id}`)).status).toBe(404);

    expect((await call("DELETE", `/api/dictionaries/${travel.id}`)).status).toBe(204);
    expect((await list()).map((d) => d.id)).toEqual([first!.id]);
  });

  it("adds a word to another dictionary, moves it, and removes it from one list only", async () => {
    const { userId, call, list, words } = await setUp();
    const pes = await saveInBot(userId, "pes");
    const travel = (await call("POST", "/api/dictionaries", { name: "Travel" })).body as DictionaryView;
    const food = (await call("POST", "/api/dictionaries", { name: "Food" })).body as DictionaryView;
    const defaultId = (await list()).find((d) => d.isDefault)!.id;

    expect((await call("POST", `/api/dictionary/${pes}/dictionaries`, { to: travel.id })).status).toBe(200);
    expect(await words(travel.id)).toEqual(["pes"]);
    expect(await words(defaultId)).toEqual(["pes"]);

    expect((await call("POST", `/api/dictionary/${pes}/dictionaries`, { to: food.id, from: travel.id })).status).toBe(
      200,
    );
    expect(await words(food.id)).toEqual(["pes"]);
    expect(await words(travel.id)).toEqual([]);

    // Still in the default dictionary, so this only takes it out of Food.
    expect((await call("DELETE", `/api/dictionary/${pes}?dictionary=${food.id}`)).status).toBe(204);
    expect(await words(food.id)).toEqual([]);
    expect((await vocabularyRepository.findById(pes))?.isActive).toBe(true);
    expect((await call("POST", `/api/dictionary/${pes}/restore?dictionary=${food.id}`)).status).toBe(204);
    expect(await words(food.id)).toEqual(["pes"]);

    // The last list it lives in: the word itself goes, and the undo brings it back there.
    await call("DELETE", `/api/dictionary/${pes}?dictionary=${food.id}`);
    expect((await call("DELETE", `/api/dictionary/${pes}?dictionary=${defaultId}`)).status).toBe(204);
    expect((await vocabularyRepository.findById(pes))?.isActive).toBe(false);
    expect((await call("POST", `/api/dictionary/${pes}/restore?dictionary=${defaultId}`)).status).toBe(204);
    expect(await words(defaultId)).toEqual(["pes"]);
  });

  it("keeps another learner's dictionaries out of reach", async () => {
    const owner = await setUp();
    const pes = await saveInBot(owner.userId, "pes");
    const travel = (await owner.call("POST", "/api/dictionaries", { name: "Travel" })).body as DictionaryView;

    const intruder = await setUp();
    expect((await intruder.call("GET", `/api/dictionary?dictionary=${travel.id}`)).status).toBe(404);
    expect((await intruder.call("PATCH", `/api/dictionaries/${travel.id}`, { name: "Mine" })).status).toBe(404);
    expect((await intruder.call("DELETE", `/api/dictionaries/${travel.id}`)).status).toBe(404);
    expect((await intruder.call("POST", `/api/dictionary/${pes}/dictionaries`, { to: travel.id })).status).toBe(404);
    expect(await owner.list()).toHaveLength(2);
  });
});
