/**
 * AC 3 — a word translated on the web is saved, and the bot's /review deck then
 * shows it: the web save is the same dictionary row the bot reviews.
 */
import { describe, expect, it } from "vitest";
import { arrangeOnboardedTranslator } from "../../bot/src/test-helpers/integration/arrange.js";
import { messageUpdate } from "../../bot/src/test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../bot/src/test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../bot/src/test-helpers/integration/translate-ai-mock.js";
import { createWebHarness } from "./test-helpers/web-harness.js";

describe("web translate", () => {
  it("saves the translated word where the bot reviews it", async () => {
    const web = await createWebHarness({ ai: deterministicTranslateAi() });
    const telegramId = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(telegramId, { nativeLang: "en", learningLangs: ["cs"] });
    const { cookie } = await web.login(telegramId);

    const res = await web.call(cookie, "POST", "/api/translate", { text: "hello" });

    expect(res.status).toBe(200);
    const body = res.body as { savedEntryId: number | null; translations: { lang: string; text: string }[] };
    expect(body.translations).toContainEqual(expect.objectContaining({ lang: "cs", text: "ahoj" }));
    expect(body.savedEntryId).not.toBeNull();
    expect(
      await web.bot.services.vocabularyDictionaryRepository.entryBelongsToDefault(userId, body.savedEntryId!),
    ).toBe(true);

    web.bot.reset();
    await web.bot.dispatch(messageUpdate({ chatId: telegramId, fromId: telegramId, text: "/review" }));
    const texts = web.bot.sent.map((call) => String(call.payload.text ?? call.payload.caption ?? ""));
    expect(texts.join("\n")).toContain("hello");
  });
});
