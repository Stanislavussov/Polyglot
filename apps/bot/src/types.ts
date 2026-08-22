import { type ConversationFlavor } from "@grammyjs/conversations";
import type {
  DictionaryWordConfig,
  InputType,
  ServiceContainer,
  SrsDueVocabularyCard,
  TemplateFields,
  TranslateOutput,
  User,
  UserLanguageSettings,
  WordDisplayData,
} from "@polyglot/core";
import { Context, SessionFlavor } from "grammy";

/**
 * Canonical list of bot modes — the single source of truth.
 * Both the {@link UserMode} union and every runtime `VALID_MODES` set are
 * derived from this array, so a newly added mode cannot be silently omitted
 * from session validation (adding one here updates the type and all guards).
 */
export const USER_MODES = ["idle", "translate", "mentor"] as const;

/**
 * Active mode for the bot — determines how plain text messages are routed.
 * Persisted in DB (userLanguageSettings.activeMode) to survive bot restarts.
 * Derived from {@link USER_MODES}; add new modes there.
 */
export type UserMode = (typeof USER_MODES)[number];

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
   * Explicit source language override for the next translation (Task 17).
   * Vestigial: the simplified detection of Task 58 stopped consulting it, and
   * no production path reads it today; both remaining writes set it to null
   * (the initial session, and onboarding handing over to translate mode). It
   * stays in the shape for backward compatibility with already-persisted
   * session rows, where it lives in `bot_sessions.data` like every other field.
   */
  nextSourceLang?: string | null;
  /**
   * Per-message translation entry — allows multiple translation messages
   * to coexist without overwriting each other's state.
   * Keyed by message ID in the translationMap.
   */
  translationMap?: Record<
    string,
    {
      output: TranslateOutput;
      inputType: InputType;
      contextHint?: string;
      savedWordId?: number;
      /** Accumulated negative constraints for "Other meaning" button */
      previousTranslations?: Record<string, string[]>;
      /** Cached on-demand grammar breakdown (langCode → items) */
      grammarBreakdown?: Record<string, string[]>;
      /** Cached on-demand etymology prose for the original term */
      etymology?: string;
      /**
       * Monotonic insertion stamp used for recency-based eviction. Set by
       * {@link setTranslationEntry}; Telegram message ids are not a safe proxy
       * for recency (a chat or a different bot sharing this session key can
       * restart ids at low numbers). Older/legacy entries lacking this field
       * are treated as oldest and evicted first.
       */
      addedAt?: number;
    }
  >;
  /**
   * Last translation output — stored for regen (both words and sentences).
   * Separate from pendingTranslation which is for Save/Skip only.
   * @deprecated Use translationMap instead for per-message state.
   */
  lastTranslation?: TranslateOutput;
  /**
   * Input type of the last translation — determines which preset/keyboard
   * to use on regeneration. When 'sentence', uses SENTENCE_OUTPUT + regen-only keyboard.
   * @deprecated Use translationMap instead for per-message state.
   */
  lastInputType?: InputType;
  /**
   * DB id of the word entry saved in this session.
   * Set after a successful tr:save — enables regen handler to call
   * updateContent() instead of silently ignoring the regen update.
   * Cleared when a new translation is started.
   * @deprecated Use translationMap instead for per-message state.
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
   * Version of the persistent main-menu reply keyboard this chat has received.
   * `undefined` means the keyboard was never sent, so `mainKeyboardMiddleware`
   * delivers it with a one-time hint. Compared against MAIN_KEYBOARD_VERSION.
   */
  mainKeyboardVersion?: number;
  /**
   * Message id that delivered the main-menu keyboard. Telegram binds a reply
   * keyboard to its carrier message, so deleting that message wipes the keyboard
   * off the user's screen — `cleanupTechnicalMessages` uses this to re-arm
   * delivery if the carrier is ever deleted.
   */
  mainKeyboardMessageId?: number;
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
    /** Active dictionary being browsed */
    dictionaryId?: number;
    /** Message ID of the dictionary message (for in-place editing) */
    msgId?: number;
  };
  /** Pending dictionary create/rename text input. */
  dictionaryWizard?: {
    action: "create" | "rename";
    dictionaryId?: number;
    msgId?: number;
  };
  /**
   * Language detection pre-request state (Task 58).
   * Set when input language cannot be detected from learningLangs.
   * undefined = mistype flow active.
   * Cleared on confirm/cancel.
   */
  pendingDetectedLang?: string | undefined;
  /** Pending word awaiting mistype confirmation */
  pendingWord?: string;
  /** Pending context hint awaiting mistype confirmation */
  pendingContextHint?: string;
  /** Pending direction for mistype flow */
  pendingDirection?: {
    sourceLang: string;
    targetLangs: string[];
  };
  /** Pending translation clarification after core returns needs_clarification. */
  pendingClarification?: {
    word: string;
    contextHint?: string;
    sourceLang: string;
    targetLangs: string[];
    inputType: InputType;
    reason: string;
    options?: Array<{
      id?: string;
      // Optional: core omits the label for options the channel labels from
      // `kind` (e.g. translate_as_written) — Fable T23/A13.
      label?: string;
      value: string;
      kind?: string;
      langCode?: string;
      correctedText?: string;
    }>;
  };
  /**
   * Pending out-of-set add-and-translate prompts, keyed by the prompt's
   * Telegram message id (mirrors {@link SessionData.translationMap}). The user
   * typed text in a SUPPORTED language they don't study yet; each entry carries
   * its own word across the tr:oos:add / tr:oos:once / tr:oos:cancel callback
   * tap. Keying by message id means two consecutive prompts cannot cross-wire
   * language and word, and a used/stale button resolves to its own entry only.
   */
  pendingOutOfSet?: Record<
    string,
    {
      lang: string;
      word: string;
      contextHint?: string;
      /** Monotonic insertion stamp used for recency-based eviction. */
      addedAt?: number;
    }
  >;
  /**
   * Pending "🔄 Try again" actions, keyed by the message id of the timeout
   * notice that carries the button (mirrors {@link SessionData.translationMap}).
   * A timeout notice cannot carry its input in `callback_data` (64-byte cap), so
   * the payload lives here; entries are one-shot and capped by
   * `setRetryAction`. An entry lost to a restart or eviction resolves to the
   * usual "session expired" guard.
   */
  pendingRetries?: Record<
    string,
    {
      /** Which flow to re-run: the translate text flow or a mentor turn. */
      kind: "translate" | "mentor";
      /** The original user input, verbatim as the flow's entry point takes it. */
      text: string;
      /** Monotonic insertion stamp used for recency-based eviction. */
      addedAt?: number;
    }
  >;
  /** True when the next text message should be used as translation context clarification. */
  awaitingTranslationClarificationContext?: boolean;
  /** Message ID of the translation card awaiting post-translation clarification context. */
  pendingPostTranslationClarifyMsgId?: number;
  /**
   * Flag indicating the bot is awaiting notification context text input.
   * Set when user taps "set:notif:context" in settings.
   * Cleared after context is saved or cancelled.
   */
  awaitingNotifContext?: boolean;
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
  /**
   * SRS review session state.
   * Stores due translation rows so each target language is reviewed independently.
   */
  srs?: {
    deck: SrsDueVocabularyCard[];
    currentIndex: number;
    cardMsgId?: number;
  };
  /**
   * Mentor mode conversation history (Task 66).
   * Stores the chat messages between user and AI mentor. Persisted with the
   * rest of the session: the storage adapter writes the whole payload to
   * `bot_sessions.data`, so these turns outlive a bot restart. They are
   * bounded by the `MAX_MENTOR_HISTORY` cap applied on every turn, the reset
   * on each /mentor entry, and the retention sweep that drops sessions left
   * idle past the horizon.
   */
  mentor?: {
    history: Array<{ role: "user" | "assistant"; content: string }>;
  };
  /**
   * Technical message IDs to delete after scene ends or settings change.
   * Translation cards and user words are never added here.
   */
  technicalMessages?: number[];
}

/** Custom context properties injected by auth middleware */
export interface CustomContextProps {
  user: User & { settings?: UserLanguageSettings | null };
  services: ServiceContainer;
  /**
   * Request-scoped memo of the user's settings, populated lazily by
   * {@link getRequestSettings} (middlewares/request-settings.ts). Lives for one
   * Telegram update only. Read it through that helper, never directly — and
   * never via `ctx.user.settings`, which is always `undefined`.
   */
  settingsMemo?: { userId: number; promise: Promise<UserLanguageSettings | null> };
  /**
   * Names of the handlers that consumed this update, in order. Populated by
   * `withHandlerLog`/`markHandled` (observability/handler-log.ts) and reported
   * on the closing `update.finished` record; an empty chain means no route
   * matched, which is logged as `update.unhandled`.
   */
  handledBy?: string[];
}

/** Context type used in the outside middleware tree (has ConversationFlavor + Session) */
export type BotContext = Context & ConversationFlavor<Context> & SessionFlavor<SessionData> & CustomContextProps;

/** Context type used inside conversations (has Session + CustomContextProps from authMiddleware) */
export type ConversationContext = Context & SessionFlavor<SessionData> & CustomContextProps;
