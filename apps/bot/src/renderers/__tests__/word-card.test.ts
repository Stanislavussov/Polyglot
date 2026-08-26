/**
 * The saved-word card must be indistinguishable from the card the same word was
 * translated on. The first suite is the anti-drift guard: it renders one word
 * through `renderTranslation` and through `renderWordCard` and demands the same
 * string, so a change to the translate card that this module does not follow
 * fails here rather than in a user's chat.
 */
import { describe, expect, it, vi } from "vitest";

// Flags come from the language registry, which is populated from the database at
// runtime; both renderers read it through the same helper.
vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>("@polyglot/core");
  const flags: Record<string, string> = { de: "🇩🇪", en: "🇬🇧", ru: "🇷🇺" };
  return { ...actual, getLangFlag: (code: string) => flags[code] };
});

import type { TranslateOutput } from "@polyglot/core";
import { createLanguageOrderContext } from "@polyglot/core";
import { renderTranslation } from "../translation.renderer.js";
import { renderWordCard } from "../word-card.js";

/** A `ru`-native user learning German, then English. */
const ORDER = createLanguageOrderContext({ nativeLang: "ru", learningLangs: ["de", "en"] });

const SOURCE_USAGE = {
  headword: "die Arbeit",
  explanation: "Работа, труд.",
  synonyms: [{ text: "die Tätigkeit" }],
  examples: [
    { context: "daily", target: "Die Arbeit macht Spaß.", native: "Работа в радость." },
    { context: "daily", target: "Ich suche Arbeit.", native: "Я ищу работу." },
  ],
};

describe("renderWordCard — parity with the translate card", () => {
  /**
   * The native block carries only text and synonyms, as the translate card
   * renders it (the prompt asks the model to omit examples there — the reader
   * already knows their own language).
   */
  const output: TranslateOutput = {
    original: "arbeit",
    sourceLang: "de",
    emoji: "💼",
    nativeSynonyms: [],
    sourceUsage: SOURCE_USAGE,
    translations: {
      ru: { text: "работа", synonyms: [{ text: "труд" }], examples: [] },
      en: {
        text: "work",
        synonyms: [],
        examples: [{ context: "neutral", target: "Hard work.", native: "Тяжёлая работа." }],
        usageNote: "Общее слово.",
      },
    },
  };

  it("renders a saved word exactly as the translate card renders it", () => {
    const translated = renderTranslation(output, ORDER, "ru", undefined, "ru");
    const saved = renderWordCard(
      {
        original: "arbeit",
        emoji: "💼",
        sourceLang: "de",
        sourceUsage: SOURCE_USAGE,
        langs: [
          { code: "ru", text: "работа", synonyms: [{ text: "труд" }] },
          {
            code: "en",
            text: "work",
            examples: [{ context: "neutral", target: "Hard work.", native: "Тяжёлая работа." }],
            usageNote: "Общее слово.",
          },
        ],
        answerLang: "ru",
        nativeLang: "ru",
      },
      "ru",
    );

    expect(saved).toBe(translated);
  });
});

describe("renderWordCard — headword", () => {
  it("puts the source flag beside the word and no provenance chrome above it", () => {
    const card = renderWordCard(
      { original: "Haus", emoji: "🏠", sourceLang: "de", langs: [{ code: "ru", text: "дом" }] },
      "ru",
    );

    expect(card.split("\n")[0]).toBe("🏠 🇩🇪 <b>Haus</b>");
    // The old dictionary/flashcard chrome line — the translate card never had it.
    expect(card).not.toMatch(/<i>[^<]*·/);
  });

  it("prefers the stored citation form over the raw input", () => {
    const card = renderWordCard({ original: "arbeit", sourceLang: "de", sourceUsage: SOURCE_USAGE, langs: [] }, "ru");

    expect(card).toContain("<b>die Arbeit</b>");
    expect(card).not.toContain("<b>arbeit</b>");
  });

  it("keeps synonyms on the word's own line rather than below it", () => {
    const card = renderWordCard(
      {
        original: "Haus",
        sourceLang: "de",
        langs: [{ code: "ru", text: "дом", synonyms: [{ text: "жилище" }, { text: "здание" }] }],
        answerLang: "ru",
      },
      "ru",
    );

    expect(card).toContain("🇷🇺 RU: <b>дом</b> (жилище, здание)");
  });

  it("falls back to 🔤 for a language whose row no longer resolves", () => {
    const card = renderWordCard({ original: "Haus", langs: [{ text: "дом" }] }, "ru");

    expect(card).toContain("🔤 <b>Haus</b>");
    expect(card).toContain("🔤 <b>дом</b>");
  });

  it("escapes HTML in every slot", () => {
    const card = renderWordCard(
      {
        original: "a<b> & c",
        emoji: "🏠",
        sourceLang: "de",
        nativeMeaning: "x <y> & z",
        langs: [{ code: "ru", text: "p <q>", synonyms: [{ text: "r & s" }] }],
      },
      "ru",
    );

    expect(card).toContain("a&lt;b&gt; &amp; c");
    expect(card).toContain("x &lt;y&gt; &amp; z");
    expect(card).toContain("p &lt;q&gt;");
    expect(card).toContain("r &amp; s");
  });
});

