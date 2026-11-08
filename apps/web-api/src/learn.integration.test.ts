/**
 * Spec — the bot's 🎓 Learning modes on the web, same gates, quotas and billing:
 *
 * 1. Mentor chat answers a question with the client-held thread, bills one "[mentor]"
 *    row, refuses Free with 403 feature_locked and stops at the plan's daily cap (429).
 * 2. Grammar check returns each mistake with its localized category, bills one
 *    "[grammarCheck]" row, stops at the plan's daily cap (Free: 5) with 429
 *    grammar_limit, and an out-of-set text spends credits but no daily check.
 * 3. Expressions returns a generated expression and bills "[expression]"; an exhausted
 *    credit meter refuses with 429 limit before any AI call.
 * 4. Word picker lists the angles for the learner's languages, generates a set,
 *    saves an item into the dictionary (idempotently) and saves the rest at once;
 *    another user's set is not theirs to save.
 * 5. Videos: a plan with no allowance is refused (429 video_limit) — except a curated
 *    starter video, which a Free user gets once as a trial; confirm bills "[video]",
 *    the extraction completes in the background, and a phrase saves into the dictionary.
 */
import { getLang, vocabularyRepository, wordPickerPresetRepository } from "@polyglot/adapter-db";
import { fetchMetadata, fetchTranscript } from "@polyglot/adapter-youtube";
import { type AIPort, getVideoSuggestionsForLangs, grammarCheckResultSchema } from "@polyglot/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { arrangeOnboardedTranslator } from "../../bot/src/test-helpers/integration/arrange.js";
import { uniqueTelegramId } from "../../bot/src/test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../bot/src/test-helpers/integration/translate-ai-mock.js";
import { createWebHarness } from "./test-helpers/web-harness.js";

vi.mock("@polyglot/adapter-youtube", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@polyglot/adapter-youtube")>()),
  fetchMetadata: vi.fn(),
  fetchTranscript: vi.fn(),
}));

const MISTAKE = {
  fragment: "do škola",
  correction: "do školy",
  category: "agreement",
  explanation: "After do the noun takes the genitive.",
  example: "Jdu do obchodu.",
};
const GOLDFISH = {
  expression: "Be a goldfish",
  meaning: "Forget a mistake quickly and move on.",
  sourceKind: "series",
  sourceTitle: "Ted Lasso",
  example: "Missed the penalty? Be a goldfish.",
};
const PICKED = ["prozvonit", "vyzvánět"].map((word) => ({
  word,
  nativeTranslation: `${word} translated`,
  emoji: "📞",
  type: "word",
  level: "B2",
  exampleTarget: `${word} v větě`,
  exampleNative: "in a sentence",
  note: "no single English word for this",
}));
const EXTRACTED = {
  phrases: [
    {
      phrase: "nice phrase",
      nativeTranslation: "pěkná fráze",
      emoji: "✨",
      type: "phrase",
      level: "B1",
      context: "what a nice phrase",
      timestampSeconds: 6,
    },
  ],
};

/** Each practice's fixture by schema; anything else (a saved item's enrichment) falls through to translate. */
function learnAi(detectedLanguage = "cs") {
  const translate = deterministicTranslateAi();
  const calls: string[] = [];
  const generateObject: AIPort["generateObject"] = async (prompt, schema, model, options) => {
    if (schema === grammarCheckResultSchema) {
      calls.push("grammar");
      return schema.parse({
        detectedLanguage,
        errors: [MISTAKE],
        correctedText: "Jdu do školy.",
        naturalAlternative: null,
      });
    }
    for (const [name, fixture] of [
      ["expression", GOLDFISH],
      ["pick", { items: PICKED }],
      ["video", EXTRACTED],
    ] as const) {
      const parsed = schema.safeParse(fixture);
      if (parsed.success) {
        calls.push(name);
        return parsed.data;
      }
    }
    return translate.generateObject!(prompt, schema, model, options);
  };
  const generateChat = vi.fn().mockResolvedValue("Use <b>do</b> with the genitive.");
  return { ai: { ...translate, generateObject, generateChat }, calls, generateChat };
}

