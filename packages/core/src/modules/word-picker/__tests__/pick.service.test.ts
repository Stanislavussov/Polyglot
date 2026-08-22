/**
 * Word picker — behaviour of one generated set.
 *
 * The contract that matters is the one the "more words" button depends on: a set
 * never repeats what the learner has already seen or saved, never repeats itself,
 * and never exceeds the size the caller asked for.
 */
import { describe, expect, it, vi } from "vitest";
import type { GenerateObjectFn } from "../../../ports/ai.port.js";
import { buildWordPickPrompt } from "../pick.prompt.js";
import { pickWords } from "../pick.service.js";
import type { PickedItem, WordPickRequest } from "../types.js";

function item(word: string): PickedItem {
  return {
    word,
    nativeTranslation: `${word}-translated`,
    emoji: "🕳",
    type: "word",
    level: "B2",
    exampleTarget: `${word} in a sentence`,
    exampleNative: "translated sentence",
    note: "what this reveals",
  };
}

function request(overrides: Partial<WordPickRequest> = {}): WordPickRequest {
  return {
    angleTitle: "No word for this at home",
    anglePrompt: "Pick words that this language lexicalizes as a single unit.",
    learningLanguage: "German",
    nativeLanguage: "Russian",
    level: "B2",
    count: 3,
    knownWords: [],
    ...overrides,
  };
}

function aiReturning(words: string[]): GenerateObjectFn {
  return vi.fn().mockResolvedValue({ items: words.map(item) }) as unknown as GenerateObjectFn;
}

describe("pickWords", () => {
  it("drops items the learner has already seen, whatever their casing or padding", async () => {
    const picked = await pickWords(request({ knownWords: ["  FERNWEH ", "Waldeinsamkeit"] }), {
      generateObjectFn: aiReturning(["Fernweh", "Waldeinsamkeit", "Schadenfreude"]),
      modelId: "test-model",
    });

    expect(picked.map((entry) => entry.word)).toEqual(["Schadenfreude"]);
  });

  it("keeps only the first of a repeated word", async () => {
    const picked = await pickWords(request(), {
      generateObjectFn: aiReturning(["Fernweh", "Fernweh", "Torschlusspanik"]),
      modelId: "test-model",
    });

    expect(picked.map((entry) => entry.word)).toEqual(["Fernweh", "Torschlusspanik"]);
  });

  it("never returns more than the requested count", async () => {
    const picked = await pickWords(request({ count: 2 }), {
      generateObjectFn: aiReturning(["a", "b", "c", "d"]),
      modelId: "test-model",
    });

    expect(picked).toHaveLength(2);
  });

  it("returns nothing when the angle has only already-seen words left", async () => {
    const picked = await pickWords(request({ knownWords: ["Fernweh"] }), {
      generateObjectFn: aiReturning(["Fernweh"]),
      modelId: "test-model",
    });

    expect(picked).toEqual([]);
  });
});

describe("buildWordPickPrompt", () => {
  it("carries the angle, the languages and the level into the prompt", () => {
    const prompt = buildWordPickPrompt(request());

    expect(prompt).toContain("No word for this at home");
    expect(prompt).toContain("Pick words that this language lexicalizes as a single unit.");
    expect(prompt).toContain("German");
    expect(prompt).toContain("Russian");
    expect(prompt).toContain("B2");
  });

  it("lists known words once, so a duplicate cannot inflate the avoid-hint", () => {
    const prompt = buildWordPickPrompt(request({ knownWords: ["Fernweh", "fernweh ", "Heimweh"] }));

    expect(prompt).toContain("do NOT pick these again");
    expect(prompt.match(/Fernweh/g)).toHaveLength(1);
    expect(prompt).toContain("Heimweh");
  });

  it("omits the avoid-hint entirely for a learner with nothing seen yet", () => {
    expect(buildWordPickPrompt(request())).not.toContain("do NOT pick these again");
  });
});
