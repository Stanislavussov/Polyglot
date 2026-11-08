import { describe, expect, it } from "vitest";
import { t } from "./i18n";

describe("t before the learner's language loads", () => {
  // Settings may fail to load (API down), and the page must still read as English.
  it("returns English text instead of the raw key", () => {
    expect(t("web.translate.submit")).not.toBe("web.translate.submit");
  });

  it("still returns the key for a key nobody defined", () => {
    expect(t("web.no.such.key")).toBe("web.no.such.key");
  });
});
