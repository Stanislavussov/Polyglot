/**
 * Stateless onboarding — grammY e2e integration test (Task 71 harness, Task 72 flow).
 *
 * Drives real `/start` and real button taps through the real dispatch pipeline
 * against a real Postgres. Asserts the DB side effects (user row, settings,
 * CEFR levels, `onboarded`) and the captured outbound Telegram payloads.
 *
 * The AI mock is left in its default rejecting state throughout: the redesigned
 * happy path must reach a rendered card without one single AI call, and a test
 * that quietly allowed one would not be testing the thing that matters.
 *
 * Each test uses its own synthetic Telegram user; no shared fixtures, no cleanup.
 */
import { identityRepository, onboardingDemoCardRepository, userRepository } from "@polyglot/adapter-db";
import { getHookWords } from "@polyglot/core";
import { describe, expect, it } from "vitest";
import type { BotHarness, CapturedCall } from "../../test-helpers/integration/bot-harness.js";
import { callbackQueryUpdate, createBotHarness, messageUpdate } from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";

/** Extract the inline-keyboard callback data strings from a captured call. */
function callbackDatas(call: CapturedCall): string[] {
  const markup = call.payload.reply_markup as
    | { inline_keyboard?: Array<Array<{ callback_data?: string }>> }
    | undefined;
  return (markup?.inline_keyboard ?? [])
    .flat()
    .map((button) => button.callback_data)
    .filter((data): data is string => typeof data === "string");
}

/** Every callback data currently on screen, across sends and in-place edits. */
function visibleCallbacks(harness: BotHarness): string[] {
  const screens = harness.sent.filter((call) => call.method === "sendMessage" || call.method === "editMessageText");
  const last = screens.at(-1);
  return last ? callbackDatas(last) : [];
}

/** The message id of the first screen — the one every in-place edit targets. */
function firstScreenId(harness: BotHarness): number {
  const first = harness.sent.find((call) => call.method === "sendMessage");
  if (first?.messageId === undefined) throw new Error("no onboarding screen was sent");
  return first.messageId;
}

/** All text the bot has sent or edited into place. */
function allText(harness: BotHarness): string[] {
  return harness.sent
    .filter((call) => call.method === "sendMessage" || call.method === "editMessageText")
    .map((call) => String(call.payload.text ?? ""));
}

/**
 * Cache a demo card and set its review state. `upsert` deliberately cannot
 * publish — that is what the separate `setActive` review step is for.
 */
async function seedDemoCard(opts: {
  sourceLang: string;
  nativeLang: string;
  headword: string;
  translationText: string;
  isActive: boolean;
}): Promise<void> {
  await onboardingDemoCardRepository.upsert({
    sourceLang: opts.sourceLang,
    nativeLang: opts.nativeLang,
    headword: opts.headword,
    payload: {
      original: opts.headword,
      sourceLang: opts.sourceLang,
      nativeSynonyms: [],
      sourceUsage: { headword: opts.headword, explanation: opts.translationText, synonyms: [], examples: [] },
      translations: { [opts.nativeLang]: { text: opts.translationText, synonyms: [], examples: [] } },
    },
  });
  await onboardingDemoCardRepository.setActive(opts.sourceLang, opts.nativeLang, opts.headword, opts.isActive);
}

