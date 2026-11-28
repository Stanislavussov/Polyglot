import { describe, expect, it } from "vitest";
import { tidyTranscript } from "../transcript.js";

describe("tidyTranscript", () => {
  it("drops the full stop after a single word", () => {
    expect(tidyTranscript("Apple.")).toBe("Apple");
    expect(tidyTranscript("  Яблоко. ")).toBe("Яблоко");
  });

  it("drops it after a short phrase, ellipsis included", () => {
    expect(tidyTranscript("good morning.")).toBe("good morning");
    expect(tidyTranscript("на всякий случай…")).toBe("на всякий случай");
  });

  it("keeps a question or exclamation mark on a short phrase", () => {
    expect(tidyTranscript("how are you?")).toBe("how are you?");
    expect(tidyTranscript("Wow!")).toBe("Wow!");
  });

  it("leaves a sentence's punctuation alone", () => {
    const sentence = "I would like to order a coffee with milk, please.";
    expect(tidyTranscript(sentence)).toBe(sentence);
  });

  it("returns a lone dot as it was rather than an empty text", () => {
    expect(tidyTranscript(".")).toBe(".");
  });
});
