/**
 * AC 6 — one allowance for both channels. With a monthly translation limit of 3,
 * two bot translations and one web translation use it up; the fourth is refused
 * on the web (429) and in the bot (limit notice) alike.
 */
import { settingsAdapter } from "@polyglot/adapter-db";
import { type PlanLimitConfig, SettingsService, t } from "@polyglot/core";
import { describe, expect, it } from "vitest";
import { arrangeOnboardedTranslator } from "../../bot/src/test-helpers/integration/arrange.js";
import { messageUpdate } from "../../bot/src/test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../bot/src/test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../bot/src/test-helpers/integration/translate-ai-mock.js";
import { createWebHarness } from "./test-helpers/web-harness.js";

const LIMIT = 3;
const real = new SettingsService(settingsAdapter);

describe("plan limits, bot and web", () => {
  it("share one monthly translation allowance", async () => {
    const getPlanLimit = async (plan: string): Promise<PlanLimitConfig | null> => {
      const config = await real.getPlanLimit(plan);
      return config ? { ...config, translationLimit: LIMIT } : null;
    };
    const web = await createWebHarness({ ai: deterministicTranslateAi(), settings: { getPlanLimit } });
    const telegramId = uniqueTelegramId();
    await arrangeOnboardedTranslator(telegramId, { nativeLang: "en", learningLangs: ["cs"] });
    const { cookie } = await web.login(telegramId);

    for (const word of ["hello", "house"]) {
      await web.bot.dispatch(messageUpdate({ chatId: telegramId, fromId: telegramId, text: word }));
    }
    expect((await web.call(cookie, "POST", "/api/translate", { text: "water" })).status).toBe(200);

    const refused = await web.call(cookie, "POST", "/api/translate", { text: "bread" });
    expect(refused).toMatchObject({ status: 429, body: { code: "limit", reason: "plan" } });

    web.bot.reset();
    await web.bot.dispatch(messageUpdate({ chatId: telegramId, fromId: telegramId, text: "bread" }));
    const texts = web.bot.sent.map((call) => String(call.payload.text ?? ""));
    expect(texts).toContain(t("rateLimitExceeded", "en"));
  });
});
