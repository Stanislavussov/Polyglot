import { describe, expect, it } from "vitest";
import { detectLanguage, detectOutOfSetLanguage, ISO1_TO_ISO3 } from "../detect-language.js";

describe("detectOutOfSetLanguage", () => {
  // The reported bug: German phrase, user has ru + [en, cs, kk] (no German).
  // The closed-set detector coerced it to English; this must instead surface "de".
  it("flags a German phrase as out-of-set for a ru/en/cs/kk user", () => {
    expect(detectOutOfSetLanguage("die Erwartungen erfüllen", ["en", "ru", "cs", "kk"])).toBe("de");
  });

  it("returns undefined when the language IS in the candidate set", () => {
    // German user → German input is in-set, must not be flagged.
    expect(detectOutOfSetLanguage("die Erwartungen erfüllen", ["en", "de", "ru"])).toBeUndefined();
  });

  it("does not flag a genuine in-set English phrase", () => {
    expect(detectOutOfSetLanguage("go down the rabbit hole", ["en", "ru", "cs"])).toBeUndefined();
  });

  it("is conservative on short inputs (< 3 words)", () => {
    // Too short for reliable statistical detection — never flag.
    expect(detectOutOfSetLanguage("Erwartungen", ["en", "ru", "cs"])).toBeUndefined();
    expect(detectOutOfSetLanguage("guten Tag", ["en", "ru", "cs"])).toBeUndefined();
  });

  it("returns undefined for empty input", () => {
    expect(detectOutOfSetLanguage("", ["en", "ru", "cs"])).toBeUndefined();
  });
});

describe("Kazakh detection gaps fixed", () => {
  it("maps kk → kaz so franc can consider Kazakh", () => {
    expect(ISO1_TO_ISO3.kk).toBe("kaz");
  });

  it("resolves a Cyrillic word to kk when it is the only Cyrillic candidate", () => {
    // Before the fix, kk was missing from the Cyrillic script list, so this returned undefined.
    expect(detectLanguage("сәлем", ["kk", "en"])).toBe("kk");
  });
});
