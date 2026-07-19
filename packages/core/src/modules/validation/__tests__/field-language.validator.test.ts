import { describe, expect, it } from "vitest";
import type { ValidationError } from "../types.js";
import { validateNativeFields } from "../validators/field-language.validator.js";

/**
 * Regression corpus for the Russian-script rule in field-language.validator.
 *
 * The rule must only reject TRUE ROMANIZATION (Russian written in Latin letters).
 * A genuine Russian field that quotes a foreign head-word, an annotated German
 * noun, or a multi-word idiom must PASS even when the quoted Latin token
 * outweighs the surrounding Cyrillic.
 */

function languageFields(errors: ValidationError[]): string[] {
  return errors.filter((error) => error.rule === "language").map((error) => error.field ?? "<unknown>");
}

function languageErrorsFor(value: string): string[] {
  return languageFields(validateNativeFields({ nativeMeaning: value }, {}, [], "ru").errors);
}

/** Realistic Russian field values that quote a foreign token. None may be flagged. */
const MUST_PASS: ReadonlyArray<readonly [string, string]> = [
  ["gloss quoting the English head-word 'thus'", "«thus» — так, следовательно"],
  ["gloss quoting the English head-word 'seam'", "«seam» — шов"],
  ["example quoting the English head-word 'dimmed'", "The lights dimmed — свет погас."],
  ["gloss quoting 'crutch' with its plural", "crutch, crutches — костыль"],
  ["gloss quoting the English head-word 'prescient'", "«prescient» — прозорливый"],
  ["annotated German noun with article and plural", "der Stuhl, die Stühle — стул"],
  ["Russian sentence quoting an annotated German noun", "Слово «der Stuhl» значит «стул»."],
  ["short idiom gloss with a quoted foreign phrase", "to bite the bullet — стиснуть зубы"],
  ["Russian sentence quoting a multi-word idiom", "Идиома «to let the cat out of the bag» значит «проболтаться»."],
];

/** True romanization: Russian rendered in Latin letters. All must be flagged. */
const MUST_FAIL: ReadonlyArray<readonly [string, string]> = [
  ["bare romanized greeting", "privet, kak dela"],
  ["full-Latin romanized Russian sentence", "Pravitel'stvo reshilo postepenno otkazat'sya ot plastika."],
  [
    "romanized sentence with only a token of Cyrillic left in",
    "Ya khochu skazat', chto eto ochen' slozhnyy vopros — да.",
  ],
  ["foreign-language text with no Cyrillic at all", "Používá se jen ve velmi neformální konverzaci."],
];

describe("validateNativeFields — Russian script rule", () => {
  describe("accepts Russian text that quotes a foreign token", () => {
    for (const [name, value] of MUST_PASS) {
      it(`accepts ${name}`, () => {
        expect(languageErrorsFor(value)).toEqual([]);
      });
    }
  });

  describe("rejects true romanization", () => {
    for (const [name, value] of MUST_FAIL) {
      it(`rejects ${name}`, () => {
        expect(languageErrorsFor(value)).toEqual(["nativeMeaning"]);
      });
    }
  });

  it("applies the rule to nested native fields, not just nativeMeaning", () => {
    const result = validateNativeFields(
      {
        sourceUsage: {
          explanation: "«der Stuhl, die Stühle» — стул",
          examples: [{ native: "privet, kak dela" }],
        },
      },
      {
        de: {
          usageNote: "der Stuhl, die Stühle — стул",
          examples: [{ target: "Der Stuhl ist neu.", native: "Etot stul sovsem novyy segodnya." }],
        },
      },
      ["de"],
      "ru",
    );

    expect(languageFields(result.errors)).toEqual([
      "sourceUsage.examples.0.native",
      "translations.de.examples.0.native",
    ]);
  });

  it("leaves non-Russian native languages untouched", () => {
    const result = validateNativeFields({ nativeMeaning: "privet, kak dela" }, {}, [], "cs");

    expect(languageFields(result.errors)).toEqual([]);
  });
});
