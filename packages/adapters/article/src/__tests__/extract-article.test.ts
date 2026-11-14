/**
 * Spec — a web page becomes the article a reader came for, and nothing else:
 *
 * 1. The body paragraphs are kept, in order; navigation, cookie banners, ad slots,
 *    share bars, captions and credits, "read more" cross-links, newsletter boxes,
 *    related-story rails, comments and the footer are not.
 * 2. Div-only layouts (sidebars, widgets, tag clouds) clean up the same way.
 * 3. A wrapper whose class only looks like noise ("ad-free") still yields its prose.
 * 4. Title comes without the " — Site" suffix; site name and declared language are read.
 * 5. The body is capped to a word budget at a paragraph boundary and flagged truncated.
 * 6. A page with too little body text is refused as not an article.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ArticleError } from "../errors.js";
import { extractArticle } from "../extract-article.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const URL_ = "https://example.com/story";

describe("extractArticle", () => {
  it("keeps the story and drops a news site's furniture", () => {
    const article = extractArticle(fixture("news-en.html"), URL_, { minWords: 20 });

    expect(article.title).toBe("Why cities are planting tiny forests");
    expect(article.siteName).toBe("The Daily Planet");
    expect(article.language).toBe("en");
    const paragraphs = article.text.split("\n\n");
    expect(paragraphs).toHaveLength(5);
    expect(paragraphs[0]).toMatch(/^Across Europe, city councils/);
    expect(paragraphs[4]).toMatch(/^Researchers caution/);
    for (const noise of [
      "cookies",
      "Sport",
      "Advertisement",
      "Share on",
      "Photo:",
      "Getty",
      "Read more",
      "newsletter",
      "urban foxes",
      "greenwashing",
      "All rights reserved",
    ]) {
      expect(article.text).not.toContain(noise);
    }
    expect(article.truncated).toBe(false);
  });

  it("cleans a div-only blog layout and strips the site from the title", () => {
    const article = extractArticle(fixture("blog-ru.html"), URL_, { minWords: 20 });

    expect(article.title).toBe("Как я выучил чешский за год");
    expect(article.language).toBe("ru");
    expect(article.text.split("\n\n")).toHaveLength(5);
    for (const noise of [
      "Главная",
      "прага",
      "популярные",
      "Реклама",
      "Читайте также",
      "Поделиться",
      "Подпишитесь",
      "права",
    ]) {
      expect(article.text).not.toContain(noise);
    }
  });

  it("does not throw away a body wrapper whose class merely looks like an ad", () => {
    const sentence =
      "This paragraph is long enough to count as real prose that a reader would want to keep and learn from.";
    const html = `<html lang="de"><body><div class="article ad-free">${Array.from({ length: 5 }, (_, i) => `<p>${i} ${sentence} ${sentence}</p>`).join("")}</div></body></html>`;

    const article = extractArticle(html, URL_, { minWords: 20 });

    expect(article.text.split("\n\n")).toHaveLength(5);
    expect(article.language).toBe("de");
  });

  it("caps a long read at a paragraph boundary", () => {
    const paragraph = Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ");
    const html = `<html><body><article>${Array.from({ length: 10 }, (_, i) => `<p>${i} ${paragraph}.</p>`).join("")}</article></body></html>`;

    const article = extractArticle(html, URL_, { maxWords: 160, minWords: 20 });

    expect(article.truncated).toBe(true);
    expect(article.text.split("\n\n")).toHaveLength(3);
    expect(article.wordCount).toBeLessThanOrEqual(160);
  });

  it("refuses a landing page", () => {
    expect(() => extractArticle(fixture("landing.html"), URL_)).toThrow(ArticleError);
    try {
      extractArticle(fixture("landing.html"), URL_);
    } catch (error) {
      expect((error as ArticleError).code).toBe("not_an_article");
    }
  });
});
