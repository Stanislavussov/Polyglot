/**
 * A notification rotates through the dictionary — e2e (scheduler → delivery, real Postgres, fake `fetch`).
 *
 * @business A learner who never grades a notification word must still get a different word
 * every day. The bug this guards against: the deck followed the SRS order, which only moves
 * on a grade, and remembered sent words for 24 h, so the same one or two words came back
 * for days.
 *
 * **Its own UTC slot (21:00)**, so a batch here reaches only this file's subscribers. Days
 * are simulated by moving this user's `notification_history` one day back between runs.
 */
import { getDb, getLang, notificationRepository, vocabularyRepository } from "@polyglot/adapter-db";
import { checkAndSend } from "@polyglot/adapter-notifications";
import type { GenerateObjectFn } from "@polyglot/core";
import { afterEach, describe, expect, it } from "vitest";
import { buildNotificationScheduling } from "../../notifications/notification.wiring.js";
import { arrangeNotifiableUser } from "../../test-helpers/integration/arrange.js";
import { createBotHarness } from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";

const SLOT_UTC = { hour: 21, minute: 0 } as const;
const SLOT_TIME = "21:00";
const DAY_MS = 24 * 60 * 60 * 1000;
const PAST = new Date("2020-01-01T00:00:00.000Z").getTime();
const FUTURE = Date.now() + 30 * DAY_MS;

function langId(code: string): number {
  const lang = getLang(code);
  if (!lang) throw new Error(`language cache is not loaded (${code} missing)`);
  return lang.id;
}

const failingAi: GenerateObjectFn = async <T>(): Promise<T> => {
  throw new Error("NO_LIVE_AI_IN_TESTS");
};

const seededUserIds: number[] = [];

async function arrangeLearner(words: readonly string[], dueAt: (index: number) => Date): Promise<number> {
  const { userId } = await arrangeNotifiableUser(uniqueTelegramId(), {
    notificationTimes: [SLOT_TIME],
    withVocabulary: false,
  });
  seededUserIds.push(userId);
  await notificationRepository.updatePrefs(userId, { notificationBatchSize: 1 });
  for (const [index, original] of words.entries()) {
    const entry = await vocabularyRepository.create(userId, {
      original,
      sourceLangId: langId("cs"),
      inputType: "word",
      unverified: false,
      translations: [{ targetLangId: langId("en"), text: `${original}-en`, details: { synonyms: [], examples: [] } }],
    });
    await vocabularyRepository.updateSrsState(entry.translations[0]!.id, {
      easeFactor: 2.5,
      interval: 1,
      dueDate: dueAt(index),
      reviewCount: 1,
    });
  }
  return userId;
}

/** One daily slot: deliver, then move these users' history one day back. */
async function runDay(userIds: number[]): Promise<void> {
  const harness = createBotHarness();
  const { sendFn, deps } = await buildNotificationScheduling(harness.bot.api, {
    generateObject: failingAi,
    pickSelfCheckVariant: () => 0,
  });
  await checkAndSend(sendFn, {
    ...deps,
    now: () => SLOT_UTC,
    pickPresetWord: async () => null,
    pickPackWord: async () => null,
  });
  await getDb().$client`
    update notification_history set sent_at = sent_at - interval '1 day' where user_id = any(${userIds})
  `;
}

async function sentInOrder(userId: number): Promise<string[]> {
  const rows = await getDb().$client<Array<{ original: string }>>`
    select original from notification_history where user_id = ${userId} order by sent_at asc, id asc
  `;
  return rows.map((row) => row.original);
}

afterEach(async () => {
  const ids = seededUserIds.splice(0);
  await Promise.all(ids.map((id) => notificationRepository.disableNotifications(id)));
});

describe("notification word rotation (integration)", () => {
  it("R1: an ungraded overdue dictionary gives a new word every day until each word was sent", async () => {
    // Arrange — five words, all overdue, nobody grades anything.
    const words = ["pes", "kočka", "dům", "strom", "voda"] as const;
    const userId = await arrangeLearner(words, (index) => new Date(PAST + index * DAY_MS));

    // Act — seven daily slots.
    for (let day = 0; day < 7; day++) await runDay([userId]);

    // Assert — the first five days carry five different words.
    const sent = await sentInOrder(userId);
    expect(sent).toHaveLength(7);
    expect(new Set(sent.slice(0, 5)).size).toBe(5);
    // Assert — after the round, the word seen longest ago comes back first, never yesterday's.
    expect(sent.slice(5)).toEqual(sent.slice(0, 2));
    for (let day = 1; day < sent.length; day++) expect(sent[day]).not.toBe(sent[day - 1]);
  });

  it("R2: words not due yet are dealt in a random order, different from learner to learner", async () => {
    // Arrange — six learners with the same ten words, none due.
    const words = ["pes", "kočka", "dům", "strom", "voda", "oheň", "kniha", "okno", "stůl", "slunce"] as const;
    const userIds: number[] = [];
    for (let i = 0; i < 6; i++) userIds.push(await arrangeLearner(words, () => new Date(FUTURE)));

    // Act — three daily slots.
    for (let day = 0; day < 3; day++) await runDay(userIds);

    // Assert — every learner gets three different words.
    const histories = await Promise.all(userIds.map(sentInOrder));
    for (const sent of histories) {
      expect(sent).toHaveLength(3);
      expect(new Set(sent).size).toBe(3);
    }
    // Assert — not everyone starts on the same word (all six alike by chance: 1 in 100 000).
    expect(new Set(histories.map((sent) => sent[0])).size).toBeGreaterThan(1);
  });
});
