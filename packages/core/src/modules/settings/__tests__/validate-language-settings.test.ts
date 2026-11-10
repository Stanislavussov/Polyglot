import { describe, expect, it } from "vitest";
import { isSupported } from "../../i18n/i18n.js";
import { validateLanguageSettings } from "../validate-language-settings.js";

const known = new Set(["en", "cs", "de", "ru", "fr", "es"]);
const context = {
  currentNativeLang: "en",
  isKnownLang: (code: string) => known.has(code),
  isInterfaceLang: isSupported,
};

describe("validateLanguageSettings", () => {
  it("accepts a valid write and de-duplicates learning languages", () => {
    expect(validateLanguageSettings({ interfaceLang: "de", learningLangs: ["cs", "cs", "de"] }, context)).toEqual({
      ok: true,
      patch: { interfaceLang: "de", learningLangs: ["cs", "de"] },
    });
  });

  it("refuses an interface language the app is not translated into", () => {
    expect(validateLanguageSettings({ interfaceLang: "xx" }, context)).toEqual({
      ok: false,
      reason: "unknown_interface_lang",
    });
  });

  it("refuses an unknown native or learning language", () => {
    expect(validateLanguageSettings({ nativeLang: "zz" }, context)).toMatchObject({ reason: "unknown_native_lang" });
    expect(validateLanguageSettings({ learningLangs: ["zz"] }, context)).toMatchObject({
      reason: "unknown_learning_lang",
    });
  });

  it("refuses learning the native language, the stored one or the one being set", () => {
    expect(validateLanguageSettings({ learningLangs: ["en"] }, context)).toMatchObject({
      reason: "learning_is_native",
    });
    expect(validateLanguageSettings({ nativeLang: "cs", learningLangs: ["cs"] }, context)).toMatchObject({
      reason: "learning_is_native",
    });
  });

  it("refuses an empty list and more than the limit", () => {
    expect(validateLanguageSettings({ learningLangs: [] }, context)).toMatchObject({ reason: "no_learning_langs" });
    expect(validateLanguageSettings({ learningLangs: ["cs", "de", "ru", "fr", "es"] }, context)).toMatchObject({
      reason: "too_many_learning_langs",
    });
  });
});
