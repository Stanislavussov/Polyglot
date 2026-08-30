/**
 * Translate happy path — grammY e2e integration test (Task 71, Phase 4).
 *
 * Drives a plain text message through the real translate pipeline against a real
 * Postgres branch, with a DETERMINISTIC AI injected via DI (not vi.mock). The AI
 * mock returns schema-shaped fixtures by matching each requested Zod schema, so it
 * satisfies every pipeline step (preflight → metadata + per-language generation →
 * finalize) without hardcoding call order. Vocabulary is persisted only when the
 * user taps SAVE, so the test asserts the DB row after dispatching the
 * `tr:save:<cardMsgId>` callback, and asserts the outbound card payload.
 *
 * NOTE: this exercises the full multi-step AI pipeline; the fixtures below follow
 * the verified schema contract (translation.service.ts). Runs against any
 * migrated+seeded Postgres (CI service container, local docker, or a Neon branch).
 */
import { botSessionRepository, languageRepository, vocabularyRepository } from "@polyglot/adapter-db";
import { t } from "@polyglot/core";
import { describe, expect, it } from "vitest";
import { arrangeOnboardedTranslator } from "../../test-helpers/integration/arrange.js";
import {
  type CapturedCall,
  callbackQueryUpdate,
  createBotHarness,
  lastRenderedCard,
  messageUpdate,
} from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../test-helpers/integration/translate-ai-mock.js";
import type { SessionData } from "../../types.js";

/** The card the save handler left behind — an in-place edit, or a re-send when the edit was refused. */
function savedCard(sent: CapturedCall[]): { text: string; buttons: Array<{ text: string; data: string }> } {
  const call = sent.filter((c) => c.method === "editMessageText" || c.method === "sendMessage").at(-1);
  if (!call) throw new Error("the save handler produced no card");
  const markup = call.payload.reply_markup as
    | { inline_keyboard?: Array<Array<{ text?: string; callback_data?: string }>> }
    | undefined;
  const buttons = (markup?.inline_keyboard ?? [])
    .flat()
    .filter((b): b is { text: string; callback_data: string } => typeof b.callback_data === "string")
    .map((b) => ({ text: b.text ?? "", data: b.callback_data }));
  return { text: String(call.payload.text ?? ""), buttons };
}

async function readSession(chatId: number): Promise<SessionData> {
  const row = await botSessionRepository.get(String(chatId));
  if (!row) throw new Error(`no session persisted for chat ${chatId}`);
  return row.data as SessionData;
}

