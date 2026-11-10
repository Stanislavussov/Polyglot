/** The web translate screen waits with the same phrases as the bot's loader. */
import { loaderEmoji, waitPhrases } from "@polyglot/core";
import { describe, expect, it } from "vitest";
import { arrangeOnboardedTranslator } from "../../bot/src/test-helpers/integration/arrange.js";
import { uniqueTelegramId } from "../../bot/src/test-helpers/integration/id-factory.js";
import { createWebHarness } from "./test-helpers/web-harness.js";

interface LoaderBody {
  emoji: string[];
  stages: string[][];
}

describe("web translate loader", () => {
  it("speaks the learner's learning languages, stage by stage", async () => {
    const web = await createWebHarness();
    const telegramId = uniqueTelegramId();
    await arrangeOnboardedTranslator(telegramId, { nativeLang: "en", learningLangs: ["de", "cs"] });
    const { cookie } = await web.login(telegramId);

    const res = await web.call(cookie, "GET", "/api/loader/translate");

    expect(res.status).toBe(200);
    const body = res.body as LoaderBody;
    expect(body.emoji).toEqual([...loaderEmoji("translate")]);
    expect(body.stages[0]).toEqual([...waitPhrases("de", 0), ...waitPhrases("cs", 0)]);
    expect(body.stages.at(-1)).toEqual([...waitPhrases("de", 5), ...waitPhrases("cs", 5)]);
  });

  it("rejects an unknown loader kind", async () => {
    const web = await createWebHarness();
    const telegramId = uniqueTelegramId();
    await arrangeOnboardedTranslator(telegramId, { nativeLang: "en" });
    const { cookie } = await web.login(telegramId);

    expect((await web.call(cookie, "GET", "/api/loader/nope")).status).toBe(404);
  });
});
