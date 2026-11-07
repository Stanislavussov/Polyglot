/**
 * The web runs the bot's translation process (core `runTranslation`): the same
 * input rules, the same language questions, and the quota gate after both.
 */
import { settingsAdapter } from "@polyglot/adapter-db";
import { type PlanLimitConfig, SettingsService } from "@polyglot/core";
import { describe, expect, it } from "vitest";
import { arrangeOnboardedTranslator } from "../../bot/src/test-helpers/integration/arrange.js";
import { uniqueTelegramId } from "../../bot/src/test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../bot/src/test-helpers/integration/translate-ai-mock.js";
import { createWebHarness } from "./test-helpers/web-harness.js";

const real = new SettingsService(settingsAdapter);

async function signedIn(options: Parameters<typeof createWebHarness>[0] = {}) {
  const web = await createWebHarness({ ai: deterministicTranslateAi(), ...options });
  const telegramId = uniqueTelegramId();
  await arrangeOnboardedTranslator(telegramId, { nativeLang: "en", learningLangs: ["cs"] });
  const { cookie } = await web.login(telegramId);
  return { web, cookie };
}

describe("web translate flow", () => {
  it("asks which language an ambiguous word is in, then translates the answer", async () => {
    // The AI cannot name a language, so only the dictionary hits in en and cs decide — a tie.
    const { web, cookie } = await signedIn({
      ai: { ...deterministicTranslateAi(), generateText: async () => "unknown" },
    });
    web.bot.services.wordLanguageSweep = async () => ["en", "cs"];

    const asked = await web.call(cookie, "POST", "/api/translate", { text: "hotel" });

    expect(asked.status).toBe(422);
    const question = asked.body as { code: string; kind: string; languages: string[] };
    expect(question).toMatchObject({ code: "needs_language", kind: "ambiguous" });
    expect([...question.languages].sort()).toEqual(["cs", "en"]);

    const res = await web.call(cookie, "POST", "/api/translate", { text: "hotel", sourceLang: "en" });

    expect(res.status).toBe(200);
    const body = res.body as { sourceLang: string; savedEntryId: number | null };
    expect(body.sourceLang).toBe("en");
    expect(body.savedEntryId).not.toBeNull();
  });

  it("offers to add a language the user does not study instead of mistranslating", async () => {
    const { web, cookie } = await signedIn();

    const res = await web.call(cookie, "POST", "/api/translate", { text: "mañana" });

    expect(res).toMatchObject({ status: 422, body: { code: "add_language", lang: "es", supported: true } });
  });

  it("rejects text it cannot translate with the reason", async () => {
    const { web, cookie } = await signedIn();

    expect(await web.call(cookie, "POST", "/api/translate", { text: "😀" })).toMatchObject({
      status: 422,
      body: { code: "rejected", reason: "emoji" },
    });
    expect(await web.call(cookie, "POST", "/api/translate", { text: "a".repeat(501) })).toMatchObject({
      status: 422,
      body: { code: "rejected", reason: "tooLong", maxLength: 500 },
    });
  });

  it("validates the text and the language before the exhausted quota", async () => {
    const getPlanLimit = async (plan: string): Promise<PlanLimitConfig | null> => {
      const config = await real.getPlanLimit(plan);
      return config ? { ...config, translationLimit: 0 } : null;
    };
    const { web, cookie } = await signedIn({ settings: { getPlanLimit } });

    expect((await web.call(cookie, "POST", "/api/translate", { text: "😀" })).body).toMatchObject({
      code: "rejected",
    });
    expect((await web.call(cookie, "POST", "/api/translate", { text: "mañana" })).body).toMatchObject({
      code: "add_language",
    });
    expect(await web.call(cookie, "POST", "/api/translate", { text: "hello" })).toMatchObject({
      status: 429,
      body: { code: "limit", reason: "plan" },
    });
  });
});
