/**
 * Mentor-thread persistence — real-DB integration tests (Task 71 lane).
 *
 * The reply-continuation UX hangs entirely on these lookups: Telegram hands the
 * bot only ONE reply level, so "continue that topic" works iff our
 * (chat_id, telegram_message_id) → thread_id mapping answers correctly, and the
 * history window must come back chronological or the mentor reads the
 * conversation backwards. Chat ids are seeded from the collision-safe id
 * factory, so parallel workers cannot see each other's threads.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getDb } from "../connection.js";
import { mentorMessageRepository } from "../repositories/mentor-message.repository.js";
import { mentorMessages, users } from "../schema.js";
import { uniqueTelegramId } from "../test-helpers/integration/id-factory.js";

async function seedUser(): Promise<{ userId: number; chatId: number }> {
  const db = getDb();
  const telegramId = uniqueTelegramId();
  const [user] = await db
    .insert(users)
    .values({ telegramId, onboarded: true, onboardingStep: 4, isActive: true })
    .returning();
  return { userId: user!.id, chatId: telegramId };
}

async function recordTurn(
  ids: { userId: number; chatId: number },
  threadId: string,
  role: "user" | "assistant",
  content: string,
  telegramMessageId: number,
): Promise<void> {
  await mentorMessageRepository.record({ ...ids, threadId, role, content, telegramMessageId, interfaceLang: "en" });
}

describe("mentorMessageRepository", () => {
  it("maps an assistant message id back to its thread, scoped to the chat", async () => {
    const ids = await seedUser();
    const other = await seedUser();
    const threadId = randomUUID();
    await recordTurn(ids, threadId, "user", "how does Present Perfect work?", 100);
    await recordTurn(ids, threadId, "assistant", "It links past events to now...", 101);
    // Same telegram message id in ANOTHER chat must not leak across chats.
    await recordTurn(other, randomUUID(), "assistant", "unrelated", 101);

    expect(await mentorMessageRepository.findThreadByMessage(ids.chatId, 101)).toBe(threadId);
    expect(await mentorMessageRepository.findThreadByMessage(ids.chatId, 999)).toBeNull();
  });

  it("returns the last N messages of a thread in chronological order", async () => {
    const ids = await seedUser();
    const threadId = randomUUID();
    for (let turn = 0; turn < 3; turn++) {
      await recordTurn(ids, threadId, "user", `q${turn}`, 200 + turn * 2);
      await recordTurn(ids, threadId, "assistant", `a${turn}`, 201 + turn * 2);
    }

    const window = await mentorMessageRepository.getRecentMessages(threadId, 4);
    expect(window).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "a2" },
    ]);
  });

  it("returns an empty history for an unknown thread", async () => {
    expect(await mentorMessageRepository.getRecentMessages(randomUUID(), 20)).toEqual([]);
  });

  it("recovers the most recent thread of a chat after session loss", async () => {
    const ids = await seedUser();
    const first = randomUUID();
    const second = randomUUID();
    await recordTurn(ids, first, "user", "old topic", 300);
    await recordTurn(ids, second, "user", "new topic", 301);

    expect(await mentorMessageRepository.findLatestThreadId(ids.chatId)).toBe(second);
    expect(await mentorMessageRepository.findLatestThreadId(uniqueTelegramId())).toBeNull();
  });

  it("cascades away with the owning user", async () => {
    const ids = await seedUser();
    const threadId = randomUUID();
    await recordTurn(ids, threadId, "user", "to be erased", 400);

    const db = getDb();
    const { eq } = await import("drizzle-orm");
    await db.delete(users).where(eq(users.id, ids.userId));
    const rows = await db.select().from(mentorMessages).where(eq(mentorMessages.threadId, threadId));
    expect(rows).toEqual([]);
  });
});
