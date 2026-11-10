/** AC 5 — a settings change on the web is what the bot reads next (`getSettings(userId)`). */
import { describe, expect, it } from "vitest";
import { arrangeOnboardedTranslator } from "../../bot/src/test-helpers/integration/arrange.js";
import { uniqueTelegramId } from "../../bot/src/test-helpers/integration/id-factory.js";
import { createWebHarness } from "./test-helpers/web-harness.js";

describe("web settings", () => {
  it("writes languages the bot then reads", async () => {
    const web = await createWebHarness();
    const telegramId = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(telegramId, { nativeLang: "en", learningLangs: ["cs"] });
    const { cookie } = await web.login(telegramId);

    const res = await web.call(cookie, "PATCH", "/api/settings", { interfaceLang: "de", learningLangs: ["cs", "de"] });

    expect(res.status).toBe(200);
    const stored = await web.bot.services.userRepository.getSettings(userId);
    expect(stored).toMatchObject({ interfaceLang: "de", nativeLang: "en", learningLangs: ["cs", "de"] });
  });

  it("refuses a learning language equal to the native one", async () => {
    const web = await createWebHarness();
    const telegramId = uniqueTelegramId();
    await arrangeOnboardedTranslator(telegramId, { nativeLang: "en" });
    const { cookie } = await web.login(telegramId);

    expect((await web.call(cookie, "PATCH", "/api/settings", { learningLangs: ["en"] })).status).toBe(400);
  });

  it("turns a card-front aid on and off, the same choice the bot's card settings read", async () => {
    const web = await createWebHarness();
    const telegramId = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(telegramId, { nativeLang: "en", learningLangs: ["cs"] });
    const { cookie } = await web.login(telegramId);

    const before = await web.call(cookie, "GET", "/api/settings/card");
    expect(before.status).toBe(200);
    expect(before.body).toEqual({ synonyms: true, example: false, hint: false });

    const res = await web.call(cookie, "PATCH", "/api/settings/card", { field: "hint", enabled: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ synonyms: true, example: false, hint: true });
    expect(await web.bot.services.cardTemplateRepository.getFields(userId)).toMatchObject({ hint: true });
  });

  it("refuses an unknown card-front aid", async () => {
    const web = await createWebHarness();
    const telegramId = uniqueTelegramId();
    await arrangeOnboardedTranslator(telegramId, { nativeLang: "en" });
    const { cookie } = await web.login(telegramId);

    const res = await web.call(cookie, "PATCH", "/api/settings/card", { field: "translation", enabled: true });
    expect(res.status).toBe(400);
  });
});
