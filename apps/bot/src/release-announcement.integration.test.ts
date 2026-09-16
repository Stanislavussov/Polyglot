/**
 * Panel → queue → bot → chat, against a real Postgres.
 *
 * The unit lane proves the sender's decisions with mocks. What only the database
 * can prove is here: a job claimed exactly once, the per-note ledger that stops a
 * reader being told the same thing twice, and the journal row the admin panel
 * reads back.
 *
 * The worker drains the whole queue, and this lane runs two workers, so every
 * assertion is scoped to this test's own user — never to how many messages were
 * sent overall.
 */
import {
  identityRepository,
  notificationDeliveryRepository,
  releaseAnnouncementJobRepository,
  userRepository,
} from "@polyglot/adapter-db";
import { noteId } from "@polyglot/core";
import { describe, expect, it, vi } from "vitest";
import { runPendingAnnouncements } from "./release-announcement.wiring.js";
import { uniqueTelegramId } from "./test-helpers/integration/id-factory.js";

const FIRST = "First change.";
const SECOND = "Second change.";

const NOTES = [
  { id: noteId(FIRST), texts: { en: FIRST, ru: "Первое изменение." } },
  { id: noteId(SECOND), texts: { en: SECOND, ru: "Второе изменение." } },
];

function makeMessenger() {
  // Parameters are declared so the recorded calls stay typed for `callsTo`.
  return {
    sendMessage: vi.fn((_chatId: number, _text: string) => Promise.resolve({ message_id: 4242 })),
  };
}

/** Messages this test's own reader received, ignoring any other worker's sends. */
function callsTo(messenger: ReturnType<typeof makeMessenger>, chatId: number): string[] {
  return messenger.sendMessage.mock.calls.filter((call) => call[0] === chatId).map((call) => String(call[1]));
}

/** A tester who reads the bot in `lang` and has a Telegram identity to send to. */
async function seedTester(lang: string): Promise<{ userId: number; telegramId: number }> {
  const telegramId = uniqueTelegramId();
  const user = await userRepository.create({ telegramId, audienceGroup: "tester" });
  await userRepository.updateSettings(user.id, { interfaceLang: lang, nativeLang: lang, learningLangs: [] });
  await identityRepository.linkIdentity(user.id, "telegram", String(telegramId));
  return { userId: user.id, telegramId };
}

async function wasDelivered(userId: number, englishText: string): Promise<boolean> {
  return userRepository.hasReleaseAnnouncementDelivery(`note:${noteId(englishText)}`, "tester", userId);
}

async function enqueue(): Promise<{ id: number }> {
  return releaseAnnouncementJobRepository.enqueue({
    notes: NOTES,
    audienceGroups: ["tester"],
    createdBy: "editor@polyglot.test",
  });
}

async function jobById(id: number) {
  const jobs = await releaseAnnouncementJobRepository.list(100);
  return jobs.find((job) => job.id === id);
}

describe("release announcement worker", () => {
  it("sends a queued announcement in the reader's language and records every note", async () => {
    // Arrange
    const { userId, telegramId } = await seedTester("ru");
    const messenger = makeMessenger();
    const job = await enqueue();

    // Act
    await runPendingAnnouncements(messenger);

    // Assert — the chat, the ledger, the journal, the job row.
    const sent = callsTo(messenger, telegramId);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Что нового");
    expect(sent[0]).toContain("• Первое изменение.");
    expect(sent[0]).not.toContain(FIRST);

    expect(await wasDelivered(userId, FIRST)).toBe(true);
    expect(await wasDelivered(userId, SECOND)).toBe(true);

    // Exactly what the panel's Notifications page reads back; its projection
    // carries no message id, and the unit lane already proves that is journaled.
    const journal = await notificationDeliveryRepository.list({ page: 1, limit: 20, userId });
    expect(journal.deliveries).toHaveLength(1);
    expect(journal.deliveries[0]).toMatchObject({
      kind: "release_announcement",
      parseMode: "HTML",
      meta: { releaseId: `job:${job.id}`, noteIds: `${noteId(FIRST)},${noteId(SECOND)}` },
    });

    expect(await jobById(job.id)).toMatchObject({
      status: "sent",
      result: { attempted: 1, delivered: 1, failed: 0 },
    });
  });

  it("tells a reader nothing twice, however often the same notes are sent again", async () => {
    // Arrange — a reader who already received both notes.
    const { userId, telegramId } = await seedTester("ru");
    const first = makeMessenger();
    await enqueue();
    await runPendingAnnouncements(first);
    expect(callsTo(first, telegramId)).toHaveLength(1);

    // Act — the same notes, queued and sent again.
    const second = makeMessenger();
    await enqueue();
    await runPendingAnnouncements(second);

    // Assert — nothing reached that chat again.
    expect(callsTo(second, telegramId)).toHaveLength(0);
    expect(await wasDelivered(userId, FIRST)).toBe(true);
  });

  it("keeps a refused message pending instead of recording it as read", async () => {
    // Arrange
    const { userId } = await seedTester("en");
    const messenger = { sendMessage: vi.fn(() => Promise.reject(new Error("bot was blocked by the user"))) };
    const job = await enqueue();

    // Act
    await runPendingAnnouncements(messenger);

    // Assert — the job is finished (never stuck claimed), but nothing is on file
    // for the reader, so the next send tries again.
    expect(await wasDelivered(userId, FIRST)).toBe(false);
    expect(await jobById(job.id)).toMatchObject({ status: "sent", result: { delivered: 0, failed: 1 } });
  });

  it("claims a job once, so two ticks never send the same announcement twice", async () => {
    // Arrange
    const { telegramId } = await seedTester("en");
    const messenger = makeMessenger();
    await enqueue();

    // Act — two ticks overlapping, as a slow send and the next interval would.
    await Promise.all([runPendingAnnouncements(messenger), runPendingAnnouncements(messenger)]);

    // Assert
    expect(callsTo(messenger, telegramId)).toHaveLength(1);
  });
});
