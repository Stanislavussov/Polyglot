/**
 * Language order across the card surfaces — grammY e2e integration test.
 *
 * The reported bug: "сохраняешь слово, и порядок перевода перескакивает между
 * языками". It has two visible halves, and this test pins both by driving one
 * dialog through the real dispatcher against a real Postgres.
 *
 * 1. The bot session lives in a `jsonb` column, which normalizes object keys, so
 *    the translations record read back for the *second* and later renders is
 *    alphabetical while the first render (still in memory) was in the user's
 *    order. Tapping SAVE is a separate Telegram update, so the saved card is one
 *    of those later renders.
 * 2. The dictionary card reads translation rows back from the database, which had
 *    no `ORDER BY`.
 *
 * The fixture is chosen so the two orders differ at every position: the user
 * studies de → es → cs, and alphabetical is cs → de → es. Every assertion here
 * therefore fails both against the old behaviour and against an ordering context
 * built from empty settings.
 */
import { languageRepository, userRepository, vocabularyRepository } from "@polyglot/adapter-db";
import { describe, expect, it } from "vitest";
import {
  callbackQueryUpdate,
  createBotHarness,
  lastRenderedCard,
  messageUpdate,
} from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../test-helpers/integration/translate-ai-mock.js";

const USER_ORDER = ["DE", "ES", "CS"];
const ALPHABETICAL = ["CS", "DE", "ES"];

/** An onboarded English-native user studying German, Spanish and Czech — in that order. */
async function arrangeMultiLanguageUser(telegramId: number): Promise<number> {
  const user = await userRepository.create({ telegramId, username: "order-test" });
  await userRepository.markOnboarded(user.id);
  await userRepository.updateSettings(user.id, {
    interfaceLang: "en",
    nativeLang: "en",
    learningLangs: ["de", "es", "cs"],
    lastSourceLang: null,
  });
  await userRepository.updateActiveMode(user.id, "translate");
  return user.id;
}

/** Language-code labels in the order they appear in a rendered card. */
function languageOrderOf(text: string): string[] {
  return [...text.matchAll(/\b(DE|ES|CS|RU):/g)].map((m) => m[1] as string);
}

type Sent = ReturnType<typeof createBotHarness>["sent"];

/** Text of the most recent message the bot sent or edited. */
function lastText(sent: Sent): string {
  const last = sent.filter((c) => c.method === "sendMessage" || c.method === "editMessageText").at(-1);
  if (!last) throw new Error("expected the bot to have sent or edited a message");
  return String((last.payload as { text?: unknown }).text ?? "");
}

/**
 * Message id + callback data of the last message carrying an inline keyboard.
 *
 * Unlike the shared `lastRenderedCard`, this also covers surfaces that attach the
 * keyboard directly to `sendMessage` — the dictionary list does that, rather than
 * following the translate card's send-then-editMessageReplyMarkup shape.
 */
function lastKeyboard(sent: Sent): { messageId: number; buttons: string[] } {
  const last = sent.filter((c) => (c.payload as { reply_markup?: unknown }).reply_markup !== undefined).at(-1);
  if (!last) throw new Error("expected a message carrying an inline keyboard");

  const markup = (last.payload as { reply_markup?: { inline_keyboard?: Array<Array<{ callback_data?: string }>> } })
    .reply_markup;
  const buttons = (markup?.inline_keyboard ?? [])
    .flat()
    .map((b) => b.callback_data)
    .filter((d): d is string => typeof d === "string");

  return { messageId: Number((last.payload as { message_id?: number }).message_id ?? 0), buttons };
}

describe("translation language order (integration)", () => {
  it("renders the user's language order on the first card, the saved card, and the dictionary card", async () => {
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();

    // Arrange
    const userId = await arrangeMultiLanguageUser(id);

    // Act 1 — a plain word renders the translation card.
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "hello" }));

    const { messageId: cardMsgId } = lastRenderedCard(harness.sent);
    const firstCard = lastText(harness.sent);
    expect(languageOrderOf(firstCard)).toEqual(USER_ORDER);

    // Act 2 — tapping SAVE is a SEPARATE update, so the card is re-rendered from
    // the session after a jsonb round-trip. This is the render that used to jump.
    harness.reset();
    await harness.dispatch(
      callbackQueryUpdate({ chatId: id, fromId: id, messageId: cardMsgId, data: `tr:save:${cardMsgId}` }),
    );

    const savedCard = lastText(harness.sent);
    expect(languageOrderOf(savedCard)).toEqual(USER_ORDER);

    // The row is persisted, so the dictionary surface has something to render.
    const en = await languageRepository.findByCode("en");
    if (!en) throw new Error("expected seeded language 'en'");
    const saved = await vocabularyRepository.findByOriginalAndSource(userId, "hello", en.id);
    expect(saved).not.toBeNull();
    expect(saved?.translations).toHaveLength(3);

    // Act 3 — open the entry in the dictionary. This card is built from database
    // rows rather than the session, so it is the other half of the defect.
    harness.reset();
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "/dictionary" }));

    const listCard = lastKeyboard(harness.sent);
    const viewButton = listCard.buttons.find((b) => b.startsWith("dict:view:"));
    if (!viewButton) throw new Error(`expected a dict:view button, got ${listCard.buttons.join(", ")}`);

    harness.reset();
    await harness.dispatch(
      callbackQueryUpdate({ chatId: id, fromId: id, messageId: listCard.messageId, data: viewButton }),
    );

    const dictionaryCard = lastText(harness.sent);
    expect(languageOrderOf(dictionaryCard)).toEqual(USER_ORDER);

    // Every surface agrees, and none of them fell back to alphabetical — which is
    // both the bug's signature and what an empty ordering context would produce.
    for (const card of [firstCard, savedCard, dictionaryCard]) {
      expect(languageOrderOf(card)).not.toEqual(ALPHABETICAL);
    }
  });

  it("follows the user's current order for entries saved under a different one", async () => {
    // Cross-entry consistency: order is derived from settings at render time, not
    // frozen per entry at save time, so the whole dictionary stays consistent.
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();
    const userId = await arrangeMultiLanguageUser(id);

    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "hello" }));
    const { messageId: cardMsgId } = lastRenderedCard(harness.sent);
    await harness.dispatch(
      callbackQueryUpdate({ chatId: id, fromId: id, messageId: cardMsgId, data: `tr:save:${cardMsgId}` }),
    );

    // The user reorders their languages after the word was already saved.
    await userRepository.updateSettings(userId, {
      interfaceLang: "en",
      nativeLang: "en",
      learningLangs: ["cs", "de", "es"],
      lastSourceLang: null,
    });

    harness.reset();
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "/dictionary" }));
    const listCard = lastKeyboard(harness.sent);
    const viewButton = listCard.buttons.find((b) => b.startsWith("dict:view:"));
    if (!viewButton) throw new Error("expected a dict:view button");

    harness.reset();
    await harness.dispatch(
      callbackQueryUpdate({ chatId: id, fromId: id, messageId: listCard.messageId, data: viewButton }),
    );

    expect(languageOrderOf(lastText(harness.sent))).toEqual(["CS", "DE", "ES"]);
  });
});
