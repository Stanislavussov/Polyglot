/**
 * Flashcard back content: examples collapse into an expandable blockquote so a
 * multi-language reveal stays scannable; the answer lines stay visible.
 */
import type { WordDisplayData } from "@polyglot/core";
import { createLanguageOrderContext } from "@polyglot/core";
import { describe, expect, it } from "vitest";
import { buildFlashCardDoneKeyboard, renderFlashCardBack } from "../flashcard.renderer.js";

const ORDER = createLanguageOrderContext({ nativeLang: "ru", learningLangs: ["en"] });

const WORD: WordDisplayData = {
  id: 1,
  original: "кувыркаться",
  sourceLang: "ru",
  inputType: "word",
  emoji: "🤸",
  createdAt: new Date("2025-01-01"),
  translations: {
    en: {
      text: "to somersault",
      examples: [
        { context: "neutral", target: "The children somersault.", native: "Дети кувыркаются." },
        { context: "neutral", target: "He tumbled downhill.", native: "Он кувыркался с холма." },
      ],
      usageNote: "Акробатическое движение.",
    },
  },
};

describe("renderFlashCardBack — collapsible notes", () => {
  it("keeps the first example visible and collapses the rest with the usage note", () => {
    const html = renderFlashCardBack(WORD, 1, 1, "ru", ORDER);
    expect(html).toContain(
      "💬 <i>The children somersault.</i> (Дети кувыркаются.)\n" +
        "<blockquote expandable>💬 <i>He tumbled downhill.</i> (Он кувыркался с холма.)\n" +
        "💡 Акробатическое движение.</blockquote>",
    );
    expect(html.indexOf("<b>to somersault</b>")).toBeLessThan(html.indexOf("💬"));
  });

  it("renders no blockquote when the card has no notes", () => {
    const bare: WordDisplayData = {
      ...WORD,
      translations: {
        en: { text: "to somersault", examples: [{ context: "neutral", target: "A somersault." }] },
      },
    };
    expect(renderFlashCardBack(bare, 1, 1, "ru", ORDER)).not.toContain("blockquote");
  });
});

describe("buildFlashCardDoneKeyboard", () => {
  const rowsOf = (showProgress: boolean): string[][] =>
    buildFlashCardDoneKeyboard("en", { showProgress }).inline_keyboard.map((row) =>
      row.map((button) => ("callback_data" in button ? button.callback_data : "")),
    );

  it("puts the progress button on a row of its own", () => {
    expect(rowsOf(true)).toEqual([["fc:restart", "fc:close"], ["progress:open:flashcard_done"]]);
  });

  it("omits the progress button while the motivation surface is off", () => {
    expect(rowsOf(false)).toEqual([["fc:restart", "fc:close"]]);
  });
});
