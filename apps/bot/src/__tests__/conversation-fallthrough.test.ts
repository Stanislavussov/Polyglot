/**
 * Regression tests for the 2026-07-06 "bot went silent" incident.
 *
 * Spec: an active conversation (onboarding / report-issue) must never
 * silently swallow updates its wait predicate rejects.
 *  - Plain text sent mid-dialog falls through to downstream middleware
 *    (mode-router) and produces a visible reply.
 *  - Commands sent mid-dialog fall through, exit the stale conversation
 *    (exitActiveConversations) and execute normally.
 *  - Updates the dialog *does* expect still advance it.
 *
 * Mechanism under test: every `conversation.waitUntil` must pass
 * `next: true`. Without it, @grammyjs/conversations v2 resolves a
 * predicate-miss as `skip()` → `cancel("drop")`: the update is destroyed
 * before command handlers or mode-router ever see it. Conversation state
 * is in-memory, so in prod an abandoned dialog kept eating every message
 * AND every command in that chat until the next deploy restarted the bot.
 *
 * These tests drive the REAL bot (createPolyglotBot + real conversations
 * plugin) via bot.handleUpdate with a stubbed Telegram API, because the
 * drop happens inside the plugin engine — unit tests that mock
 * `conversation.waitUntil` cannot observe it.
 */
import { t } from "@polyglot/core";
import type { Update, UserFromGetMe } from "grammy/types";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { createPolyglotBot } from "../bot-factory.js";
import { createServicesStub } from "../test-helpers/services-stub.js";

vi.mock("@polyglot/infra", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

/**
 * Stub the Telegram transport itself, injected via the factory's `fetch` test
 * seam. A bot.api transformer is NOT enough: the conversations plugin builds
 * fresh Api instances for conversation contexts (inheriting client options but
 * not transformers), so only the transport layer catches every call.
 */
const apiLog: { method: string; payload: Record<string, unknown> }[] = [];

function fetchStub(url: unknown, options?: { body?: unknown }) {
  const method = String(url).split("/").pop() ?? "";
  const payload = typeof options?.body === "string" ? (JSON.parse(options.body) as Record<string, unknown>) : {};
  apiLog.push({ method, payload });
  let result: unknown = true;
  if (method === "sendMessage") {
    result = {
      message_id: 1000 + apiLog.length,
      date: 1,
      chat: { id: payload.chat_id, type: "private" },
      text: payload.text,
    };
  }
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, result }) });
}

const CHAT_ID = 777;
const TG_USER = { id: CHAT_ID, is_bot: false, first_name: "Test" } as const;

const BOT_INFO: UserFromGetMe = {
  id: 42,
  is_bot: true,
  first_name: "PolyTest",
  username: "polytest_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
};

const FAKE_USER = {
  id: 1,
  telegramId: CHAT_ID,
  username: null,
  audienceGroup: "product",
  subscriptionPlan: "free",
  onboardingStep: 4,
  onboarded: true,
  isActive: true,
  createdAt: new Date(0),
};

const FAKE_SETTINGS = {
  interfaceLang: "en",
  nativeLang: "ru",
  learningLangs: ["en"],
  activeMode: "translate",
  lastSourceLang: null,
};

let updateId = 0;
let msgId = 100;

function commandUpdate(cmd: string): Update {
  return {
    update_id: ++updateId,
    message: {
      message_id: ++msgId,
      date: 1,
      chat: { id: CHAT_ID, type: "private", first_name: "Test" },
      from: { ...TG_USER },
      text: cmd,
      entities: [{ type: "bot_command", offset: 0, length: cmd.length }],
    },
  };
}

function textUpdate(text: string): Update {
  return {
    update_id: ++updateId,
    message: {
      message_id: ++msgId,
      date: 1,
      chat: { id: CHAT_ID, type: "private", first_name: "Test" },
      from: { ...TG_USER },
      text,
    },
  };
}

