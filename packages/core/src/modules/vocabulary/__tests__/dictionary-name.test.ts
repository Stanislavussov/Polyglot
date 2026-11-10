import { describe, expect, it } from "vitest";
import { acceptDictionaryName, MAX_DICTIONARY_NAME_LENGTH } from "../dictionary-name.js";

const existing = [
  { id: 1, name: "My dictionary" },
  { id: 2, name: "Travel" },
];

describe("acceptDictionaryName", () => {
  it("accepts a fresh name", () => {
    expect(acceptDictionaryName("Food", existing)).toBe("Food");
  });

  it("rejects an empty or overlong name", () => {
    expect(acceptDictionaryName("", existing)).toBeNull();
    expect(acceptDictionaryName("x".repeat(MAX_DICTIONARY_NAME_LENGTH + 1), existing)).toBeNull();
    expect(acceptDictionaryName("x".repeat(MAX_DICTIONARY_NAME_LENGTH), existing)).not.toBeNull();
  });

  it("rejects a name another dictionary holds, whatever the case", () => {
    expect(acceptDictionaryName("travel", existing)).toBeNull();
  });

  it("lets a dictionary keep its own name on rename", () => {
    expect(acceptDictionaryName("TRAVEL", existing, 2)).toBe("TRAVEL");
  });
});
