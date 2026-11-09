import type { CardsDeckCard } from "@polyglot/core";
import { describe, expect, it } from "vitest";
import { formatEmptyDictionaryPush, formatReEngagementPush, formatWordPush, stripHtml } from "./web-push.formatter.js";

const card = { entryId: 1, original: "pes" } as CardsDeckCard;

describe("formatWordPush", () => {
  it("asks about a single word and opens the review page", () => {
    const push = formatWordPush(
      { hour: 9, word: { original: "pes", headword: "der Hund", emoji: "", translations: {} } },
      "en",
    );
    expect(push).toEqual({
      title: "Time for a word",
      body: "Do you remember “der Hund”?",
      url: "/review/",
      tag: "polyglot-word",
    });
  });

  it("counts the cards of a deck", () => {
    const push = formatWordPush(
      { hour: 9, word: { original: "pes", emoji: "", translations: {} }, deck: [card, card, card] },
      "en",
    );
    expect(push.body).toBe("3 cards are waiting for you");
    expect(push.url).toBe("/review/");
  });

  it("speaks the reader's language", () => {
    expect(formatWordPush({ hour: 9, word: { original: "pes", emoji: "", translations: {} } }, "ru").title).toBe(
      "Время для слова",
    );
  });
});

describe("formatEmptyDictionaryPush", () => {
  it("sends the reader to the translate page", () => {
    expect(formatEmptyDictionaryPush("en")).toMatchObject({
      url: "/translate/",
      body: "Your dictionary is empty — add a word to start.",
    });
  });
});

describe("formatReEngagementPush", () => {
  it("drops Telegram's HTML and opens the app's start page", () => {
    expect(formatReEngagementPush("<b>We miss you</b> &amp; your words")).toMatchObject({
      body: "We miss you & your words",
      url: "/",
    });
  });
});

describe("stripHtml", () => {
  it("keeps a literal less-than sign that was escaped", () => {
    expect(stripHtml("a &lt;b&gt; c")).toBe("a <b> c");
  });
});
