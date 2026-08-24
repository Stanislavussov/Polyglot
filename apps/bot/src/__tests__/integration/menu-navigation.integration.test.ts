/**
 * Menu navigation — grammY e2e integration test.
 *
 * The split into hot buttons plus `/menu` is the feature, so the routes it creates are
 * what this drives through the real dispatcher against the real Postgres:
 *
 *  - the three hot buttons reach their modes in one tap;
 *  - `/menu` opens as its own message, and moving between its screens edits that one
 *    message rather than stacking new ones;
 *  - handing off to a feature removes the menu and answers fresh;
 *  - a button left over from a previous keyboard layout still runs its mode instead of
 *    being translated as a word.
 *
 * Every assertion pins a string unique to the screen it claims. The empty-state copy of
 * the dictionary, the deck and the review queue all open with "Your dictionary is empty",
 * so matching that prefix would pass for any of the three and prove no routing at all.
 */
import { userRepository, wordPickerPresetRepository } from "@polyglot/adapter-db";
import { describe, expect, it } from "vitest";
import { arrangeOnboardedTranslator } from "../../test-helpers/integration/arrange.js";
import {
  type CapturedCall,
  callbackQueryUpdate,
  createBotHarness,
  messageUpdate,
} from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../test-helpers/integration/translate-ai-mock.js";
import { buildMainKeyboard } from "../../utils/main-menu.js";

/** Copy unique to one screen, so a misroute cannot satisfy the assertion. */
const ONLY_REVIEW = "come back here for review";
const ONLY_DECK = "Translate some words and save them first";
const ONLY_DICTIONARY = "tap 💾 on the card to add it";
const ONLY_MENTOR = "Mentor mode active";

function sentMessages(sent: CapturedCall[]): CapturedCall[] {
  return sent.filter((call) => call.method === "sendMessage");
}

function texts(sent: CapturedCall[]): string[] {
  return sentMessages(sent).map((call) => String(call.payload.text ?? ""));
}

function said(sent: CapturedCall[], needle: string): boolean {
  return texts(sent).some((text) => text.includes(needle));
}

function inlineButtons(call: CapturedCall | undefined): string[] {
  const markup = call?.payload.reply_markup as
    | { inline_keyboard?: Array<Array<{ callback_data?: string }>> }
    | undefined;
  return (markup?.inline_keyboard ?? [])
    .flat()
    .map((button) => button.callback_data)
    .filter((data): data is string => typeof data === "string");
}

/** The last in-place edit: what the one menu message now shows. */
function lastEdit(sent: CapturedCall[]): { text: string; buttons: string[] } {
  const edit = sent.filter((call) => call.method === "editMessageText").at(-1);
  if (!edit) throw new Error("the menu was never edited in place");
  return { text: String(edit.payload.text ?? ""), buttons: inlineButtons(edit) };
}

/** Hot-button labels read off the keyboard itself, so a relabelling cannot pass silently. */
function hotButton(index: number): string {
  const button = buildMainKeyboard("en").keyboard[0]?.[index];
  if (!button || typeof button === "string") throw new Error(`no hot button at ${index}`);
  return button.text;
}

/** One active angle, so the picker has something to list regardless of what else the shared database holds. */
async function arrangeAngle(slug: string): Promise<void> {
  await wordPickerPresetRepository.create({
    slug,
    emoji: "🕳",
    title: "Menu navigation fixture",
    titleI18n: {},
    prompt: "Words this language lexicalizes as a single unit.",
    learningLangs: [],
    sortOrder: 10,
    isActive: true,
  });
}

async function openMenu(harness: ReturnType<typeof createBotHarness>, id: number): Promise<number> {
  await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "/menu" }));
  const menu = sentMessages(harness.sent).find((call) => inlineButtons(call).includes("menu:learn"));
  if (!menu) throw new Error("/menu sent no menu");
  return menu.messageId ?? 1;
}

