/**
 * First login on the web for someone who never opened the bot — the bot's onboarding:
 * native language → learning languages → demo on a hook word → done.
 * - the step is stored in the same `onboarding_step` the bot uses (1, 2, 3);
 * - reaching the demo grants the onboarding trial once, as the bot does;
 * - completing marks the account onboarded, so the bot skips its own onboarding.
 */
import { describe, expect, it } from "vitest";
import { uniqueTelegramId } from "../../bot/src/test-helpers/integration/id-factory.js";
import { createWebHarness } from "./test-helpers/web-harness.js";

describe("web onboarding", () => {
  it("walks a new learner through languages and a demo word, then marks them onboarded", async () => {
    const web = await createWebHarness();
    const telegramId = uniqueTelegramId();
    const login = await web.login(telegramId);
    const me = login.body as { id: number; onboarded: boolean };
    expect(me.onboarded).toBe(false);
    const call = (method: "GET" | "POST" | "PATCH", url: string, payload?: unknown) =>
      web.call(login.cookie, method, url, payload);
    const users = web.bot.services.userRepository;

    expect((await call("POST", "/api/onboarding/step", { step: "native" })).status).toBe(204);
    expect((await call("PATCH", "/api/settings", { nativeLang: "en", interfaceLang: "en" })).status).toBe(200);
    expect((await call("POST", "/api/onboarding/step", { step: "languages" })).status).toBe(204);
    expect((await call("PATCH", "/api/settings", { learningLangs: ["de"] })).status).toBe(200);
    expect((await users.findById(me.id))?.onboardingStep).toBe(2);

    const raw = await call("GET", "/api/onboarding");
    const status = raw.body as { hookWords: Record<string, string[]> };
    expect(status.hookWords.de).toHaveLength(3);

    expect((await call("POST", "/api/onboarding/step", { step: "demo" })).status).toBe(204);
    expect((await call("POST", "/api/onboarding/step", { step: "bogus" })).status).toBe(400);

    const done = await call("POST", "/api/onboarding/complete");
    expect(done).toMatchObject({ status: 200, body: { trial: { days: 7 } } });
    expect((await users.findById(me.id))?.onboarded).toBe(true);
    expect((await call("GET", "/api/me")).body).toMatchObject({ onboarded: true });
  });
});
