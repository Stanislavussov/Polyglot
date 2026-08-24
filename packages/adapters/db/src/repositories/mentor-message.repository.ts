import type { MentorHistoryMessage, MentorMessageRepository, MentorTurnRecord } from "@polyglot/core";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../connection.js";
import { mentorMessages } from "../schema.js";

export const mentorMessageRepository: MentorMessageRepository = {
  async record(msg: MentorTurnRecord): Promise<void> {
    const db = getDb();
    await db.insert(mentorMessages).values({
      userId: msg.userId,
      chatId: msg.chatId,
      threadId: msg.threadId,
      role: msg.role,
      content: msg.content,
      telegramMessageId: msg.telegramMessageId,
      interfaceLang: msg.interfaceLang ?? null,
    });
  },

  async findThreadByMessage(chatId: number, telegramMessageId: number): Promise<string | null> {
    const db = getDb();
    const rows = await db
      .select({ threadId: mentorMessages.threadId })
      .from(mentorMessages)
      .where(and(eq(mentorMessages.chatId, chatId), eq(mentorMessages.telegramMessageId, telegramMessageId)))
      .limit(1);
    return rows[0]?.threadId ?? null;
  },

  async getRecentMessages(threadId: string, limit: number): Promise<MentorHistoryMessage[]> {
    const db = getDb();
    const rows = await db
      .select({ role: mentorMessages.role, content: mentorMessages.content })
      .from(mentorMessages)
      .where(eq(mentorMessages.threadId, threadId))
      .orderBy(desc(mentorMessages.id))
      .limit(limit);
    return rows.reverse();
  },

  async findLatestThreadId(chatId: number): Promise<string | null> {
    const db = getDb();
    const rows = await db
      .select({ threadId: mentorMessages.threadId })
      .from(mentorMessages)
      .where(eq(mentorMessages.chatId, chatId))
      .orderBy(desc(mentorMessages.id))
      .limit(1);
    return rows[0]?.threadId ?? null;
  },
};
