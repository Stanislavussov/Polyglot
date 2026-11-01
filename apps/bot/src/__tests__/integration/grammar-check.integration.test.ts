/**
 * Grammar check mode — grammY e2e integration test.
 *
 * Drives the mode through the real dispatcher, DI container and Postgres: entry by
 * `/check` and by the ✍️ hot button, a checked answer rendered from a deterministic
 * AI, the free plan's daily limit read from the real plan row (5 a day) and counted
 * from the real ledger, the exit button back to translation, and a pre-2×2 keyboard
 * label that must still open its screen instead of being translated.
 *
 * @business Every tier can check its sentences; the plan's daily limit is the gate.
 */
import { botSessionRepository, translationRequestRepository, userRepository } from "@polyglot/adapter-db";
import { type AIPort, getDailyWindowStart, getLangDisplay, grammarCheckResultSchema, t } from "@polyglot/core";
import type { InlineKeyboardMarkup } from "grammy/types";
import { describe, expect, it, vi } from "vitest";
import { GRAMMAR_EXIT_CALLBACK } from "../../scenes/helpers/grammar-check.helper.js";
import { arrangeOnboardedTranslator } from "../../test-helpers/integration/arrange.js";
import {
  type BotHarness,
  type CapturedCall,
  callbackQueryUpdate,
  createBotHarness,
  messageUpdate,
} from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../test-helpers/integration/translate-ai-mock.js";
import type { SessionData } from "../../types.js";

const MISTAKE = {
  fragment: "jsem šel do škola",
  correction: "jsem šel do školy",
  category: "agreement",
  explanation: "After do the noun takes the genitive.",
  example: "Jdu do obchodu.",
};

/**
 * Grammar-check calls get the fixture below; every other structured call (the
 * translate pipeline after exiting) falls through to the translate fixtures.
 */
function arrangeHarness(detectedLanguage = "cs") {
  const translate = deterministicTranslateAi();
  const checkFixture = {
    detectedLanguage,
    errors: [MISTAKE],
    correctedText: "Včera jsem šel do školy.",
    naturalAlternative: null,
  };
  const checkCalls: string[] = [];
  const generateObject = vi.fn(async (prompt: string, schema: unknown, model: string, options?: unknown) => {
    if (schema === grammarCheckResultSchema) {
      checkCalls.push(prompt);
      return checkFixture;
    }
    return (translate.generateObject as AIPort["generateObject"])(
      prompt,
      schema as Parameters<AIPort["generateObject"]>[1],
      model,
      options as Parameters<AIPort["generateObject"]>[3],
    );
  }) as unknown as AIPort["generateObject"];
  const harness = createBotHarness({ ai: { ...translate, generateObject } });
  return { harness, checkCalls, generateObject };
}

const sends = (harness: BotHarness): CapturedCall[] => harness.sent.filter((call) => call.method === "sendMessage");

function buttonsOf(call: CapturedCall | undefined): string[] {
  const markup = call?.payload.reply_markup as InlineKeyboardMarkup | undefined;
  return (markup?.inline_keyboard ?? [])
    .flat()
    .map((button) => ("callback_data" in button ? button.callback_data : ""));
}

async function readSession(chatId: number): Promise<SessionData> {
  const row = await botSessionRepository.get(String(chatId));
  if (!row) throw new Error(`no session persisted for chat ${chatId}`);
  return row.data as SessionData;
}

async function checksToday(userId: number): Promise<number> {
  return translationRequestRepository.countRequestsInWindow(userId, "[grammarCheck]", getDailyWindowStart());
}