describe("renderWordCard — stored prose", () => {
  const withProse = {
    original: "Haus",
    emoji: "🏠",
    sourceLang: "de",
    nativeMeaning: "Жилое здание.",
    sourceUsage: SOURCE_USAGE,
  };

  it("folds the prose below the examples once the answer is on the card", () => {
    const card = renderWordCard(
      { ...withProse, langs: [{ code: "ru", text: "дом" }], answerLang: "ru", nativeLang: "ru" },
      "ru",
    );

    expect(card).toContain(
      "<blockquote expandable>💬 <i>Ich suche Arbeit.</i> (Я ищу работу.)\n💡 Работа, труд.\n💡 Жилое здание.</blockquote>",
    );
    // The answer comes before the prose, never after it.
    expect(card.indexOf("<b>дом</b>")).toBeLessThan(card.indexOf("Жилое здание."));
  });

  it("keeps the prose visible when the card carries no answer — there it IS the answer", () => {
    const card = renderWordCard({ ...withProse, langs: [], nativeLang: "ru" }, "ru");

    expect(card).toContain("🇷🇺 RU: Работа, труд.");
    expect(card).toContain("🇷🇺 RU: Жилое здание.");
    expect(card).not.toContain("💡 Жилое здание.");
  });

  it("folds the prose for a word already in the reader's own language", () => {
    // The translate card omits it outright here — the reader does not need their
    // own language explained to them — so it must not sit above the answers.
    const card = renderWordCard(
      { ...withProse, sourceLang: "ru", langs: [{ code: "en", text: "house" }], nativeLang: "ru" },
      "ru",
    );

    expect(card).toContain(
      "<blockquote expandable>💬 <i>Ich suche Arbeit.</i> (Я ищу работу.)\n💡 Работа, труд.\n💡 Жилое здание.</blockquote>",
    );
    expect(card).not.toContain("🇷🇺 RU: Жилое здание.");
  });

  it("renders visible prose unlabelled when the reader's language is unknown", () => {
    const card = renderWordCard({ ...withProse, sourceUsage: null, langs: [] }, "ru");
    const lines = card.split("\n").filter((line) => line.trim() !== "");

    expect(lines[1]).toBe("Жилое здание.");
  });
});

describe("renderWordCard — language blocks", () => {
  it("keeps the first example visible and collapses the rest with the notes", () => {
    const card = renderWordCard(
      {
        original: "kувыркаться",
        sourceLang: "ru",
        langs: [
          {
            code: "en",
            text: "to somersault",
            examples: [
              { context: "neutral", target: "The children somersault.", native: "Дети кувыркаются." },
              { context: "neutral", target: "He tumbled downhill.", native: "Он кувыркался с холма." },
            ],
            usageNote: "Акробатическое движение.",
            connotationWarning: "to tumble подразумевает потерю контроля.",
          },
        ],
      },
      "ru",
    );

    expect(card).toContain(
      "💬 <i>The children somersault.</i> (Дети кувыркаются.)\n" +
        "<blockquote expandable>💬 <i>He tumbled downhill.</i> (Он кувыркался с холма.)\n" +
        "💡 Акробатическое движение.\n" +
        "ℹ️ to tumble подразумевает потерю контроля.</blockquote>",
    );
  });

  it("renders no blockquote when there is nothing to collapse", () => {
    const card = renderWordCard(
      {
        original: "Haus",
        sourceLang: "de",
        langs: [{ code: "ru", text: "дом", examples: [{ context: "neutral", target: "Дом стоит." }] }],
      },
      "ru",
    );

    expect(card).not.toContain("blockquote");
  });

  it("promotes the answer language directly under the headword", () => {
    const card = renderWordCard(
      {
        original: "Haus",
        sourceLang: "de",
        sourceUsage: SOURCE_USAGE,
        langs: [
          { code: "en", text: "house" },
          { code: "ru", text: "дом" },
        ],
        answerLang: "ru",
        nativeLang: "ru",
      },
      "ru",
    );

    expect(card.indexOf("<b>дом</b>")).toBeLessThan(card.indexOf("Die Arbeit macht Spaß."));
    expect(card.indexOf("Die Arbeit macht Spaß.")).toBeLessThan(card.indexOf("<b>house</b>"));
  });

  it("keeps the given order when no answer language is named", () => {
    const card = renderWordCard(
      {
        original: "Haus",
        sourceLang: "de",
        langs: [
          { code: "en", text: "house" },
          { code: "ru", text: "дом" },
        ],
      },
      "ru",
    );

    expect(card.indexOf("<b>house</b>")).toBeLessThan(card.indexOf("<b>дом</b>"));
  });

  it("never promotes a block whose language no longer resolves", () => {
    // `answerLang` is compared against a code; a row whose language was deleted
    // has none, and `undefined === undefined` would have promoted it by accident.
    const card = renderWordCard(
      {
        original: "Haus",
        sourceLang: "de",
        langs: [{ text: "первый" }, { code: "ru", text: "дом" }],
        answerLang: undefined,
      },
      "ru",
    );

    expect(card.indexOf("<b>первый</b>")).toBeLessThan(card.indexOf("<b>дом</b>"));
  });
});

