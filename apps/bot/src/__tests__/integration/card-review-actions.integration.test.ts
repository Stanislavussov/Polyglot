/**
 * Review-card actions — e2e (real dispatcher, real Postgres, fake `fetch`).
 *
 * @business A saved word the learner no longer wants, or finds hard, is usually
 * noticed while reviewing it — not when a notification happens to arrive. So the
 * flashcard offers the notification's own grades (they drive how often the word
 * comes back) and both review surfaces can remove the word for good. The card's
 * hidden-answer front is the learner's to shape: a native-language hint written
 * at translation time, source synonyms, a bare example — and never the meaning.
 *
 * Assertion triad: the wire (buttons/text captured off the fake Telegram API), the
 * persisted state (vocabulary rows, the card template row), and the session moving
 * on to the next card.
 */
import { cardTemplateRepository, getLang, vocabularyRepository } from "@polyglot/adapter-db";
import type { CreateVocabularyInput } from "@polyglot/core";
import { describe, expect, it } from "vitest";
import { arrangeOnboardedTranslator } from "../../test-helpers/integration/arrange.js";
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

const CARD_MESSAGE_ID = 900;

function langId(code: string): number {
  const lang = getLang(code);
  if (!lang) throw new Error(`language cache is not loaded (${code} missing)`);
  return lang.id;
}

function word(original: string, overrides: Partial<CreateVocabularyInput> = {}): CreateVocabularyInput {
  return {
    original,
    sourceLangId: langId("en"),
    inputType: "word",
    emoji: "📝",
    unverified: false,
    translations: [{ targetLangId: langId("ru"), text: `${original}-ru`, details: { synonyms: [], examples: [] } }],
    ...overrides,
  };
}

/** The screen the last send or edit left on the chat. */
function lastScreen(sent: CapturedCall[]): { text: string; buttons: string[] } {
  const call = sent.filter((c) => c.method === "sendMessage" || c.method === "editMessageText").at(-1);
  if (!call) throw new Error("nothing was rendered");
  const markup = call.payload.reply_markup as
    | { inline_keyboard?: Array<Array<{ callback_data?: string }>> }
    | undefined;
  const buttons = (markup?.inline_keyboard ?? [])
    .flat()
    .map((button) => button.callback_data)
    .filter((data): data is string => typeof data === "string");
  return { text: String(call.payload.text ?? ""), buttons };
}

function toasts(sent: CapturedCall[]): string[] {
  return sent
    .filter((call) => call.method === "answerCallbackQuery")
    .map((call) => String((call.payload as { text?: string }).text ?? ""));
}

/** The entry id the on-screen card's remove button addresses. */
function shownEntryId(buttons: string[], prefix: "fc" | "srs"): number {
  const data = buttons.find((button) => button.startsWith(`${prefix}:del:`));
  if (!data) throw new Error(`no ${prefix}:del button on screen: ${buttons.join(", ")}`);
  return Number(data.split(":")[2]);
}

async function tap(harness: BotHarness, chatId: number, data: string): Promise<void> {
  harness.reset();
  await harness.dispatch(callbackQueryUpdate({ chatId, fromId: chatId, messageId: CARD_MESSAGE_ID, data }));
}

async function send(harness: BotHarness, chatId: number, text: string): Promise<void> {
  harness.reset();
  await harness.dispatch(messageUpdate({ chatId, fromId: chatId, text }));
}

async function arrangeReviewer(): Promise<{ telegramId: number; userId: number }> {
  const telegramId = uniqueTelegramId();
  const userId = await arrangeOnboardedTranslator(telegramId, { nativeLang: "ru", learningLangs: ["en"] });
  return { telegramId, userId };
}

