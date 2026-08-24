/**
 * Persistent main-menu keyboard — grammY e2e integration test.
 *
 * Telegram binds a reply keyboard to the message that delivered it, so deleting
 * that message takes the menu off the user's screen. `mainKeyboardMiddleware` sends
 * the keyboard on a user's first message, and the translate flow wipes its
 * technical messages at the start of every translation — when the carrier was one
 * of them the menu survived exactly one translation and, with the delivery flag
 * already stored, never came back. This drives real updates through the real
 * dispatcher and asserts the carrier is never deleted and never re-sent.
 */
import { botSessionRepository } from "@polyglot/adapter-db";
import { describe, expect, it } from "vitest";
import { MAIN_KEYBOARD_VERSION } from "../../middlewares/main-keyboard.js";
import { arrangeOnboardedTranslator } from "../../test-helpers/integration/arrange.js";
import { type CapturedCall, createBotHarness, messageUpdate } from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../test-helpers/integration/translate-ai-mock.js";
import type { SessionData } from "../../types.js";

/** The sendMessage calls that carried a reply keyboard, with the id assigned to each. */
function keyboardCarriers(sent: CapturedCall[]): Array<{ messageId: number; labels: string[] }> {
  return sent
    .filter((call) => call.method === "sendMessage")
    .flatMap((call) => {
      const markup = call.payload.reply_markup as { keyboard?: Array<Array<{ text?: string }>> } | undefined;
      if (!markup?.keyboard) return [];
      const labels = markup.keyboard.flat().map((button) => button.text ?? "");
      return [{ messageId: call.messageId ?? -1, labels }];
    });
}

/** Message ids the bot asked Telegram to delete. */
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

describe("main-menu keyboard (integration)", () => {
  it("survives the technical-message cleanup that every translation runs", async () => {
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();

    // Arrange: an onboarded user who has never received the keyboard.
    await arrangeOnboardedTranslator(id);

    // Act 1: the first message installs the keyboard, then translates — and the
    // translate flow's cleanup runs in the very same update.
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "hello" }));

    const carriers = keyboardCarriers(harness.sent);
    expect(carriers).toHaveLength(1);
    const carrier = carriers[0];
    if (!carrier) throw new Error("the main-menu keyboard was never sent");
    expect(carrier.labels).toEqual(["✨ Pick words", "🧑‍🏫 Mentor", "📖 Dictionary", "🎴 Cards", "🎬 Videos"]);
    expect(deletedMessageIds(harness.sent)).not.toContain(carrier.messageId);

    const afterFirst = await readSession(id);
    expect(afterFirst.mainKeyboardVersion).toBe(MAIN_KEYBOARD_VERSION);
    expect(afterFirst.mainKeyboardMessageId).toBe(carrier.messageId);
    expect(afterFirst.technicalMessages ?? []).not.toContain(carrier.messageId);

    // Act 2: a second translation sweeps the technical messages the first one left
    // behind — the carrier must not be among them, and the menu must not be re-sent.
    harness.reset();
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "world", messageId: 2 }));

    expect(deletedMessageIds(harness.sent)).not.toContain(carrier.messageId);
    expect(keyboardCarriers(harness.sent)).toEqual([]);

    const afterSecond = await readSession(id);
    expect(afterSecond.mainKeyboardMessageId).toBe(carrier.messageId);
  });

  it("re-installs the keyboard on /start so a user who lost it can get it back", async () => {
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();

    // Arrange: a user who already has the current keyboard, so the middleware stays quiet.
    await arrangeOnboardedTranslator(id);
    await botSessionRepository.upsert(String(id), {
      activeMode: "translate",
      mainKeyboardVersion: MAIN_KEYBOARD_VERSION,
      mainKeyboardMessageId: 777,
    } satisfies SessionData);

    // Act: /start — the escape hatch when the carrier message is gone from the chat.
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "/start" }));

    const carriers = keyboardCarriers(harness.sent);
    expect(carriers).toHaveLength(1);
    const carrier = carriers[0];
    if (!carrier) throw new Error("/start did not re-install the main-menu keyboard");
    expect(deletedMessageIds(harness.sent)).not.toContain(carrier.messageId);

    const session = await readSession(id);
    expect(session.mainKeyboardMessageId).toBe(carrier.messageId);
    expect(session.mainKeyboardVersion).toBe(MAIN_KEYBOARD_VERSION);
  });
});
