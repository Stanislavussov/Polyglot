import { describe, expect, it } from "vitest";
import { splitNative } from "./card-order";

const ru = { lang: "ru", text: "чернослив" };
const cs = { lang: "cs", text: "sušené švestky" };
const de = { lang: "de", text: "Backpflaumen" };

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
