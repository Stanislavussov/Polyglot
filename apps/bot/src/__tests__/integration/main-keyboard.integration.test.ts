/**
 * Standing main-menu keyboard — grammY e2e integration test.
 *
 * Telegram binds a reply keyboard to the message that delivered it, so deleting
 * that message takes the menu off the user's screen. `mainKeyboardMiddleware`
 * sends the keyboard on a user's first message and stores a delivery flag, so a
 * carrier that ever disappeared would never be replaced. This drives real updates
 * through the real dispatcher and asserts the carrier is never deleted and never
 * re-sent, that /start remains the escape hatch, that the markup reaching Telegram
 * carries neither the fold-away nor the pinned flag, and that a chat left on an older
 * version is caught up exactly once.
 */
import { botSessionRepository } from "@polyglot/adapter-db";
import type { KeyboardButton, ReplyKeyboardMarkup } from "grammy/types";
import { describe, expect, it } from "vitest";
import { MAIN_KEYBOARD_VERSION } from "../../middlewares/main-keyboard.js";
import { arrangeOnboardedTranslator } from "../../test-helpers/integration/arrange.js";
import { type CapturedCall, createBotHarness, messageUpdate } from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../test-helpers/integration/translate-ai-mock.js";
import type { SessionData } from "../../types.js";

/** A reply-keyboard button is either the plain label or an object carrying it. */
function buttonText(button: KeyboardButton): string {
  return typeof button === "string" ? button : button.text;
}

/** The sendMessage calls that carried a reply keyboard, with the id assigned to each. */
function keyboardCarriers(
  sent: CapturedCall[],
): Array<{ messageId: number; labels: string[]; markup: ReplyKeyboardMarkup }> {
  return sent
    .filter((call) => call.method === "sendMessage")
    .flatMap((call) => {
      const markup = call.payload.reply_markup as ReplyKeyboardMarkup | undefined;
      if (!markup?.keyboard) return [];
      const labels = markup.keyboard.flat().map(buttonText);
      return [{ messageId: call.messageId ?? -1, labels, markup }];
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
  it("is delivered once and never deleted by the translations that follow", async () => {
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();

    // Arrange: an onboarded user who has never received the keyboard.
    await arrangeOnboardedTranslator(id);

    // Act 1: the first message installs the keyboard, then translates.
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "hello" }));

    const carriers = keyboardCarriers(harness.sent);
    expect(carriers).toHaveLength(1);
    const carrier = carriers[0];
    if (!carrier) throw new Error("the main-menu keyboard was never sent");
    expect(carrier.labels).toEqual(["🎴 Cards", "🧑‍🏫 Mentor", "📖 Dictionary"]);
    expect(deletedMessageIds(harness.sent)).not.toContain(carrier.messageId);

    const afterFirst = await readSession(id);
    expect(afterFirst.mainKeyboardVersion).toBe(MAIN_KEYBOARD_VERSION);

    // Act 2: a second translation must neither delete the carrier nor re-send the menu.
    harness.reset();
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "world", messageId: 2 }));

    expect(deletedMessageIds(harness.sent)).not.toContain(carrier.messageId);
    expect(keyboardCarriers(harness.sent)).toEqual([]);

    const afterSecond = await readSession(id);
    expect(afterSecond.mainKeyboardVersion).toBe(MAIN_KEYBOARD_VERSION);
  });

  it("re-installs the keyboard on /start so a user who lost it can get it back", async () => {
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();

    // Arrange: a user who already has the current keyboard, so the middleware stays quiet.
    await arrangeOnboardedTranslator(id);
    await botSessionRepository.upsert(String(id), {
      activeMode: "translate",
      mainKeyboardVersion: MAIN_KEYBOARD_VERSION,
    } satisfies SessionData);

    // Act: /start — the escape hatch when the carrier message is gone from the chat.
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "/start" }));

    const carriers = keyboardCarriers(harness.sent);
    expect(carriers).toHaveLength(1);
    const carrier = carriers[0];
    if (!carrier) throw new Error("/start did not re-install the main-menu keyboard");
    expect(deletedMessageIds(harness.sent)).not.toContain(carrier.messageId);

    const session = await readSession(id);
    expect(session.mainKeyboardVersion).toBe(MAIN_KEYBOARD_VERSION);
  });

  it("sends markup with neither the fold-away flag nor the pinned one", async () => {
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();

    await arrangeOnboardedTranslator(id);
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "hello" }));

    const carrier = keyboardCarriers(harness.sent)[0];
    if (!carrier) throw new Error("the main-menu keyboard was never sent");

    // `one_time_keyboard` collapses the menu after every tap; `is_persistent` pins it
    // open for the life of the chat. Neither: the user decides, via the ⌨️ icon.
    expect(carrier.markup.one_time_keyboard).toBeUndefined();
    expect(carrier.markup.is_persistent).toBeUndefined();
    expect(carrier.markup.resize_keyboard).toBe(true);
  });

  it("re-delivers to a chat left on the previous keyboard version, then goes quiet again", async () => {
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();

    // Arrange: a chat that received the last version — in production those are holding a
    // keyboard that folds away on the first tap.
    await arrangeOnboardedTranslator(id);
    await botSessionRepository.upsert(String(id), {
      activeMode: "translate",
      mainKeyboardVersion: MAIN_KEYBOARD_VERSION - 1,
    } satisfies SessionData);

    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "hello" }));

    expect(keyboardCarriers(harness.sent)).toHaveLength(1);
    expect(await readSession(id)).toMatchObject({ mainKeyboardVersion: MAIN_KEYBOARD_VERSION });

    harness.reset();
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "world", messageId: 2 }));

    expect(keyboardCarriers(harness.sent)).toEqual([]);
  });
});
