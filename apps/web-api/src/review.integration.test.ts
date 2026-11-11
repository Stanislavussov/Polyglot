/** AC 4 — a rating on the web writes the SM-2 schedule the bot's deck reads. */
import { getDb, getLang, vocabularyRepository } from "@polyglot/adapter-db";
import { describe, expect, it, vi } from "vitest";
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

    const next = (await web.call(cookie, "GET", "/api/review/next")).body as { card: unknown };
    expect(next.card).toMatchObject({
      entryId: entry.id,
      ahead: false,
      // A word saved without source usage has none of the aids, so the settings panel greys them out.
      front: { headword: "pes", available: { hint: false, synonyms: false, example: false } },
      detail: { original: "pes", details: [{ lang: "en", text: "dog" }] },
    });

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

const AUDIO = new Uint8Array([0x49, 0x44, 0x33, 0x04]);
let ttsModelSeq = 0;

/** A Czech word saved for an English speaker who learns Czech: only "pes" is speakable. */
async function arrangeSpeakableWord(plan: string) {
  ttsModelSeq += 1;
  const tts = { enabled: true, modelId: `test/web-tts-${process.pid}-${ttsModelSeq}`, voice: "eve", maxChars: 200 };
  const generateSpeech = vi.fn().mockResolvedValue({ bytes: AUDIO, generationId: "gen-web-tts" });
  const web = await createWebHarness({
    ai: { generateSpeech },
    settings: { getTtsConfig: vi.fn().mockResolvedValue(tts) },
  });
  const telegramId = uniqueTelegramId();
  const userId = await arrangeOnboardedTranslator(telegramId, { plan });
  const entry = await vocabularyRepository.create(userId, {
    original: "pes",
    sourceLangId: getLang("cs")!.id,
    inputType: "word",
    unverified: false,
    translations: [{ targetLangId: getLang("en")!.id, text: "dog", details: { synonyms: [], examples: [] } }],
  });
  const { cookie } = await web.login(telegramId);
  return { web, cookie, entry, generateSpeech, tts };
}

describe("web review card voice-over", () => {
  it("offers the learning-language word, never the native one, and speaks it for Pro", async () => {
    const { web, cookie, entry, generateSpeech, tts } = await arrangeSpeakableWord("pro");

    const card = (await web.call(cookie, "GET", `/api/review/card/${entry.id}`)).body as {
      card: { audio: { langs: string[]; access: string } };
    };
    expect(card.card.audio).toEqual({ langs: ["cs"], access: "ok" });

    const played = await web.app.inject({
      method: "GET",
      url: `/api/dictionary/${entry.id}/audio/cs`,
      headers: { cookie },
    });
    expect(played.statusCode).toBe(200);
    expect(played.headers["content-type"]).toBe("audio/mpeg");
    expect(new Uint8Array(played.rawPayload)).toEqual(AUDIO);
    expect(generateSpeech).toHaveBeenCalledWith(expect.objectContaining({ text: "pes", modelId: tts.modelId }));

    // A replay is served from memory: synthesis is paid for once.
    await web.app.inject({ method: "GET", url: `/api/dictionary/${entry.id}/audio/cs`, headers: { cookie } });
    expect(generateSpeech).toHaveBeenCalledTimes(1);

    const native = await web.app.inject({
      method: "GET",
      url: `/api/dictionary/${entry.id}/audio/en`,
      headers: { cookie },
    });
    expect(native.statusCode).toBe(404);
  });

  it("locks voice-over for Free without calling the speech model", async () => {
    const { web, cookie, entry, generateSpeech } = await arrangeSpeakableWord("free");

    const card = (await web.call(cookie, "GET", `/api/review/card/${entry.id}`)).body as {
      card: { audio: { access: string } };
    };
    expect(card.card.audio.access).toBe("locked");
    const played = await web.call(cookie, "GET", `/api/dictionary/${entry.id}/audio/cs`);
    expect(played).toMatchObject({ status: 403, body: { code: "locked" } });
    expect(generateSpeech).not.toHaveBeenCalled();
  });

  it("marks speakable words on the dictionary page with the learner's voice-over access", async () => {
    const { web, cookie, entry } = await arrangeSpeakableWord("pro");

    const page = (await web.call(cookie, "GET", "/api/dictionary")).body as {
      audio: string;
      items: { id: number; speakLangs: string[] }[];
    };
    expect(page.audio).toBe("ok");
    // The learning-language word speaks; the native "dog" does not.
    expect(page.items.find((item) => item.id === entry.id)?.speakLangs).toEqual(["cs"]);
  });
});
