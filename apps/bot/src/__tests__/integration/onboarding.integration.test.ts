/**
 * /start onboarding — grammY e2e integration test (Task 71, Phase 4).
 *
 * Drives a real `/start` update through the real dispatch pipeline against a real
 * Postgres branch. Asserts both the DB side effect (a user row is created) and
 * the captured outbound Telegram payload (the native-language onboarding prompt).
 * Each test uses its own synthetic Telegram user; no shared fixtures, no cleanup.
 */
import { identityRepository, userRepository } from "@polyglot/adapter-db";
import { describe, expect, it } from "vitest";
import type { CapturedCall } from "../../test-helpers/integration/bot-harness.js";
import { createBotHarness, messageUpdate } from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";

/** Extract the inline-keyboard callback data strings from a captured sendMessage. */
function callbackDatas(call: CapturedCall): string[] {
  const markup = call.payload.reply_markup as
    | { inline_keyboard?: Array<Array<{ callback_data?: string }>> }
    | undefined;
  return (markup?.inline_keyboard ?? [])
    .flat()
    .map((button) => button.callback_data)
    .filter((data): data is string => typeof data === "string");
}

describe("/start onboarding (integration)", () => {
  it("creates the user and sends the native-language prompt", async () => {
    const harness = createBotHarness();
    const id = uniqueTelegramId();

    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "/start" }));

    // The auth middleware get-or-created the user + linked its telegram identity.
    expect(await identityRepository.resolveUserId("telegram", String(id))).not.toBeNull();

    const messages = harness.sent.filter((call) => call.method === "sendMessage");
    expect(messages.length).toBeGreaterThan(0);
    // The onboarding step-1 prompt offers one `lang:<code>` button per supported language.
    const langButtons = messages.flatMap(callbackDatas).filter((data) => data.startsWith("lang:"));
    expect(langButtons.length).toBeGreaterThan(0);
  });

  it("does not create a duplicate user on a second /start", async () => {
    const harness = createBotHarness();
    const id = uniqueTelegramId();

    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "/start" }));
    const userId = await identityRepository.resolveUserId("telegram", String(id));
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "/start" }));

    // Idempotent get-or-create: the id is stable and re-creating returns the same row.
    expect(userId).not.toBeNull();
    expect(await identityRepository.resolveUserId("telegram", String(id))).toBe(userId);
    const recreated = await userRepository.create({ telegramId: id, username: "dup-check" });
    expect(recreated.id).toBe(userId);
  });
});
