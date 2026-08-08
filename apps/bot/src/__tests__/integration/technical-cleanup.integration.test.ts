/**
 * Technical-message sweep — grammY e2e integration test.
 *
 * Every new user message clears the previous interaction's scaffolding before any
 * handler runs (`technicalCleanupMiddleware`). The rule that makes that safe is
 * that only `replyTechnical` writes to the ledger, so a translation card can never
 * enter it — but that is an invariant across a middleware, a handler and the
 * Postgres-backed session, which a mock-only test cannot prove. This drives real
 * updates through the real dispatcher and asserts both halves: notices go, cards
 * stay.
 */
import { botSessionRepository } from "@polyglot/adapter-db";
import { describe, expect, it } from "vitest";
import { arrangeOnboardedTranslator } from "../../test-helpers/integration/arrange.js";
import { type CapturedCall, createBotHarness, messageUpdate } from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../test-helpers/integration/translate-ai-mock.js";
import type { SessionData } from "../../types.js";

/**
 * Ids of the cards the bot rendered. A card is identified the way the repo's other
 * integration tests identify it: by the `editMessageReplyMarkup` that attaches its
 * save keyboard, which no notice ever gets.
 */
function cardMessageIds(sent: CapturedCall[]): number[] {
  return sent
    .filter((call) => {
      if (call.method !== "editMessageReplyMarkup") return false;
      const markup = call.payload.reply_markup as
        | { inline_keyboard?: Array<Array<{ callback_data?: string }>> }
        | undefined;
      return (markup?.inline_keyboard ?? [])
        .flat()
        .some((button) => button.callback_data?.startsWith("tr:save:") === true);
    })
    .map((call) => Number((call.payload as { message_id?: number }).message_id));
}

function deletedMessageIds(sent: CapturedCall[]): number[] {
  return sent
    .filter((call) => call.method === "deleteMessage")
    .map((call) => Number((call.payload as { message_id?: number }).message_id));
}

async function readSession(chatId: number): Promise<SessionData> {
  const row = await botSessionRepository.get(String(chatId));
  if (!row) throw new Error(`no session persisted for chat ${chatId}`);
  return row.data as SessionData;
}

describe("technical-message cleanup (integration)", () => {
  it("keeps every translation card while the user goes on translating", async () => {
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();
    await arrangeOnboardedTranslator(id);

    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "hello" }));
    const firstCards = cardMessageIds(harness.sent);
    expect(firstCards).toHaveLength(1);

    // The next word runs the central sweep before anything else touches the chat.
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "world", messageId: 2 }));

    const allCards = cardMessageIds(harness.sent);
    expect(allCards).toHaveLength(2);
    for (const cardId of allCards) {
      expect(deletedMessageIds(harness.sent)).not.toContain(cardId);
    }

    // Nothing from a finished translation is left queued for deletion.
    expect((await readSession(id)).technicalMessages ?? []).toEqual([]);
  });

  it("clears a rejection notice on the next message and leaves the card that follows", async () => {
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();
    await arrangeOnboardedTranslator(id);

    // An emoji-only message cannot be translated: the bot answers with a notice,
    // which is technical and must not outlive the next interaction.
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "🙂" }));
    const noticeIds = (await readSession(id)).technicalMessages ?? [];
    expect(noticeIds).toHaveLength(1);
    const noticeId = noticeIds[0];

    harness.reset();
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "hello", messageId: 2 }));

    expect(deletedMessageIds(harness.sent)).toContain(noticeId);
    const [cardId] = cardMessageIds(harness.sent);
    expect(cardId).toBeDefined();
    expect(deletedMessageIds(harness.sent)).not.toContain(cardId);
    expect((await readSession(id)).technicalMessages ?? []).toEqual([]);
  });
});