async function arrange(plan?: string, detectedLanguage?: string) {
  const fixture = learnAi(detectedLanguage);
  const web = await createWebHarness({
    ai: fixture.ai,
    settings: {
      getVideoVocabularyConfig: vi
        .fn()
        .mockResolvedValue({ monthlyLimit: 10, minPhrases: 1, maxPhrases: 5, extractionModelId: "test/extract" }),
    },
  });
  const telegramId = uniqueTelegramId();
  const userId = await arrangeOnboardedTranslator(telegramId, {
    nativeLang: "en",
    learningLangs: ["cs"],
    ...(plan ? { plan } : {}),
  });
  const { cookie } = await web.login(telegramId);
  const ledger = web.bot.services.translationRequestRepository;
  const billed = (tag: string) => ledger.countRequestsInWindow(userId, tag, new Date(0));
  return { web, cookie, userId, ...fixture, ledger, billed };
}

beforeEach(() => {
  vi.mocked(fetchMetadata).mockReset();
  vi.mocked(fetchTranscript).mockReset();
});

describe("web mentor chat", () => {
  it("answers with the client-held thread and bills one mentor turn", async () => {
    const { web, cookie, generateChat, billed } = await arrange("plus");

    const res = await web.call(cookie, "POST", "/api/mentor/chat", {
      question: "And in writing?",
      history: [
        { role: "user", content: "Is 'do školy' right?" },
        { role: "assistant", content: "Yes." },
      ],
    });

    expect(res).toEqual({
      status: 200,
      body: { question: "And in writing?", answer: "Use <b>do</b> with the genitive." },
    });
    const turns = generateChat.mock.calls[0]![0] as { role: string; content: string }[];
    expect(turns.map((turn) => turn.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(turns.at(-1)).toEqual({ role: "user", content: "And in writing?" });
    expect(await billed("[mentor]")).toBe(1);
  });

  it("refuses Free, and stops a paid plan at its daily cap without calling the AI", async () => {
    const free = await arrange();
    expect(await free.web.call(free.cookie, "POST", "/api/mentor/chat", { question: "Hi?" })).toEqual({
      status: 403,
      body: { code: "feature_locked", feature: "mentor" },
    });

    const plus = await arrange("plus");
    for (let turn = 0; turn < 30; turn += 1)
      await plus.ledger.logTranslationRequest(plus.userId, "[mentor]", null, [], 0);
    expect(await plus.web.call(plus.cookie, "POST", "/api/mentor/chat", { question: "Hi?" })).toEqual({
      status: 429,
      body: { code: "mentor_limit", limit: 30 },
    });
    expect(plus.generateChat).not.toHaveBeenCalled();
  });

  it("refuses a question over the bot's length cap", async () => {
    const { web, cookie } = await arrange("plus");
    const res = await web.call(cookie, "POST", "/api/mentor/chat", { question: "x".repeat(1001) });
    expect(res).toEqual({ status: 400, body: { code: "too_long", max: 1000 } });
  });
});

describe("web grammar check", () => {
  it("lists each mistake with its category and bills one check", async () => {
    const { web, cookie, billed } = await arrange();

    const res = await web.call(cookie, "POST", "/api/grammar-check", { text: "Jdu do škola." });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "checked",
      language: "cs",
      correctedText: "Jdu do školy.",
      errors: [{ ...MISTAKE, categoryLabel: expect.any(String) }],
    });
    expect(await billed("[grammarCheck]")).toBe(1);
  });

  it("stops Free at five checks a day before any AI call", async () => {
    const { web, cookie, calls, billed } = await arrange();
    for (let turn = 0; turn < 5; turn += 1) {
      expect((await web.call(cookie, "POST", "/api/grammar-check", { text: `Věta ${turn}.` })).status).toBe(200);
    }

    const res = await web.call(cookie, "POST", "/api/grammar-check", { text: "Šestá věta." });

    expect(res).toEqual({ status: 429, body: { code: "grammar_limit", limit: 5 } });
    expect(calls.filter((call) => call === "grammar")).toHaveLength(5);
    expect(await billed("[grammarCheck]")).toBe(5);
  });

  it("names the checkable languages for an out-of-set text without spending a daily check", async () => {
    const { web, cookie, billed } = await arrange(undefined, "de");

    const res = await web.call(cookie, "POST", "/api/grammar-check", { text: "Ich gehe in die Schule." });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "unsupported_language", languages: expect.any(Array) });
    expect(await billed("[grammarCheck]")).toBe(0);
    expect(await billed("[grammarCheckOutOfSet]")).toBe(1);
  });
});

