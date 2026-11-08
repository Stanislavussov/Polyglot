/**
 * A word translated on the web is saved only by its Save button, as in the bot, and
 * the bot's /review deck then shows it: the web save is the same dictionary row.
 */
import { getDb } from "@polyglot/adapter-db";
import { describe, expect, it } from "vitest";
import { arrangeOnboardedTranslator } from "../../bot/src/test-helpers/integration/arrange.js";
import { messageUpdate } from "../../bot/src/test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../bot/src/test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../bot/src/test-helpers/integration/translate-ai-mock.js";
import { createWebHarness } from "./test-helpers/web-harness.js";

async function momentumRows(userId: number): Promise<{ kind: string; dedupe_key: string }[]> {
  return getDb().$client<{ kind: string; dedupe_key: string }[]>`
    select kind, dedupe_key from momentum_events where user_id = ${userId} order by id asc
  `;
}

async function momentumKinds(userId: number): Promise<string[]> {
  return (await momentumRows(userId)).map((row) => row.kind);
}

async function momentumSaveKeys(userId: number): Promise<string[]> {
  return (await momentumRows(userId)).filter((row) => row.kind === "save").map((row) => row.dedupe_key);
}

describe("web translate", () => {
  it("translates without saving, and the Save button puts the word where the bot reviews it", async () => {
    const web = await createWebHarness({ ai: deterministicTranslateAi() });
    const telegramId = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(telegramId, { nativeLang: "en", learningLangs: ["cs"] });
    const { cookie } = await web.login(telegramId);

    const res = await web.call(cookie, "POST", "/api/translate", { text: "hello" });

    expect(res.status).toBe(200);
    const body = res.body as {
      savedEntryId: number | null;
      saveToken: string | null;
      translations: { lang: string; text: string }[];
    };
    expect(body.translations).toContainEqual(expect.objectContaining({ lang: "cs", text: "ahoj" }));
    expect(body.savedEntryId).toBeNull();
    expect(body.saveToken).toEqual(expect.any(String));
    expect(await web.bot.services.vocabularyRepository.countByUser(userId)).toBe(0);
    expect((await momentumKinds(userId)).filter((kind) => kind === "save")).toEqual([]);

    const first = await web.call(cookie, "POST", "/api/translate/save", { token: body.saveToken });
    const second = await web.call(cookie, "POST", "/api/translate/save", { token: body.saveToken });

    expect(first.status).toBe(200);
    const { entryId } = first.body as { entryId: number };
    expect(second.body).toEqual({ entryId });
    expect(await web.bot.services.vocabularyRepository.countByUser(userId)).toBe(1);
    expect(await web.bot.services.vocabularyDictionaryRepository.entryBelongsToDefault(userId, entryId)).toBe(true);
    expect(await momentumSaveKeys(userId)).toEqual([`save:${entryId}`]);

    const again = (await web.call(cookie, "POST", "/api/translate", { text: "hello" })).body as {
      savedEntryId: number | null;
    };
    expect(again.savedEntryId).toBe(entryId);

    web.bot.reset();
    await web.bot.dispatch(messageUpdate({ chatId: telegramId, fromId: telegramId, text: "/review" }));
    const texts = web.bot.sent.map((call) => String(call.payload.text ?? call.payload.caption ?? ""));
    expect(texts.join("\n")).toContain("hello");
  });

  it("refuses a save token that was tampered with or belongs to someone else", async () => {
    const web = await createWebHarness({ ai: deterministicTranslateAi() });
    const owner = uniqueTelegramId();
    const other = uniqueTelegramId();
    await arrangeOnboardedTranslator(owner, { nativeLang: "en", learningLangs: ["cs"] });
    const otherId = await arrangeOnboardedTranslator(other, { nativeLang: "en", learningLangs: ["cs"] });
    const ownerSession = await web.login(owner);
    const otherSession = await web.login(other);
    const { saveToken } = (await web.call(ownerSession.cookie, "POST", "/api/translate", { text: "hello" })).body as {
      saveToken: string;
    };

    expect((await web.call(otherSession.cookie, "POST", "/api/translate/save", { token: saveToken })).status).toBe(403);
    expect(
      (await web.call(ownerSession.cookie, "POST", "/api/translate/save", { token: `${saveToken}x` })).status,
    ).toBe(403);
    expect(await web.bot.services.vocabularyRepository.countByUser(otherId)).toBe(0);
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
    const body = res.body as { original: string; saveToken: string };
    expect(body.original).toBe("hello");
    const saved = (await web.call(cookie, "POST", "/api/translate/save", { token: body.saveToken })).body as {
      entryId: number;
    };
    expect((await web.bot.services.vocabularyRepository.findById(saved.entryId))?.original).toBe("hello");
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
