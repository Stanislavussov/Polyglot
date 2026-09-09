/**
 * Mentor chat persistence — durable threads behind the reply-continuation UX.
 *
 * Telegram gives a bot only one reply level, so continuing "that topic" from a
 * reply requires our own (chatId, telegramMessageId) → threadId mapping; the
 * same rows feed the phase-2 topic summaries.
 */

export interface MentorTurnRecord {
  userId: number;
  chatId: number;
  threadId: string;
  role: "user" | "assistant";
  content: string;
  telegramMessageId: number;
  interfaceLang?: string;
}

export interface MentorHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface MentorMessageRepository {
  record(msg: MentorTurnRecord): Promise<void>;
  /** threadId of OUR message with this telegram id in this chat, else null. */
  findThreadByMessage(chatId: number, telegramMessageId: number): Promise<string | null>;
  /** Last `limit` messages of the thread, in chronological order. */
  getRecentMessages(threadId: string, limit: number): Promise<MentorHistoryMessage[]>;
  /** Most recent threadId for a chat (session-loss recovery), else null. */
  findLatestThreadId(chatId: number): Promise<string | null>;
}
