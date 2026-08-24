/**
 * Session / callback regression e2e tests (Task 71, Phase 5).
 *
 * Each scenario would fail against the pre-fix behavior:
 *  - "session expired": a card button whose translationMap entry is missing must
 *    answer with the session-expired alert, not crash.
 *  - translation-map eviction (regression 1e6407c): after overflowing the map the
 *    oldest card is evicted (its button reports session-expired) while a recent
 *    card still resolves.
 *  - stale-card recovery: the expired card's alert is localized and followed by a
 *    one-tap re-translate that really re-runs the pipeline for that word.
 *  - 48h edit limit (d9b330f): when Telegram rejects an edit with "message to edit
 *    not found", the edit-message helper falls back to a fresh reply instead of
 *    throwing.
 *
 * All mutations are scoped to per-test unique Telegram ids. Drives the real
 * dispatch pipeline against a real, migrated+seeded Postgres (CI service
 * container, local docker, or a Neon branch); the multi-step translate runs use
 * the deterministic AI mock.
 */
import { userRepository } from "@polyglot/adapter-db";
import { t } from "@polyglot/core";
import { describe, expect, it } from "vitest";
import { MAX_TRANSLATION_MAP_ENTRIES } from "../../scenes/helpers/translation-map.helper.js";
import { arrangeOnboardedTranslator } from "../../test-helpers/integration/arrange.js";
import type { BotHarness, CapturedCall } from "../../test-helpers/integration/bot-harness.js";
import {
  callbackQueryUpdate,
  createBotHarness,
  lastRenderedCard,
  messageUpdate,
} from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../test-helpers/integration/translate-ai-mock.js";
import { RETRY_CALLBACK } from "../../utils/retry-action.js";

const SESSION_EXPIRED = "Session expired";

/** Translate one word and return the rendered card's message id. */
async function translateWord(harness: BotHarness, id: number, word: string): Promise<number> {
  harness.reset();
  await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: word }));
  return lastRenderedCard(harness.sent).messageId;
}

/** The captured `sendMessage` carrying the "🔄 Try again" button, if one went out. */
function retryNotice(sent: CapturedCall[]): CapturedCall | undefined {
  return sent.find((call) => {
    if (call.method !== "sendMessage") return false;
    const markup = (call.payload as { reply_markup?: { inline_keyboard?: Array<Array<{ callback_data?: string }>> } })
      .reply_markup;
    return (markup?.inline_keyboard ?? []).flat().some((button) => button.callback_data === RETRY_CALLBACK);
  });
}

/** Fill the translation map past its cap and return the card ids, oldest first. */
async function overflowTranslationMap(harness: BotHarness, id: number): Promise<number[]> {
  const cardIds: number[] = [];
  for (let i = 0; i <= MAX_TRANSLATION_MAP_ENTRIES; i++) {
    cardIds.push(await translateWord(harness, id, `word${i}`));
  }
  return cardIds;
}

function answerCallbackTexts(sent: CapturedCall[]): string[] {
  return sent
    .filter((call) => call.method === "answerCallbackQuery")
    .map((call) => String((call.payload as { text?: string }).text ?? ""));
}

describe("callback regressions (integration)", () => {
  it("answers 'session expired' for a card whose translationMap entry is missing", async () => {
    const harness = createBotHarness();
    const id = uniqueTelegramId();
    await arrangeOnboardedTranslator(id);

    // No card was ever produced in this session → the save button finds no entry.
    await harness.dispatch(callbackQueryUpdate({ chatId: id, fromId: id, messageId: 999999, data: "tr:save:999999" }));

    expect(answerCallbackTexts(harness.sent).some((text) => text.includes(SESSION_EXPIRED))).toBe(true);
  });

  it("evicts the oldest card but keeps a recent one resolvable (1e6407c)", async () => {
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id);
    // Overflowing the map needs 31 translations, past the free plan's monthly
    // quota of 20 — mark the user a tester (bypasses limits); eviction, not
    // quota gating, is the behavior under test here.
    await userRepository.updateAudienceGroup(userId, "tester");

    // Overflow the map by one so the first-inserted card is evicted.
    const cardIds = await overflowTranslationMap(harness, id);
    const oldest = cardIds[0];
    const newest = cardIds[cardIds.length - 1];

    // Oldest card → evicted → session expired.
    harness.reset();
    await harness.dispatch(
      callbackQueryUpdate({ chatId: id, fromId: id, messageId: oldest, data: `tr:save:${oldest}` }),
    );
    expect(answerCallbackTexts(harness.sent).some((text) => text.includes(SESSION_EXPIRED))).toBe(true);

    // Newest card → still present → resolves without a session-expired alert.
    harness.reset();
    await harness.dispatch(
      callbackQueryUpdate({ chatId: id, fromId: id, messageId: newest, data: `tr:save:${newest}` }),
    );
    expect(answerCallbackTexts(harness.sent).some((text) => text.includes(SESSION_EXPIRED))).toBe(false);
  });

  it("falls back to a reply when Telegram rejects the card edit (48h limit, d9b330f)", async () => {
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();
    await arrangeOnboardedTranslator(id);

    const cardMsgId = await translateWord(harness, id, "hello");

    // Force the save path's editMessageText to fail as "message to edit not found".
    harness.reset();
    harness.failNextEdit();
    await harness.dispatch(
      callbackQueryUpdate({ chatId: id, fromId: id, messageId: cardMsgId, data: `tr:save:${cardMsgId}` }),
    );

    // The helper caught the GrammyError and re-sent as a fresh message rather than throwing.
    const methods = harness.sent.map((call) => call.method);
    expect(methods).toContain("editMessageText");
    expect(methods).toContain("sendMessage");
  });

  it("offers a one-tap re-translate on an expired card, and the button re-runs it", async () => {
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id);
    await userRepository.updateAudienceGroup(userId, "tester");

    const oldest = (await overflowTranslationMap(harness, id))[0]!;

    harness.reset();
    await harness.dispatch(
      callbackQueryUpdate({ chatId: id, fromId: id, messageId: oldest, data: `tr:save:${oldest}` }),
    );

    // The card's full state is gone, but what it was about is not — so the dead
    // end becomes an offer naming the word.
    const notice = retryNotice(harness.sent);
    expect(notice).toBeDefined();
    expect(String(notice?.payload.text)).toContain("word0");

    harness.reset();
    await harness.dispatch(
      callbackQueryUpdate({ chatId: id, fromId: id, messageId: notice!.messageId!, data: RETRY_CALLBACK }),
    );

    // A fresh card for the same word, not another session-expired alert.
    expect(answerCallbackTexts(harness.sent).some((text) => text.includes(SESSION_EXPIRED))).toBe(false);
    const retranslated = harness.sent.find(
      (call) =>
        call.method === "sendMessage" && String((call.payload as { text?: string }).text ?? "").includes("word0"),
    );
    expect(retranslated?.messageId).toBe(lastRenderedCard(harness.sent).messageId);
  });

  it("answers an expired card in the user's interface language", async () => {
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id, { nativeLang: "ru", learningLangs: ["de"] });
    await userRepository.updateSettings(userId, {
      interfaceLang: "ru",
      nativeLang: "ru",
      learningLangs: ["de"],
      lastSourceLang: null,
    });

    harness.reset();
    await harness.dispatch(callbackQueryUpdate({ chatId: id, fromId: id, messageId: 999999, data: "tr:save:999999" }));

    const texts = answerCallbackTexts(harness.sent);
    expect(texts).toContain(t("staleSession", "ru"));
    expect(texts.some((text) => text.includes(SESSION_EXPIRED))).toBe(false);
  });
});
