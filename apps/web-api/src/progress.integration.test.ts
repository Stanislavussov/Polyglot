/**
 * Momentum on the web, as in the bot (Task 81):
 * - a web translation credits `translate:<requestId>`, its auto-save `save:<entryId>`,
 *   a web rating `review:<entryId>:<day>` — the bot's keys, one journal;
 * - GET /api/progress is the bot's /progress screen in the learner's language.
 */
import { getDb } from "@polyglot/adapter-db";
import { DEFAULT_MOTIVATION_CONFIG } from "@polyglot/core";
import { describe, expect, it } from "vitest";
import { arrangeOnboardedTranslator } from "../../bot/src/test-helpers/integration/arrange.js";
import { uniqueTelegramId } from "../../bot/src/test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../bot/src/test-helpers/integration/translate-ai-mock.js";
import { createWebHarness } from "./test-helpers/web-harness.js";

function momentumKeys(userId: number): Promise<{ kind: string; dedupe_key: string }[]> {
  return getDb().$client<{ kind: string; dedupe_key: string }[]>`
    select kind, dedupe_key from momentum_events where user_id = ${userId} order by id asc
  `;
}

describe("web momentum", () => {
  it("credits translate, save and review, and shows the progress screen", async () => {
    const web = await createWebHarness({
      ai: deterministicTranslateAi(),
      settings: { getMotivationConfig: async () => ({ ...DEFAULT_MOTIVATION_CONFIG, enabled: true }) },
    });
    const telegramId = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(telegramId, { nativeLang: "en", learningLangs: ["cs"] });
    const { cookie } = await web.login(telegramId);

    const empty = await web.call(cookie, "GET", "/api/progress");
    expect(empty).toMatchObject({ status: 200, body: { enabled: true, stats: [] } });

    const translated = (await web.call(cookie, "POST", "/api/translate", { text: "hello" })).body as {
      savedEntryId: number;
    };
    expect((await web.call(cookie, "POST", `/api/review/${translated.savedEntryId}`, { rating: "good" })).status).toBe(
      200,
    );

    const keys = await momentumKeys(userId);
    expect(keys.map((k) => k.kind)).toEqual(["translate", "save", "review"]);
    expect(keys[1]!.dedupe_key).toBe(`save:${translated.savedEntryId}`);
    expect(keys[2]!.dedupe_key).toMatch(new RegExp(`^review:${translated.savedEntryId}:`));

    const progress = await web.call(cookie, "GET", "/api/progress");
    expect(progress.status).toBe(200);
    const body = progress.body as { stats: string[]; level: number; title: string };
    expect(body.title).toContain("progress");
    expect(body.stats[0]).toContain("1");
    expect(body.level).toBeGreaterThanOrEqual(1);
  });
});
