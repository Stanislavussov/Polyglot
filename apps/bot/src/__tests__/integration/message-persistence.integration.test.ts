/**
 * Message persistence — grammY e2e integration test.
 *
 * The bot used to sweep its own "technical" messages: every new user message
 * deleted the previous interaction's menus, prompts and notices. It cost the user
 * their history, and every sweep raced Telegram's own rules ("message to delete
 * not found", a menu vanishing under a finger). The rule now is that the bot
 * deletes exactly one thing — the rotating "translating…" placeholder it replaces
 * with the card — and nothing else. That is an invariant across the dispatcher, the
 * handlers and the Postgres-backed session, so it is proved end-to-end here.
 */
import { allLoaderPhraseKeys, t } from "@polyglot/core";
import { describe, expect, it } from "vitest";
import { arrangeOnboardedTranslator } from "../../test-helpers/integration/arrange.js";
import { type CapturedCall, createBotHarness, messageUpdate } from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../test-helpers/integration/translate-ai-mock.js";

/** Every phrase the translate loader may open on or rotate to. */
const LOADER_TEXTS = new Set(allLoaderPhraseKeys("translate").map((key) => t(key, "en")));

/** Ids of the loading placeholders the flow sent — the only deletable messages. */
function loadingPlaceholderIds(sent: CapturedCall[]): number[] {
  return sent
    .filter((call) => call.method === "sendMessage" && LOADER_TEXTS.has(call.payload.text as string))
    .map((call) => call.messageId ?? -1);
}

/** Ids of every other message the bot sent — cards, notices, menus. */
function keptMessageIds(sent: CapturedCall[]): number[] {
  const placeholders = new Set(loadingPlaceholderIds(sent));
  return sent
    .filter((call) => call.method === "sendMessage")
    .map((call) => call.messageId ?? -1)
    .filter((id) => !placeholders.has(id));
}

function deletedMessageIds(sent: CapturedCall[]): number[] {
  return sent
    .filter((call) => call.method === "deleteMessage")
    .map((call) => Number((call.payload as { message_id?: number }).message_id));
}

describe("message persistence (integration)", () => {
  it("deletes only the loading placeholder while the user goes on translating", async () => {
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();
    await arrangeOnboardedTranslator(id);

    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "hello" }));
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "world", messageId: 2 }));

    const placeholders = loadingPlaceholderIds(harness.sent);
    expect(placeholders).toHaveLength(2);
    expect(deletedMessageIds(harness.sent).sort()).toEqual([...placeholders].sort());
  });

  it("leaves no loader ticker running once the card has replaced the placeholder", async () => {
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();
    await arrangeOnboardedTranslator(id);

    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "hello" }));

    // A translation that beats the first tick must never edit its placeholder —
    // an edit here would mean the rotation outlived the message it rewrites.
    const placeholders = new Set(loadingPlaceholderIds(harness.sent));
    const editedIds = harness.sent
      .filter((call) => call.method === "editMessageText")
      .map((call) => Number((call.payload as { message_id?: number }).message_id));
    for (const editedId of editedIds) {
      expect(placeholders.has(editedId)).toBe(false);
    }
  });

  it("leaves a rejection notice on screen when the next word is translated", async () => {
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();
    await arrangeOnboardedTranslator(id);

    // An emoji-only message cannot be translated: the bot answers with a notice,
    // which used to be swept away by the very next message.
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "🙂" }));
    const noticeIds = keptMessageIds(harness.sent);
    expect(noticeIds.length).toBeGreaterThan(0);

    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "hello", messageId: 2 }));

    const deleted = deletedMessageIds(harness.sent);
    for (const noticeId of noticeIds) {
      expect(deleted).not.toContain(noticeId);
    }
    for (const keptId of keptMessageIds(harness.sent)) {
      expect(deleted).not.toContain(keptId);
    }
  });
});
