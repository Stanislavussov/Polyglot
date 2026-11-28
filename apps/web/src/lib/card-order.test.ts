import { describe, expect, it } from "vitest";
import { splitAnswer, splitNative } from "./card-order";

const ru = { lang: "ru", text: "чернослив" };
const cs = { lang: "cs", text: "sušené švestky" };
const de = { lang: "de", text: "Backpflaumen" };
const en = { lang: "en", text: "prunes" };

describe("splitNative", () => {
  it("pulls the native-language translation out of the list", () => {
    expect(splitNative([cs, ru, de], "ru")).toEqual({ native: ru, others: [cs, de] });
  });

  it("keeps the order of the other languages", () => {
    expect(splitNative([de, cs, ru], "ru").others).toEqual([de, cs]);
  });

  it("has no native block when the word was typed in the native language", () => {
    expect(splitNative([cs, de], "ru")).toEqual({ native: null, others: [cs, de] });
  });

  it("has no native block before settings load", () => {
    expect(splitNative([ru, cs], undefined)).toEqual({ native: null, others: [ru, cs] });
  });
});

// The rating asks "how well did you remember it?", so it must come after whatever answers the card.
describe("splitAnswer", () => {
  it("answers a foreign word with its native translation", () => {
    expect(splitAnswer([cs, ru, de], "ru", ["cs"])).toEqual({ answer: [ru], rest: [cs, de] });
  });

  it("answers a native word with the languages being learned, in the learner's order", () => {
    expect(splitAnswer([de, cs, en], "ru", ["en", "cs"])).toEqual({ answer: [en, cs], rest: [de] });
  });

  it("answers with every translation when none is native or being learned", () => {
    expect(splitAnswer([cs, de], "ru", ["en"])).toEqual({ answer: [cs, de], rest: [] });
  });

  it("answers with every translation before settings load", () => {
    expect(splitAnswer([ru, cs], undefined, undefined)).toEqual({ answer: [ru, cs], rest: [] });
  });
});
