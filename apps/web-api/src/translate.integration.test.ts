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

  it("asks about a typo instead of guessing, then translates the answer the user picked", async () => {
    const web = await createWebHarness({
      ai: deterministicTranslateAi({ unrecognizedWord: "helo", suggestedCorrection: "hello" }),
    });
    const telegramId = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(telegramId, { nativeLang: "en", learningLangs: ["cs"] });
    const { cookie } = await web.login(telegramId);

    const asked = await web.call(cookie, "POST", "/api/translate", { text: "helo" });

    expect(asked.status).toBe(422);
    const question = asked.body as {
      code: string;
      message: string;
      sourceLang: string;
      options: { kind: string; correctedText: string | null }[];
    };
    expect(question.code).toBe("needs_clarification");
    expect(question.message).toContain("helo");
    expect(question.options.map((option) => option.kind)).toEqual(["typo_correction", "translate_as_written"]);
    expect(await web.bot.services.vocabularyRepository.findByOriginalAndSource(userId, "helo", 1)).toBeNull();

    const fixed = question.options[0]!.correctedText!;
    const res = await web.call(cookie, "POST", "/api/translate", {
      text: fixed,
      sourceLang: question.sourceLang,
      asWritten: true,
    });

    expect(res.status).toBe(200);
    const body = res.body as { original: string; savedEntryId: number | null };
    expect(body.original).toBe("hello");
    expect((await web.bot.services.vocabularyRepository.findById(body.savedEntryId!))?.original).toBe("hello");
  });

  it("translates the word as written when the user insists", async () => {
    const web = await createWebHarness({ ai: deterministicTranslateAi({ unrecognizedWord: "helo" }) });
    const telegramId = uniqueTelegramId();
    await arrangeOnboardedTranslator(telegramId, { nativeLang: "en", learningLangs: ["cs"] });
    const { cookie } = await web.login(telegramId);

    const res = await web.call(cookie, "POST", "/api/translate", { text: "helo", sourceLang: "en", asWritten: true });

    expect(res.status).toBe(200);
    const body = res.body as { original: string; unverified: boolean };
    expect(body.original).toBe("helo");
    expect(body.unverified).toBe(true);
  });
});