describe("/start onboarding (integration)", () => {
  it("creates the user and guesses the native language from the Telegram locale", async () => {
    const harness = createBotHarness();
    const id = uniqueTelegramId();

    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "/start", languageCode: "ru" }));

    expect(await identityRepository.resolveUserId("telegram", String(id))).not.toBeNull();
    // The guess is promoted to the first button; every other supported language
    // is on the same screen, so a wrong guess costs no extra step.
    const buttons = visibleCallbacks(harness);
    expect(buttons[0]).toBe("onb:nat:ru");
    expect(buttons.length).toBeGreaterThan(1);
    expect(buttons.filter((data) => data === "onb:nat:ru")).toHaveLength(1);
  });

  it("shows the same language list when the client sends no locale", async () => {
    const withLocale = createBotHarness();
    const withLocaleId = uniqueTelegramId();
    await withLocale.dispatch(
      messageUpdate({ chatId: withLocaleId, fromId: withLocaleId, text: "/start", languageCode: "ru" }),
    );

    const harness = createBotHarness();
    const id = uniqueTelegramId();
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "/start" }));

    const buttons = visibleCallbacks(harness);
    expect(buttons.every((data) => data.startsWith("onb:nat:"))).toBe(true);
    // Nothing is hidden behind a guess: the offered set is identical either way.
    expect(new Set(buttons)).toEqual(new Set(visibleCallbacks(withLocale)));
  });

  it("does not create a duplicate user on a second /start", async () => {
    const harness = createBotHarness();
    const id = uniqueTelegramId();

    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "/start" }));
    const userId = await identityRepository.resolveUserId("telegram", String(id));
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "/start" }));

    expect(userId).not.toBeNull();
    expect(await identityRepository.resolveUserId("telegram", String(id))).toBe(userId);
    const recreated = await userRepository.create({ telegramId: id, username: "dup-check" });
    expect(recreated.id).toBe(userId);
  });

  it("reaches a real cached card in five taps, with no AI call at any point", async () => {
    const headword = getHookWords("de")[0].headword;
    await seedDemoCard({
      sourceLang: "de",
      nativeLang: "ru",
      headword,
      translationText: "перевод из кэша",
      isActive: true,
    });

    const harness = createBotHarness(); // AI left rejecting on purpose
    const id = uniqueTelegramId();
    const tap = async (data: string) =>
      harness.dispatch(
        callbackQueryUpdate({ chatId: id, fromId: id, messageId: firstScreenId(harness), data, languageCode: "ru" }),
      );

    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "/start", languageCode: "ru" }));
    await tap("onb:nat:ru");
    await tap("onb:lang:de");
    await tap("onb:lvl:de:B2");
    await tap("onb:done");
    await tap(`onb:hook:de:0`);

    const userId = await identityRepository.resolveUserId("telegram", String(id));
    expect(userId).not.toBeNull();
    const user = await userRepository.findById(userId!);
    expect(user?.onboarded).toBe(true);

    const settings = await userRepository.getSettings(userId!);
    expect(settings?.nativeLang).toBe("ru");
    expect(settings?.learningLangs).toEqual(["de"]);
    expect(settings?.activeMode).toBe("translate");

    // The level asked inline on the language screen actually reached the DB.
    const levels = await userRepository.getLanguageLevels(userId!);
    expect(levels).toContainEqual({ languageCode: "de", proficiencyLevel: "B2" });

    // The card came from the cache, rendered by the production renderer.
    expect(allText(harness).some((text) => text.includes("перевод из кэша"))).toBe(true);
  });

  it("never serves an unreviewed demo card, and still completes onboarding when the demo fails", async () => {
    const headword = getHookWords("cs")[0].headword;
    await seedDemoCard({
      sourceLang: "cs",
      nativeLang: "ru",
      headword,
      translationText: "неотрецензированная карточка",
      isActive: false,
    });

    const harness = createBotHarness(); // AI rejects, so the live fallback cannot succeed
    const id = uniqueTelegramId();
    const tap = async (data: string) =>
      harness.dispatch(
        callbackQueryUpdate({ chatId: id, fromId: id, messageId: firstScreenId(harness), data, languageCode: "ru" }),
      );

    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "/start", languageCode: "ru" }));
    await tap("onb:nat:ru");
    await tap("onb:lang:cs");
    await tap("onb:lvl:cs:unknown");
    await tap("onb:done");
    await tap("onb:hook:cs:0");

    expect(allText(harness).some((text) => text.includes("неотрецензированная карточка"))).toBe(false);

    const userId = await identityRepository.resolveUserId("telegram", String(id));
    const user = await userRepository.findById(userId!);
    // A failed demo must never strand the user in onboarding.
    expect(user?.onboarded).toBe(true);
    // "I don't know" persisted the B1 default.
    expect(await userRepository.getLanguageLevels(userId!)).toContainEqual({
      languageCode: "cs",
      proficiencyLevel: "B1",
    });
  });

  it("resumes on the furthest screen reached instead of restarting from the native question", async () => {
    const harness = createBotHarness();
    const id = uniqueTelegramId();
    const tap = async (data: string) =>
      harness.dispatch(
        callbackQueryUpdate({ chatId: id, fromId: id, messageId: firstScreenId(harness), data, languageCode: "ru" }),
      );

    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "/start", languageCode: "ru" }));
    await tap("onb:nat:ru");
    await tap("onb:lang:de");
    await tap("onb:lvl:de:C1");

    // A second /start — the old conversation flow restarted from step 1 here.
    harness.reset();
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "/start", languageCode: "ru" }));

    const buttons = visibleCallbacks(harness);
    expect(buttons).not.toContain("onb:nat:ru");
    expect(buttons).toContain("onb:done");
  });
});
