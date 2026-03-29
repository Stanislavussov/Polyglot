import { type ConversationFlavor } from "@grammyjs/conversations";
import type { User } from "@polyglot/adapter-db";
import type { InputType, TemplateFields, TranslateOutput } from "@polyglot/core";
import { Context, SessionFlavor } from "grammy";

/**
 * Active mode for the bot — determines how plain text messages are routed.
 * Persisted in DB (userLanguageSettings.activeMode) to survive bot restarts.
 * Extensible: add "mentor" | "quiz" when those features land.
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
  /**
   * Explicit source language for the next translation (Task 17).
   * When set, skips auto-detection and uses this language as source.
   * null/undefined = auto-detect (default behavior via Task 16).
   * Session-only — does not persist across bot restarts.
   */
  nextSourceLang?: string | null;
  /**
   * Last translation output — stored for regen (both words and sentences).
   * Separate from pendingTranslation which is for Save/Skip only.
   */
  lastTranslation?: TranslateOutput;
  /**
   * Input type of the last translation — determines which preset/keyboard
   * to use on regeneration. When 'sentence', uses SENTENCE_OUTPUT + regen-only keyboard.
   */
  lastInputType?: InputType;
  /**
   * DB id of the word entry saved in this session.
   * Set after a successful tr:save — enables regen handler to call
   * updateContent() instead of silently ignoring the regen update.
   * Cleared when a new translation is started.
   */
  savedWordId?: number;
  /**
   * Template constructor wizard state (Task 32).
   * Set when user enters the template customization flow.
   * Cleared on save, cancel, or session loss.
   */
  templateWizard?: {
    /** Working copy of template fields being edited */
    fields: TemplateFields;
    /** Message ID of the wizard message (for in-place editing) */
    wizardMsgId?: number;
  };
}

/** Custom context properties injected by auth middleware */
export interface CustomContextProps {
  user: User;
}

/** Context type used in the outside middleware tree (has ConversationFlavor + Session) */
export type BotContext = Context & ConversationFlavor<Context> & SessionFlavor<SessionData> & CustomContextProps;

/** Context type used inside conversations (no ConversationFlavor, but has Session) */
export type ConversationContext = Context & SessionFlavor<SessionData> & CustomContextProps;
