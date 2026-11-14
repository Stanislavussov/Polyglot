/**
 * Spec — 📰 Articles on the web, end to end over the real dispatcher and Postgres:
 *
 * 1. A link is fetched and cleaned before anything is billed: the preview shows the
 *    article's title, site and word count, and an excerpt of the body without the
 *    page's ads, menus or comments.
 * 2. Confirm bills one "[article]" row; the extraction then reads only the cleaned body
 *    (no page furniture reaches the model) and completes in the background.
 * 3. A phrase saves into the dictionary with the article as its source; the same link
 *    sent again opens the finished run instead of starting a new one.
 * 4. A page with no article on it is refused (422 not_an_article) and nothing is billed.
 * 5. A link to a private address is refused before any request leaves the server.
 */

import { readFileSync } from "node:fs";
import { fetchPage } from "@polyglot/adapter-article";
import { getLang, vocabularyRepository } from "@polyglot/adapter-db";
import { type AIPort, articleExtractionResultSchema } from "@polyglot/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { arrangeOnboardedTranslator } from "../../bot/src/test-helpers/integration/arrange.js";
import { uniqueTelegramId } from "../../bot/src/test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../bot/src/test-helpers/integration/translate-ai-mock.js";
import { createWebHarness } from "./test-helpers/web-harness.js";

vi.mock("@polyglot/adapter-article", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@polyglot/adapter-article")>()),
  fetchPage: vi.fn(),
}));

const fixture = (name: string) =>
  readFileSync(new URL(`../../../packages/adapters/article/src/__tests__/fixtures/${name}`, import.meta.url), "utf8");
const NEWS = fixture("news-en.html");
const LANDING = fixture("landing.html");

const EXTRACTED = {
  language: "en",
  phrases: [
    {
      phrase: "shoot upwards",
      nativeTranslation: "тянуться вверх",
      emoji: "🌱",
      type: "phrase",
      level: "B2",
      context: "which forces them to compete for light and shoot upwards",
    },
    {
      phrase: "overstated",
      nativeTranslation: "преувеличенный",
      emoji: "📢",
      type: "word",
      level: "B2",
      context: "critics warn that the benefits are often overstated",
    },
  ],
};

async function arrange() {
  const translate = deterministicTranslateAi();
  const prompts: string[] = [];
  const generateObject: AIPort["generateObject"] = async (prompt, schema, model, options) => {
    if (schema === articleExtractionResultSchema) {
      prompts.push(prompt);
      return schema.parse(EXTRACTED);
    }
    return translate.generateObject!(prompt, schema, model, options);
  };
  const web = await createWebHarness({
    ai: { ...translate, generateObject },
    settings: {
      getVideoVocabularyConfig: vi
        .fn()
        .mockResolvedValue({ monthlyLimit: 10, minPhrases: 2, maxPhrases: 5, extractionModelId: "test/extract" }),
    },
  });
  const telegramId = uniqueTelegramId();
  const userId = await arrangeOnboardedTranslator(telegramId, { nativeLang: "ru", learningLangs: ["en"] });
  const { cookie } = await web.login(telegramId);
  const billed = () =>
    web.bot.services.translationRequestRepository.countRequestsInWindow(userId, "[article]", new Date(0));
  return { web, cookie, userId, prompts, billed };
}

async function waitForCompleted(web: Awaited<ReturnType<typeof arrange>>["web"], cookie: string, id: number) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const res = await web.call(cookie, "GET", `/api/articles/${id}`);
    const body = res.body as { article: { status: string }; phrases: { id: number; phrase: string }[] };
    if (body.article.status === "completed") return body;
    if (body.article.status === "failed") throw new Error("article run failed");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`article ${id} never completed`);
}

beforeEach(() => {
  vi.mocked(fetchPage).mockReset();
});

describe("web articles", () => {
  it("previews the cleaned article, extracts after a billed confirm and saves a phrase", async () => {
    const { web, cookie, userId, prompts, billed } = await arrange();
    const url = `https://news.example.com/forests-${uniqueTelegramId()}`;
    vi.mocked(fetchPage).mockResolvedValue({ url, html: NEWS });

    const submitted = await web.call(cookie, "POST", "/api/articles", { url });
    expect(submitted.status).toBe(200);
    const preview = submitted.body as {
      status: string;
      excerpt: string;
      article: { id: number; title: string; siteName: string; wordCount: number; language: string };
    };
    expect(preview.status).toBe("confirm");
    expect(preview.article).toMatchObject({
      title: "Why cities are planting tiny forests",
      siteName: "The Daily Planet",
      language: "en",
    });
    expect(preview.article.wordCount).toBeGreaterThan(100);
    expect(preview.excerpt).toMatch(/^Across Europe, city councils/);
    expect(await billed()).toBe(0);

    expect((await web.call(cookie, "POST", `/api/articles/${preview.article.id}/confirm`)).status).toBe(202);
    expect(await billed()).toBe(1);
    const done = await waitForCompleted(web, cookie, preview.article.id);
    expect(done.phrases.map((p) => p.phrase)).toEqual(["shoot upwards", "overstated"]);

    const [prompt] = prompts;
    expect(prompt).toContain("Researchers caution that a handful of small plots");
    for (const noise of ["cookies", "Advertisement", "urban foxes", "greenwashing", "newsletter", "Privacy policy"]) {
      expect(prompt).not.toContain(noise);
    }

    expect(await web.call(cookie, "POST", `/api/articles/phrases/${done.phrases[0]!.id}/save`)).toEqual({
      status: 200,
      body: { saved: 1, alreadySaved: false },
    });
    const entry = await vocabularyRepository.findByOriginalAndSource(userId, "shoot upwards", getLang("en")!.id);
    expect(entry?.source).toEqual({
      type: "article",
      articleUrl: url,
      articleTitle: "Why cities are planting tiny forests",
    });

    const again = await web.call(cookie, "POST", "/api/articles", { url });
    expect(again.body).toMatchObject({ status: "existing", article: { id: preview.article.id } });
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("refuses a page with no article and bills nothing", async () => {
    const { web, cookie, billed } = await arrange();
    const url = `https://acme.example.com/${uniqueTelegramId()}`;
    vi.mocked(fetchPage).mockResolvedValue({ url, html: LANDING });

    const res = await web.call(cookie, "POST", "/api/articles", { url });

    expect(res).toEqual({ status: 422, body: { code: "not_an_article" } });
    expect(await billed()).toBe(0);
    const listing = await web.call(cookie, "GET", "/api/articles");
    expect((listing.body as { articles: unknown[] }).articles).toEqual([]);
  });

  it("refuses a private address without fetching it", async () => {
    const { web, cookie } = await arrange();

    const res = await web.call(cookie, "POST", "/api/articles", { url: "http://169.254.169.254/latest/meta-data" });

    expect(res).toEqual({ status: 400, body: { code: "blocked_host" } });
    expect(fetchPage).not.toHaveBeenCalled();
  });
});