function callbackUpdate(data: string): Update {
  return {
    update_id: ++updateId,
    callback_query: {
      id: String(++msgId),
      from: { ...TG_USER },
      chat_instance: "test-chat-instance",
      data,
      message: {
        message_id: ++msgId,
        date: 1,
        chat: { id: CHAT_ID, type: "private", first_name: "Test" },
        from: { ...BOT_INFO },
        text: "keyboard message",
      },
    },
  };
}

function setup() {
  const services = createServicesStub();
  const userRepo = services.userRepository as unknown as Record<string, Mock>;
  const identityRepo = services.identityRepository as unknown as Record<string, Mock>;
  const langCache = services.languageCache as unknown as Record<string, Mock>;

  identityRepo.resolveUserId.mockResolvedValue(FAKE_USER.id);
  userRepo.findById.mockResolvedValue(FAKE_USER);
  userRepo.getSettings.mockResolvedValue(FAKE_SETTINGS);
  userRepo.updateLastInteraction.mockResolvedValue(undefined);
  userRepo.updateActiveMode.mockResolvedValue(undefined);
  langCache.getLangDisplay.mockImplementation((code: string) => code);

  const bot = createPolyglotBot({
    token: "42:TEST",
    services,
    fetch: fetchStub as unknown as NonNullable<Parameters<typeof createPolyglotBot>[0]["fetch"]>,
  });
  bot.botInfo = BOT_INFO;

  const sendMessageTexts = () => apiLog.filter((c) => c.method === "sendMessage").map((c) => c.payload.text as string);

  return { bot, sendMessageTexts };
}

describe("active conversation must not swallow unmatched updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiLog.length = 0;
  });

  it("plain text during the report dialog falls through to mode-router and gets a reply", async () => {
    const { bot, sendMessageTexts } = setup();

    await bot.handleUpdate(commandUpdate("/report"));
    const opened = sendMessageTexts();
    expect(opened).toContain(t("reportChooseType", "en")); // dialog is really active

    // Emoji-only text: rejected by the dialog's wait predicate; must reach
    // mode-router, which replies "emoji not supported" for onboarded users.
    await bot.handleUpdate(textUpdate("😀😀"));

    expect(sendMessageTexts().slice(opened.length)).toContain(t("emojiNotSupported", "en"));
  });

  it("a command during the report dialog exits it and executes", async () => {
    const { bot, sendMessageTexts } = setup();

    await bot.handleUpdate(commandUpdate("/report"));
    const opened = sendMessageTexts().length;

    await bot.handleUpdate(commandUpdate("/translate"));

    const after = sendMessageTexts().slice(opened);
    expect(after).toContain(t("translateModeOn", "en", { fromLang: "ru", toLangs: "en" }));
  });

  it("an update the dialog expects still advances it", async () => {
    const { bot, sendMessageTexts } = setup();

    await bot.handleUpdate(commandUpdate("/report"));
    await bot.handleUpdate(callbackUpdate("report:type:bug"));

    // Step 1 consumed the callback and step 2 prompted for a description.
    expect(apiLog.some((c) => c.method === "answerCallbackQuery")).toBe(true);
    expect(sendMessageTexts()).toContain(t("reportEnterDescription", "en"));
  });

  it("an abandoned dialog self-destructs after the wait timeout instead of capturing the chat forever", async () => {
    // Fake only Date (not setTimeout — the api throttler needs live timers).
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const { bot, sendMessageTexts } = setup();

      await bot.handleUpdate(commandUpdate("/report"));
      const opened = sendMessageTexts().length;

      // Abandon the dialog for longer than the conversation wait timeout.
      vi.setSystemTime(new Date("2026-01-01T00:31:00Z"));

      // Even the update the dialog was waiting for must NOT advance it now:
      // the stale conversation halts (with fall-through) instead of resuming.
      await bot.handleUpdate(callbackUpdate("report:type:bug"));
      expect(sendMessageTexts().slice(opened)).not.toContain(t("reportEnterDescription", "en"));

      // The chat is fully usable again: plain text reaches mode-router.
      await bot.handleUpdate(textUpdate("😀😀"));
      expect(sendMessageTexts().slice(opened)).toContain(t("emojiNotSupported", "en"));
    } finally {
      vi.useRealTimers();
    }
  });
});
