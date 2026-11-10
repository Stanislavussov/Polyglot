/**
 * Word packs (Task 87) — e2e through the real dispatcher and the real sweep.
 *
 * @business An admin turns one of their dictionaries into a pack with a button;
 * a learner who stopped coming then receives a striking word from it, in the
 * language they study, ahead of the dictionary they walked away from.
 *
 * Packs are global: every active pack is read by every lapsed sweep in the
 * shared database. The words here exist only in Italian and Polish, which no
 * other lapse test studies, and each pack is switched off after its test, so a
 * pack seeded here cannot reach another file's users.
 */
import {
  getDb,
  getLang,
  notificationRepository,
  onboardingDemoCardRepository,
  userRepository,
  vocabularyDictionaryRepository,
  vocabularyRepository,
  wordPackRepository,
} from "@polyglot/adapter-db";
import { processLapsedUsers } from "@polyglot/adapter-notifications";
import { type AIPort, type PackLocalizationResult, t } from "@polyglot/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildNotificationScheduling } from "../../notifications/notification.wiring.js";
import {
  arrangeLapsedUser,
  arrangeOnboardedTranslator,
  LAPSED_DAYS,
  setLapseState,
} from "../../test-helpers/integration/arrange.js";
import {
  type BotHarness,
  type CapturedCall,
  callbackQueryUpdate,
  createBotHarness,
} from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Packs and lapsed users this test created; switched off unconditionally afterwards. */
const createdDictionaryIds: number[] = [];
const seededUserIds: number[] = [];

afterEach(async () => {
  const sql = getDb().$client;
  for (const dictionaryId of createdDictionaryIds.splice(0)) {
    await sql`update word_packs set is_active = false where source_dictionary_id = ${dictionaryId}`;
  }
  await Promise.all(seededUserIds.splice(0).map((id) => notificationRepository.disableNotifications(id)));
});

