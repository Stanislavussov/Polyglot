import { describe, expect, it } from "vitest";
import { isEtymologyEligible } from "./etymology.service.js";

describe("isEtymologyEligible", () => {
  it("offers etymology for a word or phrase in a learning language", () => {
    expect(isEtymologyEligible("word", "de", "en")).toBe(true);
    expect(isEtymologyEligible("phrase", "de", "en")).toBe(true);
  });

  it("withholds it for sentences and native-language input", () => {
    expect(isEtymologyEligible("sentence", "de", "en")).toBe(false);
    expect(isEtymologyEligible("word", "en", "en")).toBe(false);
  });
});
