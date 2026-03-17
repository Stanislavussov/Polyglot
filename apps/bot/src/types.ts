import { Context, SessionFlavor } from "grammy";
import { type ConversationFlavor } from "@grammyjs/conversations";
import type { User } from "@polyglot/adapter-db";
import type { TranslateOutput } from "@polyglot/core";

/**
 * Active mode for the bot — determines how plain text messages are routed.
 * Extensible: add new modes like "mentor" in the future.
 */
export type UserMode = "idle" | "translate";

/**
 * Session data stored per-user.
 * Persists the active mode and any in-progress translation state.
 */
export interface SessionData {
  /** Current active mode */
  activeMode: UserMode;
  /** Pending translation output (for Save/Skip handling) */
  pendingTranslation?: TranslateOutput;
  /** Message ID of the card showing the pending translation */
  pendingCardMsgId?: number;
}

/** Custom context properties injected by auth middleware */
export interface CustomContextProps {
  user: User;
}

/** Context type used in the outside middleware tree (has ConversationFlavor + Session) */
export type BotContext = Context &
  ConversationFlavor<Context> &
  SessionFlavor<SessionData> &
  CustomContextProps;

/** Context type used inside conversations (no ConversationFlavor, but has Session) */
export type ConversationContext = Context &
  SessionFlavor<SessionData> &
  CustomContextProps;