describe("menu navigation (integration)", () => {
  it("reaches the deck, the mentor and the dictionary in one tap each", async () => {
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();
    // Pro, because mentor is a paid mode on `develop` (`ensurePaidFeatureForMessage` in
    // mentor.scene.ts, a commit this branch has not merged yet). A subscriber enters the
    // mode with or without that gate, so this assertion survives the merge; a plan-less
    // user would get the upgrade screen once the gate arrives and fail here for a reason
    // that has nothing to do with menu routing.
    const userId = await arrangeOnboardedTranslator(id, { plan: "pro" });

    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: hotButton(0) }));
    expect(said(harness.sent, ONLY_DECK)).toBe(true);

    harness.reset();
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: hotButton(1), messageId: 2 }));
    expect(said(harness.sent, ONLY_MENTOR)).toBe(true);
    expect((await userRepository.getSettings(userId))?.activeMode).toBe("mentor");

    harness.reset();
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: hotButton(2), messageId: 3 }));
    expect(said(harness.sent, ONLY_DICTIONARY)).toBe(true);
  });

  it("opens /menu as its own message listing the four categories", async () => {
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();
    await arrangeOnboardedTranslator(id);

    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "/menu" }));

    const menu = sentMessages(harness.sent).find((call) => inlineButtons(call).includes("menu:learn"));
    if (!menu) throw new Error("/menu sent no menu");
    expect(inlineButtons(menu)).toEqual(["menu:dict", "menu:learn", "menu:settings", "menu:report", "menu:close"]);
  });

  it("navigates between menu screens by editing the one message, not stacking new ones", async () => {
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();
    await arrangeOnboardedTranslator(id);
    const menuId = await openMenu(harness, id);

    // Into the learning hub…
    harness.reset();
    await harness.dispatch(callbackQueryUpdate({ chatId: id, fromId: id, messageId: menuId, data: "menu:learn" }));
    expect(lastEdit(harness.sent).buttons).toEqual([
      "lrn:pick",
      "lrn:cards",
      "lrn:review",
      "lrn:videos",
      "lrn:mentor",
      "menu:root",
    ]);
    expect(sentMessages(harness.sent)).toEqual([]);

    // …and back out, still the same message.
    harness.reset();
    await harness.dispatch(callbackQueryUpdate({ chatId: id, fromId: id, messageId: menuId, data: "menu:root" }));
    expect(lastEdit(harness.sent).buttons).toContain("menu:settings");
    expect(sentMessages(harness.sent)).toEqual([]);
  });

  it("reaches spaced repetition, which had no button anywhere before the hub", async () => {
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();
    await arrangeOnboardedTranslator(id);
    const menuId = await openMenu(harness, id);
    await harness.dispatch(callbackQueryUpdate({ chatId: id, fromId: id, messageId: menuId, data: "menu:learn" }));

    harness.reset();
    await harness.dispatch(callbackQueryUpdate({ chatId: id, fromId: id, messageId: menuId, data: "lrn:review" }));

    // srsNoSavedWords in its own words — the deck and the dictionary say something else.
    expect(said(harness.sent, ONLY_REVIEW)).toBe(true);
    expect(said(harness.sent, ONLY_DECK)).toBe(false);
    expect(said(harness.sent, ONLY_DICTIONARY)).toBe(false);
  });

  it("dismisses the menu when it hands off to a feature", async () => {
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();
    await arrangeOnboardedTranslator(id);
    const menuId = await openMenu(harness, id);

    harness.reset();
    await harness.dispatch(callbackQueryUpdate({ chatId: id, fromId: id, messageId: menuId, data: "menu:dict" }));

    const deleted = harness.sent
      .filter((call) => call.method === "deleteMessage")
      .map((call) => Number((call.payload as { message_id?: number }).message_id));
    expect(deleted).toContain(menuId);
    expect(said(harness.sent, ONLY_DICTIONARY)).toBe(true);
  });

  it("closes the menu without running anything", async () => {
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();
    await arrangeOnboardedTranslator(id);
    const menuId = await openMenu(harness, id);

    harness.reset();
    await harness.dispatch(callbackQueryUpdate({ chatId: id, fromId: id, messageId: menuId, data: "menu:close" }));

    expect(harness.sent.some((call) => call.method === "deleteMessage")).toBe(true);
    expect(sentMessages(harness.sent)).toEqual([]);
  });

  it("still runs the mode behind a button a previous keyboard layout left on screen", async () => {
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();
    await arrangeOnboardedTranslator(id);
    await arrangeAngle(`menu-legacy-${id}`);

    // "✨ Pick" is on every keyboard the bot sent before the hot-button layout. Unmatched,
    // it would fall through to the mode router and come back as a translation of "Pick".
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "✨ Pick" }));

    // The picker's angle list, identified by callback data only it emits. Pinning the
    // buttons rather than the copy keeps this deterministic: the integration database is
    // shared, so whether any preset exists is not this test's to control — it arranges one.
    const list = sentMessages(harness.sent).find((call) =>
      inlineButtons(call).some((data) => data.startsWith("wp:p:")),
    );
    expect(list).toBeDefined();
    // And nothing echoed the label back as a translation. The card wraps its headword in
    // <b> (translation.renderer.ts), which is what makes this a signature rather than a
    // substring — the picker's own "✨ Picking words…" contains the bare text.
    expect(said(harness.sent, "<b>✨ Pick</b>")).toBe(false);
  });

  it("leads from the settings root through the language group and back", async () => {
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();
    await arrangeOnboardedTranslator(id);
    const menuId = await openMenu(harness, id);

    harness.reset();
    await harness.dispatch(callbackQueryUpdate({ chatId: id, fromId: id, messageId: menuId, data: "menu:settings" }));
    expect(lastEdit(harness.sent).buttons).toEqual(["set:lang", "set:notif", "set:tpl", "set:plan", "set:close"]);

    harness.reset();
    await harness.dispatch(callbackQueryUpdate({ chatId: id, fromId: id, messageId: menuId, data: "set:lang" }));
    expect(lastEdit(harness.sent).buttons).toEqual(["set:native", "set:learning", "set:interface", "set:root"]);

    // A picker's Back returns to the group, not past it to the root.
    harness.reset();
    await harness.dispatch(callbackQueryUpdate({ chatId: id, fromId: id, messageId: menuId, data: "set:native" }));
    harness.reset();
    await harness.dispatch(callbackQueryUpdate({ chatId: id, fromId: id, messageId: menuId, data: "set:back" }));
    expect(lastEdit(harness.sent).text).toContain("Languages");
    expect(lastEdit(harness.sent).buttons).toContain("set:root");

    harness.reset();
    await harness.dispatch(callbackQueryUpdate({ chatId: id, fromId: id, messageId: menuId, data: "set:root" }));
    expect(lastEdit(harness.sent).buttons).toContain("set:notif");
  });
});
