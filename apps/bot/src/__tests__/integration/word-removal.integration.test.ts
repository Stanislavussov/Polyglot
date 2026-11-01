/**
 * Remove a word ⇄ bring it back — e2e (real dispatcher, real Postgres, fake `fetch`).
 *
 * @business A saved word is not always a word worth learning: it turned out trivial,
 * it was saved by a slip of the thumb, it is simply surplus. "I don't know it" and
 * "I don't want it" are different answers, so every surface that shows a saved word —
 * the translation card, the notification, the review deck, the dictionary — offers to
 * take it out. Taking it out is never final: the same surface offers it back, and the
 * word returns exactly as it was (its translations, its grade, its review schedule),
 * because a removal is `is_active = false` and nothing else.
 *
 * Assertion triad: the wire (the buttons and text the fake Telegram API captured), the
 * persisted rows, and the session state that decides what the next rebuild of a card
 * offers.
 */
import {
  botSessionRepository,
  getLang,
  vocabularyDictionaryRepository,
  vocabularyRepository,
} from "@polyglot/adapter-db";
import { type CreateVocabularyInput, t } from "@polyglot/core";
import { describe, expect, it } from "vitest";
import { arrangeNotifiableUser, arrangeOnboardedTranslator } from "../../test-helpers/integration/arrange.js";
import {
  type BotHarness,
  type CapturedCall,
  callbackQueryUpdate,
  createBotHarness,
  lastRenderedCard,
  messageUpdate,
} from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../test-helpers/integration/translate-ai-mock.js";
import type { SessionData } from "../../types.js";

const MESSAGE_ID = 910;

const VIDEO_SOURCE = {
  type: "video",
  videoUrl: "https://example.test/watch?v=1",
  videoTitle: "Harbour tour",
  timestampSeconds: 42,
} as const;

function langId(code: string): number {
  const lang = getLang(code);
  if (!lang) throw new Error(`language cache is not loaded (${code} missing)`);
  return lang.id;
}

function word(original: string): CreateVocabularyInput {
  return {
    original,
    sourceLangId: langId("en"),
    inputType: "word",
    emoji: "📝",
    unverified: false,
    translations: [{ targetLangId: langId("ru"), text: `${original}-ru`, details: { synonyms: [], examples: [] } }],
  };
}

function buttonsOf(call: CapturedCall): string[] {
  const markup = call.payload.reply_markup as
    | { inline_keyboard?: Array<Array<{ callback_data?: string }>> }
    | undefined;
  return (markup?.inline_keyboard ?? [])
    .flat()
    .map((button) => button.callback_data)
    .filter((data): data is string => typeof data === "string");
}

/** The screen the last send or edit left on the chat. */
function lastScreen(sent: CapturedCall[]): { text: string; buttons: string[] } {
  const call = sent.filter((c) => c.method === "sendMessage" || c.method === "editMessageText").at(-1);
  if (!call) throw new Error("nothing was rendered");
  return { text: String(call.payload.text ?? ""), buttons: buttonsOf(call) };
}

function toasts(sent: CapturedCall[]): string[] {
  return sent
    .filter((call) => call.method === "answerCallbackQuery")
    .map((call) => String((call.payload as { text?: string }).text ?? ""));
}

async function tap(harness: BotHarness, chatId: number, data: string, messageId = MESSAGE_ID): Promise<void> {
  harness.reset();
  await harness.dispatch(callbackQueryUpdate({ chatId, fromId: chatId, messageId, data }));
}

async function send(harness: BotHarness, chatId: number, text: string): Promise<void> {
  harness.reset();
  await harness.dispatch(messageUpdate({ chatId, fromId: chatId, text }));
}

async function readSession(chatId: number): Promise<SessionData> {
  const row = await botSessionRepository.get(String(chatId));
  if (!row) throw new Error(`no session persisted for chat ${chatId}`);
  return row.data as SessionData;
}

async function arrangeReviewer(): Promise<{ telegramId: number; userId: number }> {
  const telegramId = uniqueTelegramId();
  const userId = await arrangeOnboardedTranslator(telegramId, { nativeLang: "ru", learningLangs: ["en"] });
  return { telegramId, userId };
}

async function arrangeNudgedUser(): Promise<{ telegramId: number; userId: number; entryId: number; headword: string }> {
  const telegramId = uniqueTelegramId();
  const { userId, headword } = await arrangeNotifiableUser(telegramId, { notificationEnabled: false });
  const entryId = (await vocabularyRepository.findByUser(userId))[0]?.id;
  if (entryId === undefined) throw new Error("arrangeNudgedUser: expected a seeded vocabulary entry");
  return { telegramId, userId, entryId, headword };
}

