/**
 * grammY e2e harness for the integration lane (Task 71, Phases 4–5).
 *
 * Builds the REAL bot through `createPolyglotBot` with the REAL Postgres session
 * storage and the REAL DI container — only the AI boundary is swapped for a
 * deterministic mock (via the `services` override, NOT `vi.mock`). Every outbound
 * Telegram call is intercepted at the HTTP layer by a fake `fetch` passed through
 * the factory's client options; it records the call and returns a plausible fake
 * response, so no network is touched and message ids are deterministic.
 *
 * Fetch-level (not api-transformer-level) interception is load-bearing: the
 * conversations plugin runs conversation builders against a CLONED Api built from
 * the bot's client options, which never sees transformers installed on
 * `bot.api.config` after the factory returns — a transformer-based mock lets
 * in-conversation replies (e.g. the onboarding prompts) escape to the real
 * Telegram API. The custom fetch applies to every Api instance the bot creates.
 *
 * `bot.botInfo` is preset so `bot.init()` (a getMe call) is unnecessary.
 *
 * The session key is `ctx.chat.id` (grammY default — see bot-factory.ts), so a
 * message and a follow-up callback that must share session state (e.g. a card and
 * its button) MUST use the same `chatId`, and the callback's
 * `message.message_id` must equal the id the harness assigned to the card's
 * `sendMessage`.
 */
import type { AIPort, ServiceContainer, SettingsPort } from "@polyglot/core";
import type { Bot } from "grammy";
import type { Message, MessageEntity, Update } from "grammy/types";
import { createPolyglotBot } from "../../bot-factory.js";
import { createContainer } from "../../container.js";
import { createPostgresSessionStorage } from "../../session-storage.js";
import type { BotContext } from "../../types.js";

/** One intercepted outbound Telegram API call. */
export interface CapturedCall {
  method: string;
  payload: Record<string, unknown>;
  /** The message id the harness assigned, for `sendMessage`/`copyMessage` results. */
  messageId?: number;
  /**
   * True when the request body was multipart rather than JSON — i.e. the bot
   * uploaded bytes instead of re-sending an existing `file_id`. This is how a test
   * tells a cache miss (upload) from a cache hit (file_id in a JSON payload).
   */
  isUpload?: boolean;
}

export interface HarnessOptions {
  /** Deterministic AI overrides merged over throwing defaults (e.g. generateObject/generateText). */
  ai?: Partial<AIPort>;
  /**
   * Settings overrides merged over the REAL DB-backed adapter.
   *
   * Use this rather than writing a `system_settings` row: that table is global and
   * this lane runs two workers against one database, so a test that flips a global
   * switch changes what every concurrently running test sees.
   */
  settings?: Partial<SettingsPort>;
}

export interface BotHarness {
  bot: Bot<BotContext>;
  services: ServiceContainer;
  /** Every intercepted outbound call, in order. */
  sent: CapturedCall[];
  /** Drive one update through the real dispatch pipeline. */
  dispatch(update: Update): Promise<void>;
  /**
   * When set, the next `editMessageText` call fails as a Telegram
   * "message to edit not found" GrammyError (the 48h edit-limit case). Auto-resets
   * after firing once.
   */
  failNextEdit(): void;
  /**
   * When set, the next `sendMessage` call fails with the given Telegram error.
   * Auto-resets after firing once. Use `error_code: 403` to exercise the
   * "user blocked the bot" path, which the scheduler treats as permanent.
   */
  failNextSend(error: { error_code: number; description: string }): void;
  /**
   * When set, the next `sendVoice` fails as a Telegram "wrong file identifier"
   * error — the stale-`file_id` case the pronunciation cache heals from.
   * Auto-resets after firing once.
   */
  failNextVoice(): void;
  /** Clear the captured-call buffer. */
  reset(): void;
}

const BOT_INFO = {
  id: 424242,
  is_bot: true as const,
  first_name: "PolyglotTestBot",
  username: "polyglot_test_bot",
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
};

