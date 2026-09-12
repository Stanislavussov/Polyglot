import { describe, expect, it } from "vitest";
import { type CardMentorContext, composeCardMentorTurn, renderCardForMentor } from "./card-mentor-context.js";

const FULL_CARD: CardMentorContext = {
  output: {
    original: "arbeit",
    sourceLang: "de",
    emoji: "💼",
    nativeMeaning: "work",
    sourceUsage: {
      headword: "die Arbeit",
      explanation: "Everyday word for work as an activity or as a job.",
      synonyms: [{ text: "Job" }, { text: "Beschäftigung" }],
      examples: [{ context: "office", target: "Die Arbeit beginnt um acht.", native: "Work starts at eight." }],
    },
    nativeSynonyms: [{ text: "labour" }],
    translations: {
      cs: {
        text: "práce",
        synonyms: [{ text: "dřina" }],
        examples: [{ context: "office", target: "Práce začíná v osm.", native: "Work starts at eight." }],
        expressionType: "literal",
        equivalentNote: "Same everyday register.",
        usageNote: "Neutral — usable for both the activity and the workplace.",
        connotationWarning: "dřina implies drudgery.",
        alternatives: [{ text: "zaměstnání", synonyms: [{ text: "místo" }] }],
      },
    },
  },
  contextHint: "as in a paid job",
  etymology: "From Old High German arabeit.",
};

/** The card at its thinnest: a word, one translation, and nothing unfolded. */
const BARE_CARD: CardMentorContext = {
  output: {
    original: "práce",
    sourceLang: "cs",
    nativeSynonyms: [],
    translations: { en: { text: "work", synonyms: [], examples: [] } },
  },
};

describe("renderCardForMentor", () => {
  it("carries every part of the card the user is looking at", () => {
    const rendered = renderCardForMentor(FULL_CARD);

    expect(rendered).toContain("Original input: arbeit");
    expect(rendered).toContain("Source language: de");
    expect(rendered).toContain("Citation form: die Arbeit");
    expect(rendered).toContain("Meaning in the user's native language: work");
    expect(rendered).toContain("Native-language synonyms: labour");
    expect(rendered).toContain("Usage explanation shown on the card: Everyday word for work");
    expect(rendered).toContain("Source-language synonyms: Job, Beschäftigung");
    expect(rendered).toContain('Source-language examples: "Die Arbeit beginnt um acht." — Work starts at eight.');
    expect(rendered).toContain("Translation into cs: práce (synonyms: dřina)");
    expect(rendered).toContain("alternative: zaměstnání (synonyms: místo)");
    expect(rendered).toContain("expression type: literal");
    expect(rendered).toContain("why this equivalent: Same everyday register.");
    expect(rendered).toContain("usage note: Neutral — usable for both");
    expect(rendered).toContain("caution: dřina implies drudgery.");
    expect(rendered).toContain('examples: "Práce začíná v osm." — Work starts at eight.');
    expect(rendered).toContain("Etymology: From Old High German arabeit.");
    expect(rendered).toContain("Context the user gave when asking for this translation: as in a paid job");
  });

  // An empty label is an invitation to invent the missing value, which is the one
  // thing a card's context must never do.
  it("writes no label for a section the card does not have", () => {
    const rendered = renderCardForMentor(BARE_CARD);

    expect(rendered).toContain("Translation into en: work");
    expect(rendered).not.toContain("synonyms:");
    expect(rendered).not.toContain("usage note:");
    expect(rendered).not.toContain("Etymology");
    expect(rendered).not.toContain("Context the user gave");
    // The citation form is the card's own headword; repeating the input as one
    // would tell the model a normalization happened when none did.
    expect(rendered).not.toContain("Citation form");
  });

  it("passes on the as-written caveat, so the mentor does not vouch for an unverified word", () => {
    const rendered = renderCardForMentor({ output: { ...BARE_CARD.output, unverified: true } });

    expect(rendered).toContain("not a verified word");
  });

  it("names the correction when the input was fixed before translating", () => {
    const rendered = renderCardForMentor({
      output: {
        ...BARE_CARD.output,
        correction: { original: "prace", corrected: "práce", explanation: "missing diacritics" },
      },
    });

    expect(rendered).toContain("Silently corrected before translating: prace → práce");
  });
});

describe("composeCardMentorTurn", () => {
  it("puts the card first and the question last, each labelled", () => {
    const turn = composeCardMentorTurn(FULL_CARD, "why is it feminine?");

    expect(turn.indexOf("--- CARD ---")).toBeLessThan(turn.indexOf("Original input: arbeit"));
    expect(turn.indexOf("Original input: arbeit")).toBeLessThan(turn.indexOf("--- END OF CARD ---"));
    expect(turn.endsWith("Their question about it:\nwhy is it feminine?")).toBe(true);
  });
});
