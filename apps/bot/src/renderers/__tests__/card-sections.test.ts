/**
 * The card grammar's own contract: section sequence and omission.
 *
 * These assertions are about *order*, which is the whole reason the module
 * exists — a renderer that pushes its lines in the wrong sequence is the defect
 * class this replaces.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>("@polyglot/core");
  return {
    ...actual,
    getLangFlag: (code: string) => ({ en: "🇬🇧", cs: "🇨🇿", ru: "🇷🇺", de: "🇩🇪" })[code],
  };
});

import {
  answerLine,
  assembleCard,
  CARD_SECTION_ORDER,
  emptySections,
  exampleLine,
  headwordLine,
  langLabel,
  meaningLine,
  otherLangLine,
} from "../card-sections.js";

describe("assembleCard", () => {
  it("emits sections in CARD_SECTION_ORDER regardless of the order the caller writes them", () => {
    // Deliberately declared back-to-front — the object literal cannot decide layout.
    const card = assembleCard({
      ...emptySections(),
      others: ["others"],
      meaning: ["meaning"],
      answer: ["answer"],
      headword: ["headword"],
      provenance: ["provenance"],
    });

    expect(card.split("\n")).toEqual(["provenance", "headword", "answer", "meaning", "others"]);
  });

  it("puts the answer directly after the headword — the rule the grammar exists to enforce", () => {
    const card = assembleCard({
      ...emptySections(),
      provenance: ["<i>from your dictionary</i>"],
      headword: [headwordLine("Haus", { emoji: "🏠", sourceLang: "de" })],
      answer: [answerLine("ru", "дом", ["жилище"])],
      meaning: [meaningLine("Жилое здание.")],
      others: [otherLangLine("cs", "dům")],
    });
    const lines = card.split("\n");

    expect(lines.indexOf("🇷🇺 <b>дом</b> (жилище)")).toBe(lines.findIndex((l) => l.includes("Haus")) + 1);
    expect(lines.findIndex((l) => l.startsWith("🇷🇺"))).toBeLessThan(lines.findIndex((l) => l.startsWith("💡")));
  });

  it("omits empty sections without leaving blank lines behind", () => {
    const card = assembleCard({ ...emptySections(), headword: ["word"], others: ["other"] });

    expect(card).toBe("word\nother");
  });

  it("returns an empty string when every section is empty", () => {
    expect(assembleCard(emptySections())).toBe("");
  });

  it("lists every section exactly once", () => {
    expect(new Set(CARD_SECTION_ORDER).size).toBe(CARD_SECTION_ORDER.length);
  });
});

describe("langLabel", () => {
  it("renders the flag alone when one resolves — the code would say it twice", () => {
    expect(langLabel("ru")).toBe("🇷🇺");
  });

  it("keeps the code when no flag resolves, so the language stays identifiable", () => {
    expect(langLabel("xx")).toBe("🔤 XX:");
  });
});

describe("line builders", () => {
  it("renders the headword with a single source flag", () => {
    expect(headwordLine("Haus", { emoji: "🏠", sourceLang: "de" })).toBe("🏠 <b>Haus</b> 🇩🇪");
  });

  it("omits the flag when the surface has no source language", () => {
    expect(headwordLine("house", { emoji: "🏠" })).toBe("🏠 <b>house</b>");
  });

  it("renders secondary languages unbolded and without synonyms", () => {
    expect(otherLangLine("cs", "dům")).toBe("🇨🇿 dům");
  });

  it("glosses an example with its native translation", () => {
    expect(exampleLine("Das Haus ist alt.", "Дом старый.")).toBe("💬 <i>Das Haus ist alt.</i> (Дом старый.)");
  });

  it("escapes HTML in every builder", () => {
    expect(headwordLine("a<b>&c")).toBe("<b>a&lt;b&gt;&amp;c</b>");
    expect(answerLine("ru", "x<y")).toBe("🇷🇺 <b>x&lt;y</b>");
    expect(meaningLine("a & b")).toBe("💡 a &amp; b");
  });
});