function rejectingAi(): AIPort {
  const unconfigured = (method: string) => async (): Promise<never> => {
    throw new Error(`bot-harness: services.ai.${method} was called but no deterministic mock was provided`);
  };
  return {
    generateObject: unconfigured("generateObject"),
    generateText: unconfigured("generateText"),
    generateChat: unconfigured("generateChat"),
    generateSpeech: unconfigured("generateSpeech"),
  };
}

/** Parse a Telegram Bot API request into its method name and JSON payload. */
async function parseApiRequest(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<[string, Record<string, unknown>, boolean]> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = url.split("/").at(-1) ?? "";
  let rawBody: string | undefined;
  // A body grammY did not hand us as a string is a multipart upload (`sendVoice`
  // with an InputFile). The fields are not worth parsing, but *that* it was an
  // upload is: it distinguishes freshly synthesized audio from a re-sent `file_id`.
  let isUpload = false;
  if (init?.body !== undefined && init.body !== null) {
    if (typeof init.body === "string") {
      rawBody = init.body;
    } else {
      isUpload = true;
    }
  } else if (input instanceof Request) {
    rawBody = await input.text();
  }
  if (!rawBody) return [method, {}, isUpload];
  try {
    return [method, JSON.parse(rawBody) as Record<string, unknown>, false];
  } catch {
    return [method, {}, true];
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export function createBotHarness(options: HarnessOptions = {}): BotHarness {
  const sent: CapturedCall[] = [];
  let messageIdSeq = 1000;
  let editShouldFail = false;
  let voiceShouldFail = false;
  let sendFailure: { error_code: number; description: string } | null = null;

  const services = createContainer();
  services.ai = { ...rejectingAi(), ...options.ai };
  if (options.settings) {
    // `services.settings` is a SettingsService INSTANCE — spreading it would keep
    // only own fields and drop every prototype method, so the first unmocked call
    // (e.g. getDefaultAIModelForPlan) would fail as "not a function". Deriving from
    // it instead leaves the real implementation reachable through the prototype
    // chain, with the overrides as own properties on top.
    services.settings = Object.assign(Object.create(services.settings) as SettingsPort, options.settings);
  }

  const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const [method, payload, isUpload] = await parseApiRequest(input, init);
    const record: CapturedCall = { method, payload, ...(isUpload ? { isUpload } : {}) };

    if (method === "editMessageText" && editShouldFail) {
      editShouldFail = false;
      sent.push(record);
      // Return an error response (do NOT throw) so grammY raises a GrammyError
      // whose `.description` the edit-message helper matches for its reply fallback.
      return jsonResponse({
        ok: false,
        error_code: 400,
        description: "Bad Request: message to edit not found",
      });
    }

    if (method === "sendMessage" && sendFailure) {
      const failure = sendFailure;
      sendFailure = null;
      // The attempt still goes in the ledger — a test asserting "exactly one send
      // attempt, not a retry storm" has to be able to count it. Same shape as the
      // edit failure above: an error *response*, never a throw, so grammY raises a
      // real GrammyError that `isUserBlocked` can classify.
      sent.push(record);
      return jsonResponse({ ok: false, ...failure });
    }

    if (method === "sendVoice" && voiceShouldFail) {
      voiceShouldFail = false;
      sent.push(record);
      // The shape Telegram returns for a `file_id` it no longer accepts — the
      // signal the pronunciation cache uses to evict and re-synthesize.
      return jsonResponse({
        ok: false,
        error_code: 400,
        description: "Bad Request: wrong file identifier/HTTP URL specified",
      });
    }

    let result: Message | boolean = true;
    if (method === "sendVoice") {
      const messageId = ++messageIdSeq;
      record.messageId = messageId;
      const chatId = Number((payload as { chat_id?: number | string }).chat_id);
      result = {
        message_id: messageId,
        date: 0,
        chat: { id: chatId, type: "private", first_name: "Test" },
        from: BOT_INFO,
        // A distinct id per send, so a test can tell a re-sent cached file from a
        // freshly uploaded one.
        voice: { file_id: `voice-file-${messageId}`, file_unique_id: `u${messageId}`, duration: 1 },
      };
    } else if (method === "sendMessage") {
      const messageId = ++messageIdSeq;
      record.messageId = messageId;
      const chatId = Number((payload as { chat_id?: number | string }).chat_id);
      result = {
        message_id: messageId,
        date: 0,
        chat: { id: chatId, type: "private", first_name: "Test" },
        from: BOT_INFO,
        text: String((payload as { text?: string }).text ?? ""),
      };
    }

    sent.push(record);
    return jsonResponse({ ok: true, result });
  };

  const bot = createPolyglotBot({
    token: "TEST:INTEGRATION",
    services,
    sessionStorage: createPostgresSessionStorage(),
    fetch: fakeFetch as typeof fetch,
  });
  bot.botInfo = BOT_INFO;

  return {
    bot,
    services,
    sent,
    dispatch: (update) => bot.handleUpdate(update),
    failNextEdit: () => {
      editShouldFail = true;
    },
    failNextSend: (error) => {
      sendFailure = error;
    },
    failNextVoice: () => {
      voiceShouldFail = true;
    },
    reset: () => {
      sent.length = 0;
    },
  };
}

let updateSeq = 0;

/**
 * Build a plain private-chat text-message update. A leading `/command` gets the
 * `bot_command` entity Telegram would attach — grammY's `bot.command()` matches
 * on that entity, not on the raw text.
 */
export function messageUpdate(opts: {
  chatId: number;
  fromId: number;
  text: string;
  messageId?: number;
  /** Telegram client locale (`from.language_code`) — onboarding guesses the native language from it. */
  languageCode?: string;
}): Update {
  const command = /^\/[a-zA-Z0-9_]+/.exec(opts.text);
  const entities: MessageEntity[] | undefined = command
    ? [{ type: "bot_command", offset: 0, length: command[0].length }]
    : undefined;
  return {
    update_id: ++updateSeq,
    message: {
      message_id: opts.messageId ?? 1,
      date: 0,
      chat: { id: opts.chatId, type: "private", first_name: "Test" },
      from: {
        id: opts.fromId,
        is_bot: false,
        first_name: "Test",
        ...(opts.languageCode ? { language_code: opts.languageCode } : {}),
      },
      text: opts.text,
      ...(entities ? { entities } : {}),
    },
  };
}

/**
 * Resolve the most recently rendered translation card from captured calls.
 *
 * The card is sent as text (`sendMessage`) and its inline keyboard is attached in
 * a SEPARATE `editMessageReplyMarkup` call (see translate-flow.ts). Both the
 * card's message id and its buttons therefore come from that edit call — which is
 * also robust to any trailing `sendMessage` (e.g. a translate reminder).
 */
export function lastRenderedCard(sent: CapturedCall[]): { messageId: number; buttons: string[] } {
  const edit = sent.filter((call) => call.method === "editMessageReplyMarkup").at(-1);
  if (!edit) throw new Error("no translation card was rendered (no editMessageReplyMarkup captured)");
  const messageId = Number((edit.payload as { message_id?: number }).message_id);
  const markup = edit.payload.reply_markup as
    | { inline_keyboard?: Array<Array<{ callback_data?: string }>> }
    | undefined;
  const buttons = (markup?.inline_keyboard ?? [])
    .flat()
    .map((button) => button.callback_data)
    .filter((data): data is string => typeof data === "string");
  return { messageId, buttons };
}

/** Build a callback-query update on an inline button of a prior bot message. */
export function callbackQueryUpdate(opts: {
  chatId: number;
  fromId: number;
  messageId: number;
  data: string;
  /** Telegram client locale (`from.language_code`). */
  languageCode?: string;
}): Update {
  return {
    update_id: ++updateSeq,
    callback_query: {
      id: `cb-${updateSeq}`,
      from: {
        id: opts.fromId,
        is_bot: false,
        first_name: "Test",
        ...(opts.languageCode ? { language_code: opts.languageCode } : {}),
      },
      chat_instance: `ci-${updateSeq}`,
      data: opts.data,
      message: {
        message_id: opts.messageId,
        date: 0,
        chat: { id: opts.chatId, type: "private", first_name: "Test" },
        from: BOT_INFO,
        text: "card",
      },
    },
  };
}
