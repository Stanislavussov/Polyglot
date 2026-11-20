import { describe, expect, it } from "vitest";
import { languageCountry, unlistedLanguageName } from "./unlisted-language";

describe("unlisted language", () => {
  it("names the language in the interface language, capitalized for the start of a sentence", () => {
    expect(unlistedLanguageName("hr", "ru")).toBe("Хорватский");
    expect(unlistedLanguageName("hr", "en")).toBe("Croatian");
  });

  it("keeps the code when it is not a language", () => {
    expect(unlistedLanguageName("not-a-code!", "en")).toBe("not-a-code!");
  });

  it("finds the country whose flag stands for the language", () => {
    expect(languageCountry("hr")).toBe("hr");
    expect(languageCountry("cs")).toBe("cz");
    expect(languageCountry("not-a-code!")).toBeNull();
  });
});