/**
 * Invariants — conditions that must hold for every card, not just the fixtures
 * above. Each one is a Telegram-level failure the chat shows and the types do not:
 * an unbalanced or unknown tag makes `sendMessage` reject the whole card with
 * `can't parse entities`, and a stray blank line renders as a visible gap.
 */
describe("renderWordCard — invariants", () => {
  /** A card exercising every branch at once, for the structural assertions. */
  const maximal = {
    original: "arbeit",
    emoji: "💼",
    sourceLang: "de",
    nativeMeaning: "Жилое здание.",
    sourceUsage: SOURCE_USAGE,
    langs: [
      { code: "ru", text: "работа", synonyms: [{ text: "труд" }] },
      {
        code: "en",
        text: "work",
        examples: [
          { context: "neutral", target: "Hard work.", native: "Тяжёлая работа." },
          { context: "neutral", target: "Good work.", native: "Хорошая работа." },
        ],
        usageNote: "Общее слово.",
        connotationWarning: "Осторожно.",
      },
    ],
    answerLang: "ru",
    nativeLang: "ru",
  };

  /** The minimum a card can be: a word and nothing else. */
  const minimal = { original: "Haus", langs: [] };

  it.each([
    ["maximal", maximal],
    ["minimal", minimal],
  ])("emits no blank-line gaps and no surrounding whitespace (%s)", (_name, card) => {
    const rendered = renderWordCard(card, "ru");

    expect(rendered).not.toMatch(/\n{3}/);
    expect(rendered).toBe(rendered.trim());
  });

  it("emits only the tags Telegram's HTML subset allows, each balanced", () => {
    const rendered = renderWordCard(maximal, "ru");
    const tags = [...rendered.matchAll(/<\/?([a-z]+)[^>]*>/g)].map((m) => m[1]);

    expect([...new Set(tags)].sort()).toEqual(["b", "blockquote", "i"]);
    for (const tag of ["b", "i", "blockquote"]) {
      const opened = [...rendered.matchAll(new RegExp(`<${tag}[ >]`, "g"))].length;
      const closed = [...rendered.matchAll(new RegExp(`</${tag}>`, "g"))].length;
      expect({ tag, opened, closed }).toEqual({ tag, opened: closed, closed });
    }
  });

  it("never opens a blockquote it has nothing to put in", () => {
    // A card whose every foldable field is absent — the empty-container case that
    // used to leave `<blockquote expandable></blockquote>` in the chat.
    const rendered = renderWordCard(
      { original: "Haus", sourceLang: "de", langs: [{ code: "ru", text: "дом" }], answerLang: "ru" },
      "ru",
    );

    expect(rendered).not.toContain("blockquote");
  });

  it("escapes a tag hidden in stored data instead of emitting it", () => {
    const rendered = renderWordCard(
      { original: "<b>bold</b>", sourceLang: "de", langs: [{ code: "ru", text: "<i>курсив</i>" }] },
      "ru",
    );

    expect(rendered).toContain("&lt;b&gt;bold&lt;/b&gt;");
    expect(rendered).toContain("&lt;i&gt;курсив&lt;/i&gt;");
    // Two bold tags from the renderer itself (headword + answer) and nothing more.
    expect([...rendered.matchAll(/<b>/g)]).toHaveLength(2);
  });

  it("falls back to the raw input when the stored citation form is blank", () => {
    const rendered = renderWordCard(
      {
        original: "arbeit",
        sourceLang: "de",
        sourceUsage: { ...SOURCE_USAGE, headword: "   " },
        langs: [],
      },
      "ru",
    );

    expect(rendered).toContain("<b>arbeit</b>");
  });

  it("drops blank stored prose rather than rendering an empty note", () => {
    const rendered = renderWordCard(
      {
        original: "Haus",
        sourceLang: "de",
        nativeMeaning: "   ",
        sourceUsage: { headword: null, explanation: "", synonyms: [], examples: [] },
        langs: [{ code: "ru", text: "дом" }],
        answerLang: "ru",
        nativeLang: "ru",
      },
      "ru",
    );

    expect(rendered).not.toContain("💡");
    expect(rendered).not.toContain("blockquote");
  });
});