describe("grammar check mode (integration)", () => {
  it("enters via /check, answers a sentence with each mistake and the corrected text, and stays in the mode", async () => {
    // Arrange
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id, { nativeLang: "en", learningLangs: ["cs"] });
    const { harness, checkCalls } = arrangeHarness();

    // Act — enter
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "/check" }));

    // Assert — intro with the exit button, mode persisted in DB and session
    const intro = sends(harness).at(-1);
    expect(intro?.payload.text).toBe(t("grammarCheckModeOn", "en"));
    expect(buttonsOf(intro)).toEqual([GRAMMAR_EXIT_CALLBACK]);
    expect((await userRepository.getSettings(userId))?.activeMode).toBe("grammar");
    expect((await readSession(id)).activeMode).toBe("grammar");

    // Act — a sentence
    harness.reset();
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "Včera jsem šel do škola." }));

    // Assert — the AI saw the text and only the user's languages; the reply is the rendered check
    expect(checkCalls).toHaveLength(1);
    expect(checkCalls[0]).toContain("Včera jsem šel do škola.");
    expect(checkCalls[0]).toContain("cs (Czech) — learning");
    expect(checkCalls[0]).not.toContain("German");
    const answer = sends(harness).at(-1);
    expect(answer?.payload.parse_mode).toBe("HTML");
    expect(String(answer?.payload.text)).toContain("<s>jsem šel do škola</s> → <b>jsem šel do školy</b>");
    expect(String(answer?.payload.text)).toContain("Včera jsem šel do školy.");
    expect(buttonsOf(answer)).toEqual([GRAMMAR_EXIT_CALLBACK]);
    expect(await checksToday(userId)).toBe(1);
    expect((await readSession(id)).activeMode).toBe("grammar");
  });

  it("enters via the ✍️ hot button, without translating the label", async () => {
    // Arrange
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id);
    const { harness, generateObject } = arrangeHarness();

    // Act
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: `✍️ ${t("menuBtnGrammarCheck", "en")}` }));

    // Assert
    expect(sends(harness).at(-1)?.payload.text).toBe(t("grammarCheckModeOn", "en"));
    expect((await userRepository.getSettings(userId))?.activeMode).toBe("grammar");
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("allows the free plan five checks a day and refuses the sixth with the upgrade offer", async () => {
    // Arrange — the real free plan row, not an override: this is the seeded limit.
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id);
    const { harness, checkCalls } = arrangeHarness();
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "/check" }));

    // Act
    for (let turn = 0; turn < 5; turn += 1) {
      await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: `Věta číslo ${turn}.` }));
    }
    harness.reset();
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "Šestá věta." }));

    // Assert — refused before any AI call, with the limit named and the CTA attached
    expect(checkCalls).toHaveLength(5);
    const refusal = sends(harness).at(-1);
    expect(refusal?.payload.text).toBe(t("grammarCheckDailyLimitReached", "en", { limit: "5" }));
    expect(buttonsOf(refusal)).toContain("plan:upgrade");
    expect(await checksToday(userId)).toBe(5);

    // A spent day also refuses re-entry, instead of opening a mode that only refuses.
    harness.reset();
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "/check" }));
    expect(sends(harness).at(-1)?.payload.text).toBe(t("grammarCheckDailyLimitReached", "en", { limit: "5" }));
  });

  it("lists the checkable languages for a text in another language", async () => {
    // Arrange
    const id = uniqueTelegramId();
    await arrangeOnboardedTranslator(id, { nativeLang: "en", learningLangs: ["cs"] });
    const { harness } = arrangeHarness("fr");
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "/check" }));
    harness.reset();

    // Act
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "Je suis allé à l'école." }));

    // Assert
    const reply = String(sends(harness).at(-1)?.payload.text);
    expect(reply.startsWith("🌍")).toBe(true);
    expect(reply).toBe(
      t("grammarCheckUnsupportedLanguage", "en", { languages: `${getLangDisplay("en")}, ${getLangDisplay("cs")}` }),
    );
    expect(reply).not.toContain("<s>");
  });

  it("exits back to translation on the exit button, and the next word is translated", async () => {
    // Arrange
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id);
    const { harness, checkCalls } = arrangeHarness();
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "/check" }));
    const introId = sends(harness).at(-1)?.messageId;
    if (introId === undefined) throw new Error("intro was not sent");
    harness.reset();

    // Act — exit
    await harness.dispatch(
      callbackQueryUpdate({ chatId: id, fromId: id, messageId: introId, data: GRAMMAR_EXIT_CALLBACK }),
    );

    // Assert — back in translate mode in DB and session
    expect((await userRepository.getSettings(userId))?.activeMode).toBe("translate");
    expect((await readSession(id)).activeMode).toBe("translate");

    // Act — a word after exiting goes to translation, not to the check
    harness.reset();
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "hello" }));
    expect(checkCalls).toHaveLength(0);
    expect(await checksToday(userId)).toBe(0);
  });

  it("still opens the dictionary from a keyboard sent before the 2×2 grid shortened its label", async () => {
    // Arrange
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id);
    const { harness, generateObject } = arrangeHarness();

    // Act
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "📖 Dictionary" }));

    // Assert — routed to the dictionary: no AI call (a translation would make one), mode unchanged
    expect(generateObject).not.toHaveBeenCalled();
    expect(sends(harness).length).toBeGreaterThan(0);
    expect((await userRepository.getSettings(userId))?.activeMode).toBe("translate");
  });
});
