/**
 * Spelling preflight on a confidently-detected word — grammY e2e integration test.
 *
 * The reported bug: Czech "selmostroj" was detected as cs at 0.90 confidence, which
 * skipped the preflight entirely (it was gated on LANGUAGE confidence alone), and
 * came back as a confidently fabricated "bridge-construction company" card. Language
 * confidence answers "which language", not "is this spelled like a real word", so a
 * single word now always gets the spelling pass and the user is offered the correct
 * form instead of an invented card.
 */
import { vocabularyRepository } from "@polyglot/adapter-db";
import { describe, expect, it } from "vitest";
import { arrangeOnboardedTranslator } from "../../test-helpers/integration/arrange.js";
import { createBotHarness, messageUpdate } from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../test-helpers/integration/translate-ai-mock.js";

type Sent = ReturnType<typeof createBotHarness>["sent"];

/** The last message the bot sent, with its inline-button callback data. */
function lastPrompt(sent: Sent): { text: string; buttons: string[] } {
  const last = sent.filter((call) => call.method === "sendMessage").at(-1);
  if (!last) throw new Error("expected the bot to have sent a message");
  const markup = last.payload.reply_markup as
    | { inline_keyboard?: Array<Array<{ text?: string; callback_data?: string }>> }
    | undefined;
  return {
    text: String((last.payload as { text?: unknown }).text ?? ""),
    buttons: (markup?.inline_keyboard ?? [])
      .flat()
      .map((button) => button.text)
      .filter((text): text is string => typeof text === "string"),
  };
}

describe("spelling preflight (integration)", () => {
  it("offers the correct spelling instead of a card when a confidently-detected word is misspelled", async () => {
    // Arrange
    const harness = createBotHarness({
      ai: deterministicTranslateAi({ typoSuggestion: { misspelled: "acheive", correctedText: "achieve" } }),
    });
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id);

    // Act — an ordinary Latin-script word, so language detection is confident.
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "acheive" }));

    // Assert — the correction is offered, and no card was rendered or saved.
    const prompt = lastPrompt(harness.sent);
    expect(prompt.buttons).toContain("achieve");
    expect(harness.sent.filter((call) => call.method === "editMessageReplyMarkup")).toHaveLength(0);
    await expect(vocabularyRepository.countByUser(userId)).resolves.toBe(0);

    // Cleanup
    harness.reset();
  });

  it("still renders a card for a correctly-spelled word with the same mock", async () => {
    // Arrange
    const harness = createBotHarness({
      ai: deterministicTranslateAi({ typoSuggestion: { misspelled: "acheive", correctedText: "achieve" } }),
    });
    const id = uniqueTelegramId();
    await arrangeOnboardedTranslator(id);

    // Act
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "hello" }));

    // Assert
    expect(harness.sent.filter((call) => call.method === "editMessageReplyMarkup").length).toBeGreaterThan(0);

    // Cleanup
    harness.reset();
  });
});