describe("translate happy path (integration)", () => {
  it("translates a word, renders a save card, and persists vocab on save", async () => {
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();

    // Arrange: an onboarded user learning Czech, native English, translate mode.
    const userId = await arrangeOnboardedTranslator(id);

    // Act 1: send a plain word → the translate pipeline renders a card. The card
    // is sent as text and its keyboard is attached via a separate
    // editMessageReplyMarkup, so both the id and the buttons come from that call.
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "hello" }));

    const { messageId: cardMsgId, buttons } = lastRenderedCard(harness.sent);
    expect(buttons).toContain(`tr:save:${cardMsgId}`);

    // Act 2: tap SAVE → the vocab row is persisted.
    harness.reset();
    await harness.dispatch(
      callbackQueryUpdate({ chatId: id, fromId: id, messageId: cardMsgId, data: `tr:save:${cardMsgId}` }),
    );

    const en = await languageRepository.findByCode("en");
    if (!en) throw new Error("expected seeded language 'en'");
    const saved = await vocabularyRepository.findByOriginalAndSource(userId, "hello", en.id);
    expect(saved).not.toBeNull();
    expect(saved?.original).toBe("hello");
    // The saved-card confirmation is emitted (either an edit of the card or a reply).
    expect(harness.sent.some((c) => c.method === "sendMessage" || c.method === "editMessageText")).toBe(true);
  });

  it("translates an English phrase into the native language even when English is not studied", async () => {
    // A ru-native studying only Czech. English is neither native nor a learning
    // language, so the direction resolver declines and the English lingua-franca
    // branch takes over — which used to target the learning languages ONLY,
    // persisting a Czech-only card and leaving the learner with no translation in
    // the language they think in. Multi-word input on purpose: English joins the
    // detection candidates only for phrases, which is what reaches that branch.
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id, { nativeLang: "ru", learningLangs: ["cs"] });

    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "good morning" }));
    const { messageId: cardMsgId } = lastRenderedCard(harness.sent);

    harness.reset();
    await harness.dispatch(
      callbackQueryUpdate({ chatId: id, fromId: id, messageId: cardMsgId, data: `tr:save:${cardMsgId}` }),
    );

    const en = await languageRepository.findByCode("en");
    const ru = await languageRepository.findByCode("ru");
    if (!en || !ru) throw new Error("expected seeded languages 'en' and 'ru'");
    const saved = await vocabularyRepository.findByOriginalAndSource(userId, "good morning", en.id);
    expect(saved).not.toBeNull();
    expect(saved?.translations.map((tr) => tr.targetLangId)).toContain(ru.id);
  });

  // A save used to blank the card's keyboard: `editMessageText` was called with no
  // `reply_markup`, and Telegram drops the buttons when that field is absent. The
  // user was left with a dead card and had to open the dictionary to keep working.
  it("keeps every card button after a save, with the save button flipped to its saved state", async () => {
    // Arrange
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id);

    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "hello" }));
    const { messageId: cardMsgId, buttons: before } = lastRenderedCard(harness.sent);

    // Act
    harness.reset();
    await harness.dispatch(
      callbackQueryUpdate({ chatId: id, fromId: id, messageId: cardMsgId, data: `tr:save:${cardMsgId}` }),
    );

    // Assert — reply: every button that was on the card is still on it.
    const { text, buttons } = savedCard(harness.sent);
    expect(buttons.map((b) => b.data)).toEqual(before);
    expect(buttons.find((b) => b.data === `tr:save:${cardMsgId}`)?.text).toBe(t("alreadySavedButton", "en"));
    expect(text).toContain(t("savedToDict", "en"));

    // Assert — DB and session both know the word is banked.
    const en = await languageRepository.findByCode("en");
    if (!en) throw new Error("expected seeded language 'en'");
    const saved = await vocabularyRepository.findByOriginalAndSource(userId, "hello", en.id);
    expect(saved).not.toBeNull();
    const session = await readSession(id);
    expect(session.translationMap?.[String(cardMsgId)]?.savedWordId).toBe(saved?.id);
  });

  it("re-sends the card with its buttons when the card is too old to edit", async () => {
    // Arrange
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();
    await arrangeOnboardedTranslator(id);

    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "hello" }));
    const { messageId: cardMsgId } = lastRenderedCard(harness.sent);

    // Act — Telegram refuses the in-place edit (the 48h limit).
    harness.reset();
    harness.failNextEdit();
    await harness.dispatch(
      callbackQueryUpdate({ chatId: id, fromId: id, messageId: cardMsgId, data: `tr:save:${cardMsgId}` }),
    );

    // Assert — the fallback message carries the keyboard, still addressing the same card entry.
    const { text, buttons } = savedCard(harness.sent);
    expect(harness.sent.some((c) => c.method === "sendMessage")).toBe(true);
    expect(buttons.map((b) => b.data)).toContain(`tr:save:${cardMsgId}`);
    expect(buttons.map((b) => b.data)).toContain(`tr:clarifypost:${cardMsgId}`);
    expect(text).toContain(t("savedToDict", "en"));
  });

  it("answers a second save tap with the already-saved alert and leaves the card intact", async () => {
    // Arrange
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();
    await arrangeOnboardedTranslator(id);

    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "hello" }));
    const { messageId: cardMsgId } = lastRenderedCard(harness.sent);
    await harness.dispatch(
      callbackQueryUpdate({ chatId: id, fromId: id, messageId: cardMsgId, data: `tr:save:${cardMsgId}` }),
    );

    // Act — the user taps the now-✅ button again.
    harness.reset();
    await harness.dispatch(
      callbackQueryUpdate({ chatId: id, fromId: id, messageId: cardMsgId, data: `tr:save:${cardMsgId}` }),
    );

    // Assert — an alert, and no edit that strips the keyboard.
    const answer = harness.sent.filter((c) => c.method === "answerCallbackQuery").at(-1);
    expect(answer?.payload.text).toBe(t("alreadySaved", "en"));
    const strippedKeyboard = harness.sent.some(
      (c) => c.method === "editMessageText" && c.payload.reply_markup === undefined,
    );
    expect(strippedKeyboard).toBe(false);
  });
});
