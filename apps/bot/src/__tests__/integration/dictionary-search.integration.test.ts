/**
 * Dictionary search and sort — grammY e2e integration test.
 *
 * Spec. The dictionary list offers 🔍 Search and a sort toggle.
 * - 🔍 arms a one-shot prompt; the user's next text message is the query, never a
 *   translation request. The query matches the original word OR any translation,
 *   case-insensitively, inside the dictionary being browsed.
 * - The query and the sort live in the session, because callback data (64 bytes)
 *   cannot carry free text: paging, opening a card and coming back, and deleting
 *   a word all stay inside the filtered list until the user resets the search.
 * - Leaving the prompt any other way (back to the list, close) disarms it, so a
 *   later word is translated as usual rather than swallowed as a query.
 * - Non-goals: typo tolerance, cross-dictionary search, search indexes.
 */
import {
  botSessionRepository,
  languageRepository,
  vocabularyDictionaryRepository,
  vocabularyRepository,
} from "@polyglot/adapter-db";
import type { AIPort } from "@polyglot/core";
import { describe, expect, it } from "vitest";
import { arrangeOnboardedTranslator } from "../../test-helpers/integration/arrange.js";
import {
  type BotHarness,
  callbackQueryUpdate,
  createBotHarness,
  lastRenderedCard,
  messageUpdate,
} from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../test-helpers/integration/translate-ai-mock.js";
import type { SessionData } from "../../types.js";

/** original (cs) → translation (en). "pes" is findable only through its translation "dog". */
const WORDS: Array<[string, string]> = [
  ["kotva", "anchor"],
  ["pes", "dog"],
  ["kocour", "tomcat"],
  ["auto", "car"],
];

async function langId(code: string): Promise<number> {
  const lang = await languageRepository.findByCode(code);
  if (!lang) throw new Error(`language ${code} is not seeded`);
  return lang.id;
}

async function arrangeDictionary(userId: number): Promise<{ dictionaryId: number; ids: Map<string, number> }> {
  const [cs, en] = await Promise.all([langId("cs"), langId("en")]);
  const ids = new Map<string, number>();
  for (const [original, translation] of WORDS) {
    const entry = await vocabularyRepository.create(userId, {
      original,
      sourceLangId: cs,
      inputType: "word",
      translations: [{ targetLangId: en, text: translation, details: { synonyms: [], examples: [] } }],
    });
    await vocabularyDictionaryRepository.addEntryToDefault(userId, entry.id);
    ids.set(original, entry.id);
  }
  const dictionary = await vocabularyDictionaryRepository.getOrCreateDefault(userId);
  return { dictionaryId: dictionary.id, ids };
}

interface Rendered {
  messageId: number;
  text: string;
  buttons: string[];
}

/** The most recent message the bot sent or edited, with its callback buttons. */
function lastRendered(harness: BotHarness): Rendered {
  const call = harness.sent.filter((c) => c.method === "sendMessage" || c.method === "editMessageText").at(-1);
  if (!call) throw new Error("expected the bot to have sent or edited a message");
  const markup = call.payload.reply_markup as
    | { inline_keyboard?: Array<Array<{ callback_data?: string }>> }
    | undefined;
  return {
    messageId: call.messageId ?? Number(call.payload.message_id),
    text: String(call.payload.text ?? ""),
    buttons: (markup?.inline_keyboard ?? [])
      .flat()
      .map((button) => button.callback_data)
      .filter((data): data is string => typeof data === "string"),
  };
}

/** Entry ids in the order the list keyboard shows them. */
function listedEntryIds(rendered: Rendered): number[] {
  return rendered.buttons.filter((data) => data.startsWith("dict:view:")).map((data) => Number(data.split(":")[3]));
}

async function readSession(chatId: number): Promise<SessionData> {
  const row = await botSessionRepository.get(String(chatId));
  if (!row) throw new Error(`no session persisted for chat ${chatId}`);
  return row.data as SessionData;
}

/** The default harness AI throws, so a query that leaks into the translator fails the test loudly. */
async function arrangeOpenDictionary(ai?: Partial<AIPort>) {
  const harness = createBotHarness(ai ? { ai } : {});
  const id = uniqueTelegramId();
  const userId = await arrangeOnboardedTranslator(id);
  const { dictionaryId, ids } = await arrangeDictionary(userId);

  await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "/dictionary" }));
  const list = lastRendered(harness);
  harness.reset();

  const tap = async (messageId: number, data: string): Promise<Rendered> => {
    harness.reset();
    await harness.dispatch(callbackQueryUpdate({ chatId: id, fromId: id, messageId, data }));
    return lastRendered(harness);
  };
  const say = async (text: string): Promise<Rendered> => {
    harness.reset();
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text }));
    return lastRendered(harness);
  };

  return { harness, id, userId, dictionaryId, ids, list, tap, say };
}

