import { describe, expect, it } from "vitest";
import { analyzeInput, classifyInput } from "../input-analyzer.js";

// ─────────────────────────────────────────────
// Basic classification (parity with legacy classifyInput)
// ─────────────────────────────────────────────

describe("analyzeInput — classification", () => {
  it('classifies a single word as "word"', () => {
    const result = analyzeInput("hello");
    expect(result.type).toBe("word");
    expect(result.features.wordCount).toBe(1);
  });

  it('classifies two words as "word" (within maxWordTokens=2)', () => {
    const result = analyzeInput("good morning");
    expect(result.type).toBe("word");
    expect(result.features.wordCount).toBe(2);
  });

  it('classifies 4 words as "phrase"', () => {
    const result = analyzeInput("how are you doing");
    expect(result.type).toBe("phrase");
    expect(result.features.wordCount).toBe(4);
  });

  it('classifies short question with ? as "phrase" (punctuation is metadata)', () => {
    const result = analyzeInput("How are you?");
    expect(result.type).toBe("phrase");
    expect(result.features.wordCount).toBe(3);
    expect(result.features.hasSentencePunctuation).toBe(true);
  });

  it('classifies long input (>6 words) as "sentence"', () => {
    const result = analyzeInput("Can you tell me where the nearest pharmacy is?");
    expect(result.type).toBe("sentence");
    expect(result.features.wordCount).toBe(9);
  });

  it('classifies exactly 6 words as "phrase" (boundary)', () => {
    const result = analyzeInput("one two three four five six");
    expect(result.type).toBe("phrase");
  });

  it('classifies 7 words as "sentence" (boundary)', () => {
    const result = analyzeInput("one two three four five six seven");
    expect(result.type).toBe("sentence");
  });

  it("handles empty/whitespace input as word with wordCount 0", () => {
    const result = analyzeInput("   ");
    expect(result.type).toBe("word");
    expect(result.features.wordCount).toBe(0);
  });

  it("respects custom maxPhraseTokens config", () => {
    const result = analyzeInput("one two three", { maxPhraseTokens: 2 });
    expect(result.type).toBe("sentence");
  });

  it("respects custom maxWordTokens config", () => {
    const result = analyzeInput("one two three", { maxWordTokens: 3 });
    expect(result.type).toBe("word");
  });

  it("detects CJK sentence punctuation", () => {
    const result = analyzeInput("テスト。");
    expect(result.features.hasSentencePunctuation).toBe(true);
  });
});

// ─────────────────────────────────────────────
// Feature detection
// ─────────────────────────────────────────────

describe("analyzeInput — placeholder detection", () => {
  it("detects single-brace placeholders {name}", () => {
    const result = analyzeInput("Hello {name}");
    expect(result.features.hasPlaceholders).toBe(true);
  });

  it("detects double-brace placeholders {{count}}", () => {
    const result = analyzeInput("You have {{count}} messages");
    expect(result.features.hasPlaceholders).toBe(true);
  });

  it("detects printf-style placeholders %s", () => {
    const result = analyzeInput("Hello %s");
    expect(result.features.hasPlaceholders).toBe(true);
  });

  it(`detects template-literal placeholders \${var}`, () => {
    const result = analyzeInput(`Value: \${value}`);
    expect(result.features.hasPlaceholders).toBe(true);
  });

  it("returns false for plain text without placeholders", () => {
    const result = analyzeInput("hello world");
    expect(result.features.hasPlaceholders).toBe(false);
  });
});

describe("analyzeInput — URL detection", () => {
  it("detects http:// URLs", () => {
    const result = analyzeInput("Visit http://example.com");
    expect(result.features.hasUrl).toBe(true);
  });

  it("detects https:// URLs", () => {
    const result = analyzeInput("See https://example.com/page");
    expect(result.features.hasUrl).toBe(true);
  });

  it("detects www. URLs", () => {
    const result = analyzeInput("Go to www.example.com");
    expect(result.features.hasUrl).toBe(true);
  });

  it("returns false for plain text", () => {
    const result = analyzeInput("hello world");
    expect(result.features.hasUrl).toBe(false);
  });
});

describe("analyzeInput — Markdown detection", () => {
  it("detects **bold** markdown", () => {
    const result = analyzeInput("This is **bold** text");
    expect(result.features.hasMarkdown).toBe(true);
  });

  it("detects [link](url) markdown", () => {
    const result = analyzeInput("See [docs](http://example.com)");
    expect(result.features.hasMarkdown).toBe(true);
  });

  it("detects # heading markdown", () => {
    const result = analyzeInput("# Heading text");
    expect(result.features.hasMarkdown).toBe(true);
  });

  it("detects - list markdown", () => {
    const result = analyzeInput("- list item");
    expect(result.features.hasMarkdown).toBe(true);
  });

  it("returns false for plain text", () => {
    const result = analyzeInput("hello world");
    expect(result.features.hasMarkdown).toBe(false);
  });
});