describe("review-card actions (integration)", () => {
  it("K1: grading a revealed flashcard stores the notification grade and opens the next card", async () => {
    const harness = createBotHarness();
    const { telegramId, userId } = await arrangeReviewer();
    await vocabularyRepository.create(userId, word("anchor"));
    await vocabularyRepository.create(userId, word("harbor"));

    await send(harness, telegramId, "/flashcard");
    const first = shownEntryId(lastScreen(harness.sent).buttons, "fc");

    await tap(harness, telegramId, "fc:reveal");
    expect(lastScreen(harness.sent).buttons).toEqual(
      expect.arrayContaining([
        `fc:fb:hard:${first}`,
        `fc:fb:normal:${first}`,
        `fc:fb:easy:${first}`,
        `fc:del:${first}`,
      ]),
    );

    await tap(harness, telegramId, `fc:fb:hard:${first}`);

    expect((await vocabularyRepository.findById(first))?.difficulty).toBe("hard");
    const next = shownEntryId(lastScreen(harness.sent).buttons, "fc");
    expect(next).not.toBe(first);
    expect(toasts(harness.sent)).toEqual([expect.stringContaining("more often")]);
  });

  it("K2: removing a word from a flashcard takes it out of the dictionary and carries on with the deck", async () => {
    const harness = createBotHarness();
    const { telegramId, userId } = await arrangeReviewer();
    await vocabularyRepository.create(userId, word("anchor"));
    await vocabularyRepository.create(userId, word("harbor"));

    await send(harness, telegramId, "/flashcard");
    const removed = shownEntryId(lastScreen(harness.sent).buttons, "fc");

    await tap(harness, telegramId, `fc:del:${removed}`);

    const remaining = await vocabularyRepository.findByUser(userId);
    expect(remaining.map((entry) => entry.id)).not.toContain(removed);
    expect(remaining).toHaveLength(1);
    expect(shownEntryId(lastScreen(harness.sent).buttons, "fc")).toBe(remaining[0]?.id);
    expect(toasts(harness.sent)).toEqual([expect.stringContaining("deleted")]);

    // The removed card's button, tapped again, must not take the card now on screen with it.
    await tap(harness, telegramId, `fc:del:${removed}`);
    expect(await vocabularyRepository.findByUser(userId)).toHaveLength(1);
    expect(toasts(harness.sent)).toEqual([expect.stringContaining("Session expired")]);
  });

  it("K3: a forged remove button cannot delete another user's word from any surface", async () => {
    const harness = createBotHarness();
    const owner = await arrangeReviewer();
    const stranger = await arrangeReviewer();
    const { id: ownerEntry } = await vocabularyRepository.create(owner.userId, word("lighthouse"));

    await tap(harness, stranger.telegramId, `fc:del:${ownerEntry}`);
    await tap(harness, stranger.telegramId, `srs:del:${ownerEntry}`);
    await tap(harness, stranger.telegramId, `notif:learned:${ownerEntry}`);

    expect(await vocabularyRepository.findByUser(owner.userId)).toHaveLength(1);
  });

  it("K4: the card-front settings persist and shape the next front, which never shows the meaning", async () => {
    const harness = createBotHarness();
    const { telegramId, userId } = await arrangeReviewer();
    await vocabularyRepository.create(
      userId,
      word("hello", {
        nativeMeaning: "Приветствие при встрече.",
        sourceUsage: {
          explanation: "Обычное приветствие.",
          synonyms: [{ text: "hi there" }],
          examples: [{ context: "greeting", target: "Hello, Anna!", native: "Привет, Анна!" }],
          recallHint: "Дружелюбно и неформально.",
        },
      }),
    );

    await send(harness, telegramId, "/flashcard");
    const untouched = lastScreen(harness.sent).text;
    expect(untouched).toContain("(hi there)");
    expect(untouched).not.toContain("Дружелюбно");
    expect(untouched).not.toContain("Hello, Anna!");

    await tap(harness, telegramId, "set:card");
    expect(lastScreen(harness.sent).buttons).toEqual(
      expect.arrayContaining(["set:card:t:hint", "set:card:t:synonyms", "set:card:t:example", "set:root"]),
    );
    await tap(harness, telegramId, "set:card:t:hint");
    await tap(harness, telegramId, "set:card:t:example");
    await tap(harness, telegramId, "set:card:t:synonyms");
    // The settings screen previews the latest word with the choice just made.
    expect(lastScreen(harness.sent).text).toContain("Дружелюбно и неформально.");

    expect(await cardTemplateRepository.getFields(userId)).toEqual({ hint: true, example: true, synonyms: false });

    await send(harness, telegramId, "/flashcard");
    const shaped = lastScreen(harness.sent).text;
    expect(shaped).toContain("🔎 <i>Дружелюбно и неформально.</i>");
    expect(shaped).toContain("💬 <i>Hello, Anna!</i>");
    expect(shaped).not.toContain("(hi there)");
    for (const answer of ["Привет, Анна!", "hello-ru", "Приветствие при встрече.", "Обычное приветствие."]) {
      expect(shaped).not.toContain(answer);
    }
  });

  it("K5: removing a word during review drops every card of that word and moves on", async () => {
    const harness = createBotHarness();
    const { telegramId, userId } = await arrangeReviewer();
    const past = new Date("2020-01-01T00:00:00.000Z");
    for (const created of [
      await vocabularyRepository.create(
        userId,
        word("anchor", {
          translations: [
            { targetLangId: langId("ru"), text: "якорь", details: { synonyms: [], examples: [] } },
            { targetLangId: langId("de"), text: "Anker", details: { synonyms: [], examples: [] } },
          ],
        }),
      ),
      await vocabularyRepository.create(userId, word("harbor")),
    ]) {
      for (const translation of created.translations) {
        await vocabularyRepository.updateSrsState(translation.id, {
          easeFactor: 2.5,
          interval: 1,
          dueDate: past,
          reviewCount: 1,
        });
      }
    }

    await send(harness, telegramId, "/review");
    const removed = shownEntryId(lastScreen(harness.sent).buttons, "srs");

    await tap(harness, telegramId, "srs:reveal");
    expect(lastScreen(harness.sent).buttons).toContain(`srs:del:${removed}`);
    await tap(harness, telegramId, `srs:del:${removed}`);

    const remaining = await vocabularyRepository.findByUser(userId);
    expect(remaining.map((entry) => entry.id)).not.toContain(removed);
    expect(shownEntryId(lastScreen(harness.sent).buttons, "srs")).toBe(remaining[0]?.id);
  });

  it("K6: a translated and saved word carries its recall hint to the card front", async () => {
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const { telegramId, userId } = await arrangeReviewer();

    await send(harness, telegramId, "hello");
    const { messageId: cardMsgId } = lastRenderedCard(harness.sent);
    // The hint is for the front of a review card; the translation card must not spend it.
    const translationCard = harness.sent.find((call) => call.method === "sendMessage");
    expect(String(translationCard?.payload.text)).not.toContain("Friendly and informal");

    harness.reset();
    await harness.dispatch(
      callbackQueryUpdate({
        chatId: telegramId,
        fromId: telegramId,
        messageId: cardMsgId,
        data: `tr:save:${cardMsgId}`,
      }),
    );
    const [saved] = await vocabularyRepository.findByUser(userId);
    expect(saved?.sourceUsage?.recallHint).toBe("Friendly and informal; said when you meet someone.");

    await tap(harness, telegramId, "set:card:t:hint");
    await send(harness, telegramId, "/flashcard");
    expect(lastScreen(harness.sent).text).toContain("Friendly and informal; said when you meet someone.");
  });

  it("K7: removing the only card left ends on the finish screen, not a dead end", async () => {
    const harness = createBotHarness();
    const { telegramId, userId } = await arrangeReviewer();
    const { id } = await vocabularyRepository.create(userId, word("anchor"));

    await send(harness, telegramId, "/flashcard");
    await tap(harness, telegramId, `fc:del:${id}`);

    expect(await vocabularyRepository.findByUser(userId)).toHaveLength(0);
    const screen = lastScreen(harness.sent);
    expect(screen.text).toContain("deleted");
    expect(screen.buttons).toContain("fc:restart");
  });

  it("K8: a grade left on a card the deck moved past changes nothing", async () => {
    const harness = createBotHarness();
    const { telegramId, userId } = await arrangeReviewer();
    await vocabularyRepository.create(userId, word("anchor"));
    await vocabularyRepository.create(userId, word("harbor"));

    await send(harness, telegramId, "/flashcard");
    const first = shownEntryId(lastScreen(harness.sent).buttons, "fc");
    await tap(harness, telegramId, "fc:reveal");
    await tap(harness, telegramId, `fc:fb:hard:${first}`);

    await tap(harness, telegramId, `fc:fb:easy:${first}`);

    expect((await vocabularyRepository.findById(first))?.difficulty).toBe("hard");
    expect(toasts(harness.sent)).toEqual([expect.stringContaining("Session expired")]);
  });

  it("K9: grading a word removed elsewhere since the deck was built moves on to the next card", async () => {
    const harness = createBotHarness();
    const { telegramId, userId } = await arrangeReviewer();
    await vocabularyRepository.create(userId, word("anchor"));
    await vocabularyRepository.create(userId, word("harbor"));

    await send(harness, telegramId, "/flashcard");
    const first = shownEntryId(lastScreen(harness.sent).buttons, "fc");
    await tap(harness, telegramId, "fc:reveal");
    // Removed from a notification or the dictionary screen while this card was open.
    await vocabularyRepository.delete(first, userId);

    await tap(harness, telegramId, `fc:fb:hard:${first}`);

    const next = shownEntryId(lastScreen(harness.sent).buttons, "fc");
    expect(next).not.toBe(first);
    expect(toasts(harness.sent)).toEqual([expect.stringContaining("deleted")]);
  });
});
