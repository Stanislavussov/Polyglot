import { type ConversationFlavor } from "@grammyjs/conversations";
import type { User } from "@polyglot/adapter-db";
import type { DictionaryWordConfig, InputType, TemplateFields, TranslateOutput, WordDisplayData } from "@polyglot/core";
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
   * Flag indicating the user should see a non-blocking source-language
   * reminder menu on their next text message in translate mode (Task 36).
   * Set to true after commands that leave translate flow (/start, /template, etc.).
   * Defaults to true on fresh session (after restart → first msg shows menu).
   * Cleared after the reminder is shown once.
   */
  needsTranslateReminder?: boolean;
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
  /**
   * Dictionary browse state (Task 40).
   * Active during a dictionary browsing session.
   * Cleared on close or session loss.
   */
  dictionary?: {
    /** Current page (1-based) */
    currentPage: number;
    /** Message ID of the dictionary message (for in-place editing) */
    msgId?: number;
  };
  /**
   * Flash card session state (Task 33).
   * Active during a flashcard session. Cleared on quit/close or session loss.
   */
  flashcard?: {
    /** Words in the deck (from pipeline), stored for rendering without re-fetch */
    deck: WordDisplayData[];
    /** Current position in deck (0-based index) */
    currentIndex: number;
    /** Message ID of the current card message (for in-place editing) */
    cardMsgId?: number;
    /** Config used to generate this deck */
    config: DictionaryWordConfig;
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
