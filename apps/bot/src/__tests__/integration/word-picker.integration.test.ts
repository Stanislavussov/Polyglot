/**
 * Word picker — grammY e2e integration test.
 *
 * Drives the whole feature through the real dispatcher against the real Postgres:
 * the menu route that opens the angle list, the tap on an angle that generates a set,
 * and the save that puts an item in the learner's dictionary. Only the AI boundary is
 * a deterministic mock.
 */
import {
  getLang,
  vocabularyRepository,
  wordPickerPresetRepository,
  wordPickerRunRepository,
} from "@polyglot/adapter-db";
import type { AIPort } from "@polyglot/core";
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

const PICKED_WORDS = ["prozvonit", "vyzvánět"];

/** The picker fixture first; anything else falls through to the translate fixtures. */
function pickerAi(): Partial<AIPort> {
  const translate = deterministicTranslateAi();
  const generateObject: AIPort["generateObject"] = async (prompt, schema, model, options) => {
    const parsed = schema.safeParse({
      items: PICKED_WORDS.map((word) => ({
        word,
        nativeTranslation: `${word} translated`,
        emoji: "📞",
        type: "word",
        level: "B2",
        exampleTarget: `${word} v větě`,
        exampleNative: "in a sentence",
        note: "no single English word for this",
      })),
    });
    if (parsed.success) return parsed.data;
    if (!translate.generateObject) throw new Error("translate mock lost its generateObject");
    return translate.generateObject(prompt, schema, model, options);
  };
  return { ...translate, generateObject };
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

function sentMessages(sent: CapturedCall[]): CapturedCall[] {
  return sent.filter((call) => call.method === "sendMessage");
}

/**
 * The learner's real route into the picker: /menu → 🎓 Learning → ✨ Pick.
 * Resets the harness so the caller sees only what the picker itself sent.
 */
async function openPicker(harness: ReturnType<typeof createBotHarness>, id: number): Promise<void> {
  await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "/menu" }));
  const menu = sentMessages(harness.sent).find((call) => inlineButtons(call).includes("menu:learn"));
  if (!menu) throw new Error("/menu sent no menu");
  const menuId = menu.messageId ?? 1;

  await harness.dispatch(callbackQueryUpdate({ chatId: id, fromId: id, messageId: menuId, data: "menu:learn" }));
  harness.reset();
  await harness.dispatch(callbackQueryUpdate({ chatId: id, fromId: id, messageId: menuId, data: "lrn:pick" }));
}

async function arrangeAngle(slug: string): Promise<number> {
  const preset = await wordPickerPresetRepository.create({
    slug,
    emoji: "🕳",
    title: "No word for this at home",
    titleI18n: {},
    prompt: "Pick words that this language lexicalizes as a single unit while English needs a whole phrase.",
    learningLangs: [],
    sortOrder: 10,
    isActive: true,
  });
  return preset.id;
}

describe("word picker (integration)", () => {
  it("takes a learner from the menu tap to a saved word", async () => {
    const harness = createBotHarness({ ai: pickerAi() });
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id, { nativeLang: "en", learningLangs: ["cs"] });
    const presetId = await arrangeAngle(`test-angle-${id}`);

    // Act 1: the menu route opens the angle list.
    await openPicker(harness, id);

    const listCall = sentMessages(harness.sent).find((call) =>
      inlineButtons(call).some((data) => data.startsWith("wp:p:")),
    );
    if (!listCall) throw new Error("the angle list was never sent");
    expect(inlineButtons(listCall)).toContain(`wp:p:${presetId}`);

    // Act 2: tapping the angle generates a set. One learning language means the
    // language chooser is skipped entirely.
    harness.reset();
    await harness.dispatch(
      callbackQueryUpdate({ chatId: id, fromId: id, messageId: listCall.messageId ?? 1, data: `wp:p:${presetId}` }),
    );

    const setCall = sentMessages(harness.sent).find((call) =>
      inlineButtons(call).some((data) => data.startsWith("wp:s:")),
    );
    if (!setCall) throw new Error("no word set was sent");
    expect(String(setCall.payload.text)).toContain(PICKED_WORDS[0]);
    expect(String(setCall.payload.text)).toContain("no single English word for this");
    expect(inlineButtons(setCall)).toEqual(expect.arrayContaining([expect.stringMatching(/^wp:sa:/), "wp:close"]));

    const saveButton = inlineButtons(setCall).find((data) => data.startsWith("wp:s:"));
    if (!saveButton) throw new Error("the set carried no save button");

    // Act 3: saving an item puts it in the dictionary and marks it on the set.
    harness.reset();
    await harness.dispatch(
      callbackQueryUpdate({ chatId: id, fromId: id, messageId: setCall.messageId ?? 1, data: saveButton }),
    );

    const czech = getLang("cs");
    if (!czech) throw new Error("language cache is not loaded (cs missing)");
    const saved = await vocabularyRepository.findByOriginalAndSource(userId, PICKED_WORDS[0]!, czech.id);
    expect(saved).not.toBeNull();

    const itemId = Number(saveButton.split(":")[2]);
    const item = await wordPickerRunRepository.findItemById(itemId);
    expect(item?.savedEntryId).toBe(saved?.id);
  });

  it("does not offer a word the learner has already been shown for this angle", async () => {
    const harness = createBotHarness({ ai: pickerAi() });
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id, { nativeLang: "en", learningLangs: ["cs"] });
    const presetId = await arrangeAngle(`test-angle-repeat-${id}`);

    await openPicker(harness, id);
    const listCall = sentMessages(harness.sent).find((call) =>
      inlineButtons(call).some((data) => data.startsWith("wp:p:")),
    );
    if (!listCall) throw new Error("the angle list was never sent");

    await harness.dispatch(
      callbackQueryUpdate({ chatId: id, fromId: id, messageId: listCall.messageId ?? 1, data: `wp:p:${presetId}` }),
    );

    const firstSet = sentMessages(harness.sent).find((call) =>
      inlineButtons(call).some((data) => data.startsWith("wp:s:")),
    );
    if (!firstSet) throw new Error("no word set was sent");
    const runId = Number(
      inlineButtons(firstSet)
        .find((data) => data.startsWith("wp:sa:"))
        ?.split(":")[2],
    );

    // Act: "more words" with the model still offering the same two words — every
    // one of them is already on screen, so the user is told so instead of being
    // handed the same set twice.
    harness.reset();
    await harness.dispatch(
      callbackQueryUpdate({ chatId: id, fromId: id, messageId: firstSet.messageId ?? 1, data: `wp:m:${runId}` }),
    );

    const texts = sentMessages(harness.sent).map((call) => String(call.payload.text));
    expect(texts.some((text) => text.includes("Nothing new left in this area"))).toBe(true);
    expect(
      sentMessages(harness.sent).some((call) => inlineButtons(call).some((data) => data.startsWith("wp:s:"))),
    ).toBe(false);

    const runs = await wordPickerRunRepository.findWordsShownTo(userId, presetId, "cs");
    expect(runs).toEqual(expect.arrayContaining(PICKED_WORDS));
  });
});