describe("web expressions", () => {
  it("returns an expression and bills it; an exhausted meter refuses before the AI", async () => {
    const { web, cookie, userId, ledger, calls, billed } = await arrange();

    const res = await web.call(cookie, "POST", "/api/expressions", {});
    expect(res.status).toBe(200);
    expect((res.body as { expression: { expression: string } }).expression.expression).toBe("Be a goldfish");
    expect(await billed("[expression]")).toBe(1);

    // Free's 30 daily credits, spent.
    await ledger.logTranslationRequest(userId, "[translate]", null, [], 30);
    const refused = await web.call(cookie, "POST", "/api/expressions", { avoid: ["Be a goldfish"] });
    expect(refused.status).toBe(429);
    expect(refused.body).toMatchObject({ code: "limit", reason: "plan" });
    expect(calls.filter((call) => call === "expression")).toHaveLength(1);
  });
});

describe("web word picker", () => {
  async function arrangeAngle(slug: string): Promise<number> {
    const preset = await wordPickerPresetRepository.create({
      slug,
      emoji: "🕳",
      title: "No word for this at home",
      titleI18n: {},
      prompt: "Pick words this language has a single word for.",
      learningLangs: [],
      sortOrder: 10,
      isActive: true,
    });
    return preset.id;
  }

  type PickedSet = { status: string; run: { id: number }; items: { id: number; word: string; saved: boolean }[] };

  it("lists angles, generates a set, saves an item into the dictionary and the rest at once", async () => {
    const { web, cookie, userId, billed } = await arrange();
    const presetId = await arrangeAngle(`web-angle-${userId}`);

    const presets = (await web.call(cookie, "GET", "/api/word-picker/presets")).body as {
      presets: { id: number; langs: { code: string }[] }[];
    };
    expect(presets.presets.find((p) => p.id === presetId)?.langs.map((l) => l.code)).toEqual(["cs"]);

    const set = await web.call(cookie, "POST", "/api/word-picker/sets", { presetId, lang: "cs" });
    expect(set.status).toBe(200);
    const picked = set.body as PickedSet;
    expect(picked.status).toBe("generated");
    expect(picked.items.map((item) => item.word)).toEqual(["prozvonit", "vyzvánět"]);
    expect(await billed("[wordPick]")).toBe(1);

    const first = picked.items[0]!;
    expect(await web.call(cookie, "POST", `/api/word-picker/items/${first.id}/save`)).toEqual({
      status: 200,
      body: { saved: 1, alreadySaved: false },
    });
    expect(await web.call(cookie, "POST", `/api/word-picker/items/${first.id}/save`)).toEqual({
      status: 200,
      body: { saved: 0, alreadySaved: true },
    });
    const cs = getLang("cs")!;
    expect(await vocabularyRepository.findByOriginalAndSource(userId, "prozvonit", cs.id)).not.toBeNull();

    expect(await web.call(cookie, "POST", `/api/word-picker/runs/${picked.run.id}/save-all`)).toEqual({
      status: 200,
      body: { saved: 1, alreadySaved: false },
    });
    expect(await vocabularyRepository.findByOriginalAndSource(userId, "vyzvánět", cs.id)).not.toBeNull();

    const stranger = await arrange();
    expect(
      (await stranger.web.call(stranger.cookie, "POST", `/api/word-picker/runs/${picked.run.id}/save-all`)).status,
    ).toBe(404);
  });

  it("refuses a set once the credit meter is spent", async () => {
    const { web, cookie, userId, ledger, calls } = await arrange();
    const presetId = await arrangeAngle(`web-angle-spent-${userId}`);
    await ledger.logTranslationRequest(userId, "[translate]", null, [], 30);

    const res = await web.call(cookie, "POST", "/api/word-picker/sets", { presetId, lang: "cs" });

    expect(res.status).toBe(429);
    expect(calls).not.toContain("pick");
  });
});