/** Answers the localization call: the word "facile…" is A2, everything else C1 with a Polish equivalent. */
function packAi(): { ai: Partial<AIPort>; generateObject: ReturnType<typeof vi.fn> } {
  const generateObject = vi.fn(async (prompt: string, schema: { safeParse: (value: unknown) => unknown }) => {
    const wordList = prompt.split("## Target languages")[0] ?? "";
    const words: PackLocalizationResult["words"] = [];
    for (const match of wordList.matchAll(/^(\d+)\. (.+?) \(/gm)) {
      const headword = match[2]!;
      words.push({
        index: Number(match[1]),
        level: headword.startsWith("facile") ? "A2" : "C1",
        emoji: "🧳",
        equivalents: [
          { languageCode: "pl", headword: `${headword}-pl` },
          // No real equivalent: must be left out, not stored empty.
          { languageCode: "de", headword: "" },
        ],
      });
    }
    const parsed = schema.safeParse({ words }) as { success: boolean; data?: unknown };
    if (!parsed.success) throw new Error("unexpected AI call");
    return parsed.data;
  });
  return { ai: { generateObject: generateObject as unknown as AIPort["generateObject"] }, generateObject };
}

/** A user's dictionary of Italian words, unique to this test. */
async function arrangeDictionary(userId: number, words: string[]): Promise<number> {
  const italian = getLang("it");
  const english = getLang("en");
  if (!italian || !english) throw new Error("language cache is not loaded");
  const dictionary = await vocabularyDictionaryRepository.create(userId, `Standard ${userId}`);
  for (const original of words) {
    const entry = await vocabularyRepository.create(userId, {
      original,
      sourceLangId: italian.id,
      inputType: "word",
      unverified: false,
      translations: [{ targetLangId: english.id, text: `${original}-en`, details: { synonyms: [], examples: [] } }],
    });
    await vocabularyDictionaryRepository.addEntry(dictionary.id, entry.id);
  }
  createdDictionaryIds.push(dictionary.id);
  return dictionary.id;
}

function buttonsOf(call: CapturedCall | undefined): string[] {
  const markup = call?.payload.reply_markup as
    | { inline_keyboard?: Array<Array<{ callback_data?: string }>> }
    | undefined;
  return (markup?.inline_keyboard ?? [])
    .flat()
    .map((button) => button.callback_data)
    .filter((data): data is string => typeof data === "string");
}

function lastScreen(sent: CapturedCall[]): CapturedCall | undefined {
  return sent.filter((call) => call.method === "sendMessage" || call.method === "editMessageText").at(-1);
}

function textOf(call: CapturedCall | undefined): string {
  return String((call?.payload as { text?: string } | undefined)?.text ?? "");
}

async function tap(harness: BotHarness, chatId: number, data: string): Promise<void> {
  harness.reset();
  await harness.dispatch(callbackQueryUpdate({ chatId, fromId: chatId, messageId: 500, data }));
}

async function packItemsFor(words: string[]) {
  return (await wordPackRepository.findActiveItems()).filter((item) => words.includes(item.sourceHeadword));
}

describe("word packs (integration)", () => {
  it("P1: an admin publishes a dictionary as a pack — hard words in, easy ones out, no empty translations", async () => {
    // Arrange
    const { ai, generateObject } = packAi();
    const harness = createBotHarness({ ai });
    const telegramId = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(telegramId);
    await userRepository.updateAudienceGroup(userId, "admin");
    const words = [`struggimento${telegramId}`, `facile${telegramId}`];
    const dictionaryId = await arrangeDictionary(userId, words);

    // Act — the dictionary offers the button.
    await tap(harness, telegramId, `dict:open:${dictionaryId}`);

    // Assert
    expect(buttonsOf(lastScreen(harness.sent))).toContain(`dict:pack:${dictionaryId}`);

    // Act — publish.
    await tap(harness, telegramId, `dict:pack:${dictionaryId}`);

    // Assert — the reply, then the pack in the DB.
    expect(textOf(lastScreen(harness.sent))).toBe(
      t("wordPackPublished", "en", { name: `Standard ${userId}`, kept: 1, tooEasy: 1 }),
    );
    expect(generateObject).toHaveBeenCalledTimes(1);
    const items = await packItemsFor(words);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      sourceLang: "it",
      sourceHeadword: words[0],
      level: "C1",
      headwords: { it: words[0], pl: `${words[0]}-pl` },
    });

    // Act — publishing again refreshes the same pack instead of adding a copy.
    await tap(harness, telegramId, `dict:pack:${dictionaryId}`);

    // Assert
    expect(await packItemsFor(words)).toHaveLength(1);
  });

  it("P2: a regular user neither sees the button nor creates a pack by sending its callback", async () => {
    // Arrange
    const { ai, generateObject } = packAi();
    const harness = createBotHarness({ ai });
    const telegramId = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(telegramId);
    const words = [`struggimento${telegramId}`];
    const dictionaryId = await arrangeDictionary(userId, words);

    // Act
    await tap(harness, telegramId, `dict:open:${dictionaryId}`);
    const offered = buttonsOf(lastScreen(harness.sent));
    await tap(harness, telegramId, `dict:pack:${dictionaryId}`);

    // Assert
    expect(offered).not.toContain(`dict:pack:${dictionaryId}`);
    expect(generateObject).not.toHaveBeenCalled();
    expect(await packItemsFor(words)).toEqual([]);
  });

  it("P3: a learner who stopped coming gets a pack word in the language they study, ahead of their own words", async () => {
    // Arrange — a published pack word, with a reviewed card for the learner's pair.
    const { ai } = packAi();
    const harness = createBotHarness({ ai });
    const adminTelegramId = uniqueTelegramId();
    const adminId = await arrangeOnboardedTranslator(adminTelegramId);
    await userRepository.updateAudienceGroup(adminId, "admin");
    const word = `struggimento${adminTelegramId}`;
    const dictionaryId = await arrangeDictionary(adminId, [word]);
    await tap(harness, adminTelegramId, `dict:pack:${dictionaryId}`);
    const polish = `${word}-pl`;
    await onboardingDemoCardRepository.upsert({
      sourceLang: "pl",
      nativeLang: "en",
      headword: polish,
      sortOrder: 0,
      payload: {
        original: polish,
        sourceLang: "pl",
        emoji: "🧳",
        nativeMeaning: "a longing that wears you down",
        nativeSynonyms: [],
        translations: { en: { text: "longing", synonyms: [], examples: [] } },
      },
    });
    await onboardingDemoCardRepository.setActive("pl", "en", polish, true);

    const learner = await arrangeLapsedUser(uniqueTelegramId(), { withVocabulary: true });
    seededUserIds.push(learner.userId);
    await userRepository.updateSettings(learner.userId, {
      interfaceLang: "en",
      nativeLang: "en",
      learningLangs: ["pl"],
      lastSourceLang: null,
    });
    await setLapseState(learner.userId, { lastInteractionAt: new Date(Date.now() - LAPSED_DAYS * DAY_MS) });
    harness.reset();

    // Act
    const { sendFn, reEngagementSendFn, deps } = await buildNotificationScheduling(harness.bot.api);
    await processLapsedUsers(sendFn, reEngagementSendFn, deps);

    // Assert — the card, then the history that stops it being sent again.
    const mine = harness.sent.filter(
      (call) =>
        call.method === "sendMessage" && Number((call.payload as { chat_id?: number }).chat_id) === learner.telegramId,
    );
    expect(mine).toHaveLength(1);
    expect(textOf(mine[0])).toContain(polish);
    expect(textOf(mine[0])).not.toContain(learner.headword);
    const fromPacks = await notificationRepository.getSentWordsFromSourceSince(
      learner.userId,
      "pack",
      new Date(Date.now() - 60_000),
    );
    expect(fromPacks).toEqual([polish]);
  });
});