describe("remove a word and bring it back (integration)", () => {
  describe("translation card", () => {
    it("R1: a saved card offers Remove, and the Save it turns into brings the very same word back", async () => {
      // Arrange — a translated and saved word.
      const harness = createBotHarness({ ai: deterministicTranslateAi() });
      const id = uniqueTelegramId();
      const userId = await arrangeOnboardedTranslator(id);
      await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "hello" }));
      const { messageId: card } = lastRenderedCard(harness.sent);

      // Act — save.
      await tap(harness, id, `tr:save:${card}`, card);

      // Assert — the saved card trades Save for Remove.
      const saved = lastScreen(harness.sent);
      expect(saved.buttons).toContain(`tr:remove:${card}`);
      expect(saved.buttons).not.toContain(`tr:save:${card}`);
      const entry = (await vocabularyRepository.findByUser(userId))[0];
      if (!entry) throw new Error("expected the word to be saved");

      // Act — remove.
      await tap(harness, id, `tr:remove:${card}`, card);

      // Assert — wire: Save is back and the card says what happened; DB: soft-deleted; session: not saved.
      const removed = lastScreen(harness.sent);
      expect(removed.buttons).toContain(`tr:save:${card}`);
      expect(removed.buttons).not.toContain(`tr:remove:${card}`);
      expect(removed.text).toContain(t("removedFromDict", "en"));
      expect(removed.text).not.toContain(t("savedToDict", "en"));
      expect(await vocabularyRepository.findByUser(userId)).toHaveLength(0);
      expect((await vocabularyRepository.findById(entry.id))?.isActive).toBe(false);
      expect((await readSession(id)).translationMap?.[String(card)]?.savedWordId).toBeUndefined();

      // Act — save again.
      await tap(harness, id, `tr:save:${card}`, card);

      // Assert — the same row is live again, and the card is back in its saved state.
      const back = await vocabularyRepository.findByUser(userId);
      expect(back.map((row) => row.id)).toEqual([entry.id]);
      expect(back[0]?.translations.map((tr) => tr.text)).toEqual(entry.translations.map((tr) => tr.text));
      const resaved = lastScreen(harness.sent);
      expect(resaved.buttons).toContain(`tr:remove:${card}`);
      expect(resaved.text).toContain(t("savedToDict", "en"));
      expect((await readSession(id)).translationMap?.[String(card)]?.savedWordId).toBe(entry.id);
    });

    it("R2: Remove on a card whose word was removed elsewhere still restores the stored word, not a re-creation of it", async () => {
      // Arrange — saved from the card, then removed somewhere else.
      const harness = createBotHarness({ ai: deterministicTranslateAi() });
      const id = uniqueTelegramId();
      const userId = await arrangeOnboardedTranslator(id);
      await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "hello" }));
      const { messageId: card } = lastRenderedCard(harness.sent);
      await tap(harness, id, `tr:save:${card}`, card);
      const entryId = (await vocabularyRepository.findByUser(userId))[0]!.id;
      // Provenance is what tells the two apart: a card's output carries none, so
      // re-creating the word from the card would erase it, and restoring keeps it.
      await vocabularyRepository.updateEntry(entryId, { source: VIDEO_SOURCE });
      await vocabularyRepository.delete(entryId, userId);

      // Act
      await tap(harness, id, `tr:remove:${card}`, card);

      // Assert — the button stops lying, the card says the word is out, and the tap was answered.
      const removed = lastScreen(harness.sent);
      expect(removed.buttons).toContain(`tr:save:${card}`);
      expect(removed.text).toContain(t("removedFromDict", "en"));
      expect(toasts(harness.sent)).toEqual([t("wordDeleted", "en")]);
      expect(await vocabularyRepository.findByUser(userId)).toHaveLength(0);

      // Act — a second tap on the same Remove (the >48h re-send leaves the old button live), then Save.
      await tap(harness, id, `tr:remove:${card}`, card);
      await tap(harness, id, `tr:save:${card}`, card);

      // Assert
      const back = await vocabularyRepository.findById(entryId);
      expect(back?.isActive).toBe(true);
      expect(back?.source).toEqual(VIDEO_SOURCE);
    });

    it("R3: Remove on a card the session no longer knows answers as stale and removes nothing", async () => {
      // Arrange
      const harness = createBotHarness();
      const { telegramId, userId } = await arrangeReviewer();
      await vocabularyRepository.create(userId, word("anchor"));

      // Act — a card id that was never in this session.
      await tap(harness, telegramId, "tr:remove:424242", 424242);

      // Assert
      expect(await vocabularyRepository.findByUser(userId)).toHaveLength(1);
      expect(harness.sent.some((call) => call.method === "answerCallbackQuery")).toBe(true);
    });
  });

  describe("notification", () => {
    it("R4: a removed notification offers the word back, and restoring returns the card's buttons", async () => {
      // Arrange
      const harness = createBotHarness();
      const { telegramId, userId, entryId, headword } = await arrangeNudgedUser();

      // Act — remove.
      await tap(harness, telegramId, `notif:learned:${entryId}`);

      // Assert — the confirmation carries the way back.
      const removed = lastScreen(harness.sent);
      expect(removed.text).toContain(headword);
      expect(removed.buttons).toEqual([`notif:restore:${entryId}`]);
      expect(await vocabularyRepository.findByUser(userId)).toHaveLength(0);

      // Act — bring it back.
      await tap(harness, telegramId, `notif:restore:${entryId}`);

      // Assert — live again, and the message is a card once more: Reveal, Remove, the settings.
      expect((await vocabularyRepository.findByUser(userId)).map((row) => row.id)).toEqual([entryId]);
      const restored = lastScreen(harness.sent);
      expect(restored.text).toContain(headword);
      expect(restored.buttons).toEqual([`notif:deck:${entryId}`, `notif:learned:${entryId}`, "notif:settings"]);
    });

    it("R5: the deck a notification is revealed into removes and restores the word without ever calling a model", async () => {
      // Arrange — the default harness AI throws, so any model call fails this test.
      const harness = createBotHarness();
      const { telegramId, userId, entryId } = await arrangeNudgedUser();
      await vocabularyRepository.updateEntry(entryId, { source: VIDEO_SOURCE });
      const before = await vocabularyRepository.findById(entryId);
      await tap(harness, telegramId, `notif:deck:${entryId}`);
      expect(lastScreen(harness.sent).buttons).toContain(`fc:del:${entryId}`);

      // Act — remove from the revealed card.
      await tap(harness, telegramId, `fc:del:${entryId}`);

      // Assert — gone, and the deck's last screen offers it back instead of rating a word that is not there.
      expect(await vocabularyRepository.findByUser(userId)).toHaveLength(0);
      const removed = lastScreen(harness.sent);
      expect(removed.buttons).toContain(`fc:undo:${entryId}`);
      expect(removed.buttons.some((data) => data.startsWith("fc:rate:"))).toBe(false);

      // Act — bring it back.
      await tap(harness, telegramId, `fc:undo:${entryId}`);

      // Assert — the stored word itself, untouched.
      const after = await vocabularyRepository.findById(entryId);
      expect(after?.isActive).toBe(true);
      // Re-creating the word from the card would have erased its provenance.
      expect(after?.source).toEqual(VIDEO_SOURCE);
      expect(after?.translations).toEqual(
        before?.translations.map((tr) => ({ ...tr, updatedAt: expect.any(Date) as Date })),
      );
      expect(toasts(harness.sent)).toEqual([t("wordRestored", "en")]);
    });

    it("R6: a forged restore cannot bring back another user's word", async () => {
      // Arrange — the owner removed their word; a stranger forges the way back.
      const harness = createBotHarness();
      const owner = await arrangeNudgedUser();
      const stranger = await arrangeNudgedUser();
      await tap(harness, owner.telegramId, `notif:learned:${owner.entryId}`);
      // The stranger's OWN dictionary: a foreign one is refused before the entry is ever looked at.
      const strangerDictionary = await vocabularyDictionaryRepository.getOrCreateDefault(stranger.userId);

      // Act
      await tap(harness, stranger.telegramId, `notif:restore:${owner.entryId}`);
      await tap(harness, stranger.telegramId, `fc:undo:${owner.entryId}`);
      await tap(harness, stranger.telegramId, `dict:restore:${strangerDictionary.id}:${owner.entryId}:1`);

      // Assert — still removed, never linked into the stranger's dictionary, and their own word untouched.
      expect(await vocabularyRepository.findByUser(owner.userId)).toHaveLength(0);
      expect(await vocabularyDictionaryRepository.entryBelongsToDictionary(owner.entryId, strangerDictionary.id)).toBe(
        false,
      );
      expect(await vocabularyRepository.findByUser(stranger.userId)).toHaveLength(1);
    });

    it("R6b: a forged Reveal cannot read another user's word", async () => {
      // Arrange — two users with the same headword, so only the ids can tell their cards apart.
      const harness = createBotHarness();
      const owner = await arrangeNudgedUser();
      const stranger = await arrangeNudgedUser();

      // Act
      await tap(harness, stranger.telegramId, `notif:deck:${owner.entryId}`);

      // Assert — the deck is drawn from the stranger's own dictionary alone.
      const deck = (await readSession(stranger.telegramId)).cards?.deck ?? [];
      expect(deck.map((card) => card.entryId)).toEqual([stranger.entryId]);
      const screen = lastScreen(harness.sent);
      expect(screen.buttons).toContain(`fc:del:${stranger.entryId}`);
      expect(screen.buttons.some((data) => data.endsWith(`:${owner.entryId}`))).toBe(false);
      const ownerTranslationIds = (await vocabularyRepository.findById(owner.entryId))?.translations.map((tr) => tr.id);
      expect(ownerTranslationIds?.some((id) => screen.buttons.includes(`fc:rate:good:${id}`))).toBe(false);
    });

    it("R6c: revealing a notification whose word was removed since answers, and never brings the word back", async () => {
      // Arrange — the notification outlived the word, and nothing else is left to review.
      const harness = createBotHarness();
      const { telegramId, userId, entryId } = await arrangeNudgedUser();
      await vocabularyRepository.delete(entryId, userId);

      // Act — the Reveal of a notification sent before they became cards.
      await tap(harness, telegramId, `notif:reveal:${entryId}`);

      // Assert — answered, no card drawn, the dead buttons cleared, and the word still removed.
      expect(toasts(harness.sent)).toEqual([t("noResults", "en")]);
      expect(harness.sent.some((call) => call.method === "editMessageText" || call.method === "sendMessage")).toBe(
        false,
      );
      const markup = harness.sent.filter((call) => call.method === "editMessageReplyMarkup").at(-1);
      expect(markup?.payload.reply_markup).toEqual({ inline_keyboard: [] });
      expect(await vocabularyRepository.findByUser(userId)).toHaveLength(0);
      expect((await readSession(telegramId)).cards).toBeUndefined();
    });
  });

  describe("review deck", () => {
    it("R7: the screen after a removal offers the word back, and taking the offer returns the card to the deck", async () => {
      // Arrange
      const harness = createBotHarness();
      const { telegramId, userId } = await arrangeReviewer();
      await vocabularyRepository.create(userId, word("anchor"));
      await vocabularyRepository.create(userId, word("harbor"));
      await send(harness, telegramId, "/flashcard");
      const removed = Number(
        lastScreen(harness.sent)
          .buttons.find((data) => data.startsWith("fc:del:"))
          ?.split(":")[2],
      );

      // Act — remove the card on screen.
      await tap(harness, telegramId, `fc:del:${removed}`);

      // Assert — the next card is up, with the way back for the removed one.
      const next = lastScreen(harness.sent);
      expect(next.buttons).toContain(`fc:undo:${removed}`);
      expect(next.buttons).not.toContain(`fc:del:${removed}`);
      expect(next.text).toContain("Card 1 of 1");
      expect(await vocabularyRepository.findByUser(userId)).toHaveLength(1);

      // Act — bring it back.
      await tap(harness, telegramId, `fc:undo:${removed}`);

      // Assert — the word is live and its card is the one on screen again, in a full deck.
      expect(await vocabularyRepository.findByUser(userId)).toHaveLength(2);
      const restored = lastScreen(harness.sent);
      expect(restored.buttons).toContain(`fc:del:${removed}`);
      expect(restored.buttons).not.toContain(`fc:undo:${removed}`);
      expect(restored.text).toContain("Card 1 of 2");
      expect((await readSession(telegramId)).cards?.deck).toHaveLength(2);
    });

    it("R8: the offer lasts one screen — the next card's answer no longer carries it", async () => {
      // Arrange
      const harness = createBotHarness();
      const { telegramId, userId } = await arrangeReviewer();
      await vocabularyRepository.create(userId, word("anchor"));
      await vocabularyRepository.create(userId, word("harbor"));
      await send(harness, telegramId, "/flashcard");
      const removed = Number(
        lastScreen(harness.sent)
          .buttons.find((data) => data.startsWith("fc:del:"))
          ?.split(":")[2],
      );
      await tap(harness, telegramId, `fc:del:${removed}`);

      // Act
      await tap(harness, telegramId, "fc:reveal");

      // Assert
      expect(lastScreen(harness.sent).buttons.some((data) => data.startsWith("fc:undo:"))).toBe(false);
    });

    it("R9: removing the last card ends the deck with the offer still there, and it still restores the word", async () => {
      // Arrange
      const harness = createBotHarness();
      const { telegramId, userId } = await arrangeReviewer();
      const { id: only } = await vocabularyRepository.create(userId, word("lighthouse"));
      await send(harness, telegramId, "/flashcard");

      // Act — remove the only card.
      await tap(harness, telegramId, `fc:del:${only}`);

      // Assert — the finish screen keeps its own buttons and adds the way back.
      expect(lastScreen(harness.sent).buttons).toEqual(expect.arrayContaining(["fc:restart", `fc:undo:${only}`]));

      // Act
      await tap(harness, telegramId, `fc:undo:${only}`);

      // Assert — restored and confirmed; the spent offer is gone, the finish buttons are not.
      expect((await vocabularyRepository.findByUser(userId)).map((row) => row.id)).toEqual([only]);
      expect(toasts(harness.sent)).toEqual([t("wordRestored", "en")]);
      const markup = harness.sent.filter((call) => call.method === "editMessageReplyMarkup").at(-1);
      if (!markup) throw new Error("expected the finish screen's keyboard to be redrawn");
      expect(buttonsOf(markup)).toContain("fc:restart");
      expect(buttonsOf(markup)).not.toContain(`fc:undo:${only}`);
    });
  });

  describe("dictionary", () => {
    it("R10: deleting a word from the dictionary keeps its row, and the confirmation screen brings it back", async () => {
      // Arrange
      const harness = createBotHarness();
      const { telegramId, userId } = await arrangeReviewer();
      const { id: entryId } = await vocabularyRepository.create(userId, word("compass"));
      const dictionary = await vocabularyDictionaryRepository.addEntryToDefault(userId, entryId);
      await send(harness, telegramId, "/dictionary");
      const address = `${dictionary.id}:${entryId}:1`;

      // Act — open the word, delete, confirm.
      await tap(harness, telegramId, `dict:view:${address}`);
      await tap(harness, telegramId, `dict:delete:${address}`);
      await tap(harness, telegramId, `dict:confirm-delete:${address}`);

      // Assert — out of the dictionary but not out of the database, with the way back on screen.
      expect(await vocabularyRepository.findByUser(userId)).toHaveLength(0);
      expect((await vocabularyRepository.findById(entryId))?.isActive).toBe(false);
      const removed = lastScreen(harness.sent);
      expect(removed.text).toContain("compass");
      expect(removed.buttons).toEqual([`dict:restore:${address}`, `dict:page:${dictionary.id}:1`]);

      // Act — bring it back.
      await tap(harness, telegramId, `dict:restore:${address}`);

      // Assert — live, in the same dictionary, and the word's own screen is open again.
      expect((await vocabularyRepository.findByUser(userId)).map((row) => row.id)).toEqual([entryId]);
      expect(await vocabularyDictionaryRepository.entryBelongsToDictionary(entryId, dictionary.id)).toBe(true);
      const restored = lastScreen(harness.sent);
      expect(restored.text).toContain("compass");
      expect(restored.buttons).toContain(`dict:delete:${address}`);
    });

    it("R11: a word that lives in another dictionary too only leaves this one, and comes back into it", async () => {
      // Arrange — one word, two dictionaries.
      const harness = createBotHarness();
      const { telegramId, userId } = await arrangeReviewer();
      const { id: entryId } = await vocabularyRepository.create(userId, word("sextant"));
      await vocabularyDictionaryRepository.addEntryToDefault(userId, entryId);
      const travel = await vocabularyDictionaryRepository.create(userId, "Travel");
      await vocabularyDictionaryRepository.addEntry(travel.id, entryId);
      const address = `${travel.id}:${entryId}:1`;

      // Act
      await tap(harness, telegramId, `dict:confirm-delete:${address}`);

      // Assert — still a live word, just not in "Travel".
      expect(await vocabularyRepository.findByUser(userId)).toHaveLength(1);
      expect(await vocabularyDictionaryRepository.entryBelongsToDictionary(entryId, travel.id)).toBe(false);
      expect(lastScreen(harness.sent).buttons).toContain(`dict:restore:${address}`);

      // Act
      await tap(harness, telegramId, `dict:restore:${address}`);

      // Assert
      expect(await vocabularyDictionaryRepository.entryBelongsToDictionary(entryId, travel.id)).toBe(true);
    });
  });
});
