/** AC 4 — a rating on the web writes the SM-2 schedule the bot's deck reads. */
import { getDb, getLang, vocabularyRepository } from "@polyglot/adapter-db";
import { describe, expect, it } from "vitest";
import { arrangeOnboardedTranslator } from "../../bot/src/test-helpers/integration/arrange.js";
import { uniqueTelegramId } from "../../bot/src/test-helpers/integration/id-factory.js";
import { createWebHarness } from "./test-helpers/web-harness.js";

const PAST = new Date("2020-01-01T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

describe("web review", () => {
  it("reschedules a due card exactly as SM-2 does and logs the review", async () => {
    const web = await createWebHarness();
    const telegramId = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(telegramId);
    const entry = await vocabularyRepository.create(userId, {
      original: "pes",
      sourceLangId: getLang("cs")!.id,
      inputType: "word",
      unverified: false,
      translations: [{ targetLangId: getLang("en")!.id, text: "dog", details: { synonyms: [], examples: [] } }],
    });
    const translationId = (entry as unknown as { translations: { id: number }[] }).translations[0]!.id;
    await vocabularyRepository.updateSrsState(translationId, {
      easeFactor: 2.5,
      interval: 6,
      dueDate: PAST,
      reviewCount: 2,
    });
    const { cookie } = await web.login(telegramId);

    const next = (await web.call(cookie, "GET", "/api/review/next")).body as {
      card: { entryId: number; back: unknown[] };
    };
    expect(next.card).toMatchObject({ entryId: entry.id, back: [{ lang: "en", text: "dog" }] });

    const before = Date.now();
    const rated = await web.call(cookie, "POST", `/api/review/${entry.id}`, { rating: "good" });
    expect(rated.status).toBe(200);

    const [row] = await vocabularyRepository.findEntrySrsRows(userId, entry.id);
    // SM-2 good on the third review: interval = round(6 × 2.5) = 15 days.
    expect(row).toMatchObject({ srsInterval: 15, srsReviewCount: 3 });
    expect(row!.srsDueDate!.getTime()).toBeGreaterThan(before + 14 * DAY_MS);
    const log = await getDb().$client<Array<{ session_type: string }>>`
      select session_type from word_review_log where entry_id = ${entry.id}
    `;
    expect(log.map((r) => r.session_type)).toEqual(["web"]);
  });

  it("answers 404 for another user's entry", async () => {
    const web = await createWebHarness();
    const owner = await arrangeOnboardedTranslator(uniqueTelegramId());
    const entry = await vocabularyRepository.create(owner, {
      original: "kočka",
      sourceLangId: getLang("cs")!.id,
      inputType: "word",
      unverified: false,
      translations: [{ targetLangId: getLang("en")!.id, text: "cat", details: { synonyms: [], examples: [] } }],
    });
    const intruder = uniqueTelegramId();
    await arrangeOnboardedTranslator(intruder);
    const { cookie } = await web.login(intruder);

    expect((await web.call(cookie, "POST", `/api/review/${entry.id}`, { rating: "easy" })).status).toBe(404);
  });
});