describe("dictionary search", () => {
  it("finds words by original and by translation, and keeps the filter while browsing", async () => {
    // Arrange
    const { harness, id, dictionaryId, ids, list, tap, say } = await arrangeOpenDictionary();
    expect(list.buttons).toContain(`dict:search:${dictionaryId}`);

    // Act — open the prompt
    const prompt = await tap(list.messageId, `dict:search:${dictionaryId}`);

    // Assert — prompt shown, session armed
    expect(prompt.text).toContain("Send a word");
    expect((await readSession(id)).dictionaryWizard).toMatchObject({ action: "search", dictionaryId });

    // Act — query by a fragment of the original, in a different case
    const byOriginal = await say("KO");

    // Assert — both "ko…" words, nothing else; the text is a query, not a translation
    expect(new Set(listedEntryIds(byOriginal))).toEqual(new Set([ids.get("kocour"), ids.get("kotva")]));
    expect(byOriginal.text).toContain("KO");
    expect(harness.sent.filter((call) => call.method === "sendMessage")).toHaveLength(1);
    const afterQuery = await readSession(id);
    expect(afterQuery.dictionaryWizard).toBeUndefined();
    expect(afterQuery.dictionary).toMatchObject({ search: "KO", dictionaryId, currentPage: 1 });

    // Act — new search, by translation
    await tap(byOriginal.messageId, `dict:search:${dictionaryId}`);
    const byTranslation = await say("dog");

    // Assert — "pes" is found through "dog"
    expect(listedEntryIds(byTranslation)).toEqual([ids.get("pes")]);

    // Act — open the card and come back
    const pesId = ids.get("pes");
    const card = await tap(byTranslation.messageId, `dict:view:${dictionaryId}:${pesId}:1`);
    expect(card.text).toContain("pes");
    const back = await tap(byTranslation.messageId, `dict:page:${dictionaryId}:1`);

    // Assert — still the filtered list
    expect(listedEntryIds(back)).toEqual([pesId]);
    expect(back.buttons).toContain(`dict:search-clear:${dictionaryId}`);

    // Act — reset the search
    const full = await tap(byTranslation.messageId, `dict:search-clear:${dictionaryId}`);

    // Assert — everything is back, the filter is gone from the session
    expect(listedEntryIds(full)).toHaveLength(WORDS.length);
    expect(full.buttons).not.toContain(`dict:search-clear:${dictionaryId}`);
    expect((await readSession(id)).dictionary?.search).toBeUndefined();
  });

  it("says so when nothing matches and still offers a way out", async () => {
    // Arrange
    const { dictionaryId, list, tap, say } = await arrangeOpenDictionary();
    await tap(list.messageId, `dict:search:${dictionaryId}`);

    // Act
    const empty = await say("zzzz");

    // Assert
    expect(listedEntryIds(empty)).toEqual([]);
    expect(empty.text).toContain("zzzz");
    expect(empty.buttons).toEqual(
      expect.arrayContaining([`dict:search:${dictionaryId}`, `dict:search-clear:${dictionaryId}`]),
    );
  });

  it("deleting a word from search results keeps the filter: the way back leads to the filtered list", async () => {
    // Arrange
    const { id, userId, dictionaryId, ids, list, tap, say } = await arrangeOpenDictionary();
    await tap(list.messageId, `dict:search:${dictionaryId}`);
    const results = await say("ko");
    const kotvaId = ids.get("kotva");

    // Act — delete; the screen that follows offers the word back, or the list.
    const removed = await tap(results.messageId, `dict:confirm-delete:${dictionaryId}:${kotvaId}:1`);

    // Assert — reply, DB, session
    expect(removed.buttons).toEqual([`dict:restore:${dictionaryId}:${kotvaId}:1`, `dict:page:${dictionaryId}:1`]);
    expect(await vocabularyRepository.countByUser(userId, dictionaryId)).toBe(WORDS.length - 1);
    expect((await readSession(id)).dictionary?.search).toBe("ko");

    // Act — back to the list.
    const after = await tap(results.messageId, `dict:page:${dictionaryId}:1`);

    // Assert — still the search results, without the removed word.
    expect(listedEntryIds(after)).toEqual([ids.get("kocour")]);
    expect((await readSession(id)).dictionary?.search).toBe("ko");
  });

  it("disarms the prompt when the user goes back, so the next word is translated", async () => {
    // Arrange
    const { harness, id, dictionaryId, list, tap, say } = await arrangeOpenDictionary(deterministicTranslateAi());
    const prompt = await tap(list.messageId, `dict:search:${dictionaryId}`);
    expect(prompt.buttons).toContain(`dict:page:${dictionaryId}:1`);

    // Act — cancel, then type a word
    await tap(list.messageId, `dict:page:${dictionaryId}:1`);
    expect((await readSession(id)).dictionaryWizard).toBeUndefined();
    await say("hello");

    // Assert — it went to the translator: a card was rendered
    expect(lastRenderedCard(harness.sent).buttons.some((data) => data.startsWith("tr:"))).toBe(true);
    expect((await readSession(id)).dictionary?.search).toBeUndefined();
  });

  it("a typed command abandons the prompt", async () => {
    // Arrange
    const { harness, id, dictionaryId, list, tap, say } = await arrangeOpenDictionary(deterministicTranslateAi());
    await tap(list.messageId, `dict:search:${dictionaryId}`);

    // Act
    const reopened = await say("/dictionary");
    expect((await readSession(id)).dictionaryWizard).toBeUndefined();
    await say("hello");

    // Assert — the reopened list is unfiltered and the word was translated, not searched
    expect(listedEntryIds(reopened)).toHaveLength(WORDS.length);
    expect(lastRenderedCard(harness.sent).buttons.some((data) => data.startsWith("tr:"))).toBe(true);
    expect((await readSession(id)).dictionary?.search).toBeUndefined();
  });

  it("a tap on any other button abandons the prompt", async () => {
    // Arrange
    const { harness, id, dictionaryId, ids, list, tap, say } = await arrangeOpenDictionary(deterministicTranslateAi());
    await tap(list.messageId, `dict:search:${dictionaryId}`);

    // Act — the user opens a word from an older list message instead of typing
    await tap(list.messageId, `dict:view:${dictionaryId}:${ids.get("auto")}:1`);
    expect((await readSession(id)).dictionaryWizard).toBeUndefined();
    await say("hello");

    // Assert
    expect(lastRenderedCard(harness.sent).buttons.some((data) => data.startsWith("tr:"))).toBe(true);
  });

  it("a query does not follow the user into another dictionary through a word card", async () => {
    // Arrange — a search is active in the default dictionary; "Travel" holds one non-matching word
    const { id, userId, dictionaryId, ids, list, tap, say } = await arrangeOpenDictionary();
    const travel = await vocabularyDictionaryRepository.create(userId, "Travel");
    const autoId = ids.get("auto");
    if (!autoId) throw new Error("fixture word missing");
    await vocabularyDictionaryRepository.addEntry(travel.id, autoId);
    await tap(list.messageId, `dict:search:${dictionaryId}`);
    await say("dog");

    // Act — open a card from a stale "Travel" message, then go back to its list
    await tap(list.messageId, `dict:view:${travel.id}:${autoId}:1`);
    const travelList = await tap(list.messageId, `dict:page:${travel.id}:1`);

    // Assert — "Travel" is unfiltered
    expect(listedEntryIds(travelList)).toEqual([autoId]);
    expect(travelList.buttons).not.toContain(`dict:search-clear:${travel.id}`);
    expect((await readSession(id)).dictionary?.search).toBeUndefined();
  });

  it("cancelling the new-dictionary prompt disarms it too", async () => {
    // Arrange
    const { harness, id, userId, list, tap, say } = await arrangeOpenDictionary(deterministicTranslateAi());
    await tap(list.messageId, "dict:create");
    expect((await readSession(id)).dictionaryWizard).toMatchObject({ action: "create" });

    // Act — cancel lands on the switcher, then the user types a word
    await tap(list.messageId, "dict:list");
    await say("hello");

    // Assert — translated, and no dictionary named "hello" appeared
    expect(lastRenderedCard(harness.sent).buttons.some((data) => data.startsWith("tr:"))).toBe(true);
    expect((await readSession(id)).dictionaryWizard).toBeUndefined();
    const names = (await vocabularyDictionaryRepository.listByUser(userId)).map((dictionary) => dictionary.name);
    expect(names).not.toContain("hello");
  });

  it("opening another dictionary drops the query", async () => {
    // Arrange
    const { id, userId, dictionaryId, list, tap, say } = await arrangeOpenDictionary();
    const other = await vocabularyDictionaryRepository.create(userId, "Travel");
    await tap(list.messageId, `dict:search:${dictionaryId}`);
    const results = await say("dog");

    // Act
    const opened = await tap(results.messageId, `dict:open:${other.id}`);

    // Assert
    expect(opened.buttons).not.toContain(`dict:search-clear:${other.id}`);
    expect((await readSession(id)).dictionary).toMatchObject({ dictionaryId: other.id });
    expect((await readSession(id)).dictionary?.search).toBeUndefined();
  });
});

describe("dictionary sort", () => {
  it("toggles between A–Z and newest-first and keeps the choice across pages", async () => {
    // Arrange
    const { id, dictionaryId, ids, list, tap } = await arrangeOpenDictionary();
    expect(list.buttons).toContain(`dict:sort:${dictionaryId}:alpha`);

    // Act
    const alpha = await tap(list.messageId, `dict:sort:${dictionaryId}:alpha`);

    // Assert — A→Z by original, and the toggle now offers the way back
    expect(listedEntryIds(alpha)).toEqual(["auto", "kocour", "kotva", "pes"].map((word) => ids.get(word)));
    expect(alpha.buttons).toContain(`dict:sort:${dictionaryId}:recent`);
    expect((await readSession(id)).dictionary).toMatchObject({ sort: "alpha", currentPage: 1 });

    // Act — re-render the page through the ordinary pager
    const samePage = await tap(list.messageId, `dict:page:${dictionaryId}:1`);

    // Assert
    expect(listedEntryIds(samePage)).toEqual(listedEntryIds(alpha));
  });
});