describe("analyzeInput — date detection", () => {
  it("detects numeric date 06/07", () => {
    const result = analyzeInput("Meeting on 06/07");
    expect(result.features.hasDates).toBe(true);
  });

  it("detects ISO date 2024-01-15", () => {
    const result = analyzeInput("Deadline: 2024-01-15");
    expect(result.features.hasDates).toBe(true);
  });

  it("detects named month date Jan 5", () => {
    const result = analyzeInput("See you Jan 5");
    expect(result.features.hasDates).toBe(true);
  });

  it("detects time reference at 5pm", () => {
    const result = analyzeInput("Let's meet at 5pm");
    expect(result.features.hasDates).toBe(true);
  });

  it("detects 17:00 time", () => {
    const result = analyzeInput("Train at 17:00");
    expect(result.features.hasDates).toBe(true);
  });

  it("detects relative date tomorrow", () => {
    const result = analyzeInput("See you tomorrow");
    expect(result.features.hasDates).toBe(true);
  });

  it("returns false for plain text", () => {
    const result = analyzeInput("hello world");
    expect(result.features.hasDates).toBe(false);
  });
});

describe("analyzeInput — code-switching detection", () => {
  it("detects Cyrillic + Latin mixing", () => {
    const result = analyzeInput("Привет hello");
    expect(result.features.hasCodeSwitching).toBe(true);
  });

  it("detects Latin + CJK mixing", () => {
    const result = analyzeInput("Hello 世界");
    expect(result.features.hasCodeSwitching).toBe(true);
  });

  it("returns false for single-script text", () => {
    const result = analyzeInput("hello world");
    expect(result.features.hasCodeSwitching).toBe(false);
  });

  it("returns false for pure Cyrillic", () => {
    const result = analyzeInput("привет мир");
    expect(result.features.hasCodeSwitching).toBe(false);
  });
});

// ─────────────────────────────────────────────
// Feature-based classification overrides
// ─────────────────────────────────────────────

describe("analyzeInput — feature-based overrides", () => {
  it("classifies URL-only short input as sentence", () => {
    const result = analyzeInput("https://example.com");
    expect(result.type).toBe("sentence");
    expect(result.features.hasUrl).toBe(true);
  });

  it("classifies code-switched short input as sentence", () => {
    const result = analyzeInput("Привет hello");
    expect(result.type).toBe("sentence");
    expect(result.features.hasCodeSwitching).toBe(true);
  });

  it("does not override when URL is part of a longer phrase", () => {
    // 7+ words is already "sentence", so this just verifies no downgrade
    const result = analyzeInput("Check out this link https://example.com for more info");
    expect(result.type).toBe("sentence");
  });
});

// ─────────────────────────────────────────────
// Backward-compatible classifyInput
// ─────────────────────────────────────────────

describe("classifyInput — backward compatibility", () => {
  it('classifies a single word as "word"', () => {
    const result = classifyInput("hello");
    expect(result).toEqual({ type: "word", wordCount: 1, hasSentencePunctuation: false });
  });

  it('classifies two words as "word"', () => {
    const result = classifyInput("good morning");
    expect(result).toEqual({ type: "word", wordCount: 2, hasSentencePunctuation: false });
  });

  it('classifies 4 words as "phrase"', () => {
    const result = classifyInput("how are you doing");
    expect(result).toEqual({ type: "phrase", wordCount: 4, hasSentencePunctuation: false });
  });

  it('classifies short question with ? as "phrase"', () => {
    const result = classifyInput("How are you?");
    expect(result).toEqual({ type: "phrase", wordCount: 3, hasSentencePunctuation: true });
  });

  it('classifies long input as "sentence"', () => {
    const result = classifyInput("Can you tell me where the nearest pharmacy is?");
    expect(result.type).toBe("sentence");
    expect(result.wordCount).toBe(9);
    expect(result.hasSentencePunctuation).toBe(true);
  });

  it("handles empty string as word with wordCount 0", () => {
    const result = classifyInput("");
    expect(result).toEqual({ type: "word", wordCount: 0, hasSentencePunctuation: false });
  });

  it("trims leading/trailing whitespace before classification", () => {
    const result = classifyInput("  hello world  ");
    expect(result).toEqual({ type: "word", wordCount: 2, hasSentencePunctuation: false });
  });

  it("detects CJK sentence punctuation", () => {
    const result = classifyInput("テスト。");
    expect(result.hasSentencePunctuation).toBe(true);
  });

  it('classifies 2-word exclamation as "word" (despite punctuation)', () => {
    const result = classifyInput("Guten Tag!");
    expect(result).toEqual({ type: "word", wordCount: 2, hasSentencePunctuation: true });
  });
});