describe("web videos", () => {
  function uniqueVideoId(): string {
    return String(uniqueTelegramId()).slice(-11).padStart(11, "0");
  }

  async function waitForStatus(
    web: Awaited<ReturnType<typeof arrange>>["web"],
    cookie: string,
    id: number,
    status: string,
  ): Promise<{ phrases: { id: number; phrase: string }[] }> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const res = await web.call(cookie, "GET", `/api/videos/${id}`);
      const body = res.body as { video: { status: string }; phrases: { id: number; phrase: string }[] };
      if (body.video.status === status) return body;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`video ${id} never reached ${status}`);
  }

  it("refuses a plan with no video allowance", async () => {
    const { web, cookie } = await arrange();
    const res = await web.call(cookie, "POST", "/api/videos", { url: `https://youtu.be/${uniqueVideoId()}` });
    expect(res).toEqual({ status: 429, body: { code: "video_limit" } });
    expect(fetchMetadata).not.toHaveBeenCalled();
  });

  it("gives Free one curated starter video, extracts it after a billed confirm, and saves a phrase", async () => {
    const { web, cookie, userId, billed } = await arrange();
    vi.mocked(fetchMetadata).mockResolvedValue({ title: "Starter", durationSeconds: 60 } as Awaited<
      ReturnType<typeof fetchMetadata>
    >);
    vi.mocked(fetchTranscript).mockResolvedValue({
      text: "nice phrase",
      segments: [{ text: "nice phrase", offset: 6, duration: 4 }],
      type: "auto-generated",
      language: "cs",
    } as Awaited<ReturnType<typeof fetchTranscript>>);
    const suggestion = getVideoSuggestionsForLangs(["cs"])[0];
    if (!suggestion) throw new Error("no curated Czech video to try");

    const submitted = await web.call(cookie, "POST", "/api/videos", {
      suggestion: { lang: suggestion.lang, index: suggestion.index },
    });
    expect(submitted.status).toBe(200);
    const video = (submitted.body as { status: string; video: { id: number } }).video;
    expect((submitted.body as { status: string }).status).toBe("confirm");

    expect((await web.call(cookie, "POST", `/api/videos/${video.id}/confirm`)).status).toBe(202);
    expect(await billed("[video]")).toBe(1);
    const done = await waitForStatus(web, cookie, video.id, "completed");
    expect(done.phrases.map((p) => p.phrase)).toEqual(["nice phrase"]);

    expect(await web.call(cookie, "POST", `/api/videos/phrases/${done.phrases[0]!.id}/save`)).toEqual({
      status: 200,
      body: { saved: 1, alreadySaved: false },
    });
    expect(await vocabularyRepository.findByOriginalAndSource(userId, "nice phrase", getLang("cs")!.id)).not.toBeNull();

    // Past the giveaway, a link of its own meets the plan again.
    const again = await web.call(cookie, "POST", "/api/videos", { url: `https://youtu.be/${uniqueVideoId()}` });
    expect(again).toEqual({ status: 429, body: { code: "video_limit" } });
  });
});
