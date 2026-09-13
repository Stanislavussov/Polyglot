/**
 * The daily safety ceiling — grammY e2e integration test.
 *
 * Every other limit in the product is a product decision that "unlimited" plans
 * and internal roles are meant to bypass. This one is an operational guard on
 * the AI bill, and the two properties worth proving through the real dispatcher
 * and a real Postgres are exactly the ones that invert those rules: that a plan
 * selling "unlimited" is still bounded, and that an `admin` account is too.
 *
 * The spend is arranged by writing the credit ledger directly rather than by
 * making three hundred AI calls. That ledger IS the input the ceiling reads —
 * the same rows the translate flow writes on every card — so nothing about the
 * mechanism is faked, only the hours it would otherwise take to fill.
 */
import { translationRequestRepository, userRepository } from "@polyglot/adapter-db";
import { DEFAULT_DAILY_CREDIT_CEILING, t } from "@polyglot/core";
import { describe, expect, it } from "vitest";
import { arrangeOnboardedTranslator } from "../../test-helpers/integration/arrange.js";
import { type BotHarness, createBotHarness, messageUpdate } from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../test-helpers/integration/translate-ai-mock.js";

/** Park `credits` on the user's daily ledger in one row, as if already spent today. */
async function spendCredits(userId: number, credits: number): Promise<void> {
  await translationRequestRepository.logTranslationRequest(userId, "[seed]", "en", ["cs"], credits);
}

function texts(harness: BotHarness): string[] {
  return harness.sent
    .filter((call) => call.method === "sendMessage" || call.method === "editMessageText")
    .map((call) => String(call.payload.text ?? ""));
}

/** The reply markup of the last message — the upgrade CTA, when there is one. */
function lastReplyMarkup(harness: BotHarness): unknown {
  return harness.sent.filter((call) => call.method === "sendMessage").at(-1)?.payload.reply_markup;
}

/**
 * The opening of the notice, which carries no interpolation — enough to identify
 * the message without pinning the reset clock the rest of it names.
 */
const CEILING_NOTICE = t("dailyCeilingReached", "en", { resetsAt: "" }).slice(0, 40);

const translate = (harness: BotHarness, chatId: number, word: string) =>
  harness.dispatch(messageUpdate({ chatId, fromId: chatId, text: word }));

describe("daily safety ceiling (integration)", () => {
  it("bounds a plan that sells unlimited translation", async () => {
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id, { plan: "pro" });

    // One credit short of the ceiling: Pro is unmetered, so nothing else is
    // counting, and this translation has to go through.
    await spendCredits(userId, DEFAULT_DAILY_CREDIT_CEILING - 1);
    await translate(harness, id, "hello");
    expect(harness.sent.some((call) => call.method === "editMessageReplyMarkup")).toBe(true);

    // That card put the account on the ceiling. The next word must not run.
    harness.reset();
    await translate(harness, id, "world");

    expect(harness.sent.some((call) => call.method === "editMessageReplyMarkup")).toBe(false);
    expect(texts(harness).some((text) => text.includes(CEILING_NOTICE))).toBe(true);
    // No upgrade offer: the user is on the top tier and there is nothing to sell.
    // Refusing them with a price list would be the product blaming a customer for
    // an operational guard.
    expect(lastReplyMarkup(harness)).toBeUndefined();
  });

  it("bounds an internal role, which every other plan limit exempts", async () => {
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id);
    await userRepository.updateAudienceGroup(userId, "admin");
    await spendCredits(userId, DEFAULT_DAILY_CREDIT_CEILING);

    await translate(harness, id, "hello");

    // `isUnlimitedRole` skips the plan's own meter, so without the ceiling this
    // account would have no bound at all — a stuck test script on a staff
    // account spends exactly the money a subscriber's would.
    expect(harness.sent.some((call) => call.method === "editMessageReplyMarkup")).toBe(false);
    expect(texts(harness).some((text) => text.includes(CEILING_NOTICE))).toBe(true);
  });

  it("leaves an ordinary day alone", async () => {
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id, { plan: "pro" });

    // A heavy but human day is nowhere near the guard.
    await spendCredits(userId, 80);
    await translate(harness, id, "hello");

    expect(harness.sent.some((call) => call.method === "editMessageReplyMarkup")).toBe(true);
    expect(texts(harness).some((text) => text.includes(CEILING_NOTICE))).toBe(false);
  });
});
