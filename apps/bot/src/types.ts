import { Context } from "grammy";
import { type ConversationFlavor } from "@grammyjs/conversations";
import type { User } from "@polyglot/adapter-db";

/** Custom context properties injected by auth middleware */
export interface CustomContextProps {
  user: User;
}

/** Context type used in the outside middleware tree (has ConversationFlavor) */
export type BotContext = Context &
  ConversationFlavor<Context> &
  CustomContextProps;

/** Context type used inside conversations (no ConversationFlavor) */
export type ConversationContext = Context & CustomContextProps;
