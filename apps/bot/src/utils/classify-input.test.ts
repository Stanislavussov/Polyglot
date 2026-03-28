import { describe, expect, it } from "vitest";
import { classifyInput } from "./classify-input.js";

describe("classifyInput", () => {
  it('classifies a single word as "word"', () => {
    const result = classifyInput("hello");
    expect(result).toEqual({ type: "word", wordCount: 1, hasSentencePunctuation: false });
  });

  it('classifies two words as "word" (within maxWordTokens=2)', () => {
    const result = classifyInput("good morning");
    expect(result).toEqual({ type: "word", wordCount: 2, hasSentencePunctuation: false });
  });

  it('classifies 4 words as "phrase"', () => {
    const result = classifyInput("how are you doing");
    expect(result).toEqual({ type: "phrase", wordCount: 4, hasSentencePunctuation: false });
  });

  it('classifies short question with ? as "phrase" (punctuation is metadata only)', () => {
    const result = classifyInput("How are you?");
    expect(result).toEqual({ type: "phrase", wordCount: 3, hasSentencePunctuation: true });
  });

  it('classifies 2-word exclamation as "word" (despite punctuation)', () => {
    const result = classifyInput("Guten Tag!");
    expect(result).toEqual({ type: "word", wordCount: 2, hasSentencePunctuation: true });
  });

  it('classifies long input (>6 words) as "sentence"', () => {
    const result = classifyInput("Can you tell me where the nearest pharmacy is?");
    expect(result.type).toBe("sentence");
    expect(result.wordCount).toBe(9);
    expect(result.hasSentencePunctuation).toBe(true);
  });

  it('classifies 11-word input as "sentence"', () => {
    const result = classifyInput("I went to the store and bought some milk and bread");
    expect(result.type).toBe("sentence");
    expect(result.wordCount).toBe(11);
    expect(result.hasSentencePunctuation).toBe(false);
  });

  it('classifies German sentence as "sentence"', () => {
    const result = classifyInput("Können Sie mir sagen wo die nächste Apotheke ist");
    expect(result.type).toBe("sentence");
    expect(result.wordCount).toBe(9);
  });

  it("handles empty/whitespace input as word with wordCount 0", () => {
    const result = classifyInput("   ");
    expect(result).toEqual({ type: "word", wordCount: 0, hasSentencePunctuation: false });
  });

  it("handles empty string as word with wordCount 0", () => {
    const result = classifyInput("");
    expect(result).toEqual({ type: "word", wordCount: 0, hasSentencePunctuation: false });
  });

  it('classifies single long word as "word"', () => {
    const result = classifyInput("Pneumonoultramicroscopicsilicovolcanoconiosis");
    expect(result).toEqual({ type: "word", wordCount: 1, hasSentencePunctuation: false });
  });

  it("respects custom maxPhraseTokens config", () => {
    const result = classifyInput("one two three", { maxPhraseTokens: 2 });
    expect(result.type).toBe("sentence");
    expect(result.wordCount).toBe(3);
  });

  it("respects custom maxWordTokens config", () => {
    const result = classifyInput("one two three", { maxWordTokens: 3 });
    expect(result.type).toBe("word");
    expect(result.wordCount).toBe(3);
  });

  it("detects CJK sentence punctuation", () => {
    const result = classifyInput("テスト。");
    expect(result.hasSentencePunctuation).toBe(true);
  });

  it("detects ! as sentence punctuation", () => {
    const result = classifyInput("Watch out!");
    expect(result.hasSentencePunctuation).toBe(true);
  });

  it('classifies exactly 6 words as "phrase" (boundary)', () => {
    const result = classifyInput("one two three four five six");
    expect(result.type).toBe("phrase");
    expect(result.wordCount).toBe(6);
  });

  it('classifies 7 words as "sentence" (boundary)', () => {
    const result = classifyInput("one two three four five six seven");
    expect(result.type).toBe("sentence");
    expect(result.wordCount).toBe(7);
  });

  it("trims leading/trailing whitespace before classification", () => {
    const result = classifyInput("  hello world  ");
    expect(result).toEqual({ type: "word", wordCount: 2, hasSentencePunctuation: false });
  });
});
