import { describe, expect, it } from "vitest";
import { detectNonTextContent, isEmojiOnly } from "./validate-text-input.js";

describe("isEmojiOnly", () => {
  it("returns true for a single emoji", () => {
    expect(isEmojiOnly("😀")).toBe(true);
  });

  it("returns true for multiple emojis", () => {
    expect(isEmojiOnly("😀🎉👍")).toBe(true);
  });

  it("returns true for emojis with spaces", () => {
    expect(isEmojiOnly("😀 🎉 👍")).toBe(true);
  });

  it("returns true for flag emojis", () => {
    expect(isEmojiOnly("🇺🇸🇬🇧🇨🇿")).toBe(true);
  });

  it("returns true for ZWJ composite emoji (family)", () => {
    expect(isEmojiOnly("👨‍👩‍👧")).toBe(true);
  });

  it("returns true for emoji with skin tone modifier", () => {
    expect(isEmojiOnly("👍🏽")).toBe(true);
  });

  it("returns true for emoji with presentation selector", () => {
    expect(isEmojiOnly("⭐️")).toBe(true);
  });

  it("returns false for plain text", () => {
    expect(isEmojiOnly("hello")).toBe(false);
  });

  it("returns false for text with emoji", () => {
    expect(isEmojiOnly("hello 😀")).toBe(false);
  });

  it("returns false for emoji followed by text", () => {
    expect(isEmojiOnly("😀 hello")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isEmojiOnly("")).toBe(false);
  });

  it("returns false for whitespace only", () => {
    expect(isEmojiOnly("   ")).toBe(false);
  });

  it("returns false for numbers", () => {
    expect(isEmojiOnly("123")).toBe(false);
  });

  it("returns false for punctuation", () => {
    expect(isEmojiOnly("...")).toBe(false);
  });

  it("returns false for Cyrillic text", () => {
    expect(isEmojiOnly("привет")).toBe(false);
  });

  it("returns false for CJK characters", () => {
    expect(isEmojiOnly("你好")).toBe(false);
  });

  it("returns true for heart emoji", () => {
    expect(isEmojiOnly("❤️")).toBe(true);
  });

  it("returns true for multiple diverse emojis", () => {
    expect(isEmojiOnly("🏠🔥💯✨🎵")).toBe(true);
  });
});

describe("detectNonTextContent", () => {
  it("returns null for text-only message", () => {
    expect(detectNonTextContent({ text: "hello" })).toBeNull();
  });

  it("detects sticker", () => {
    expect(detectNonTextContent({ sticker: { file_id: "abc" } })).toBe("sticker");
  });

  it("detects animation (GIF)", () => {
    expect(detectNonTextContent({ animation: { file_id: "abc" } })).toBe("animation");
  });

  it("detects photo", () => {
    expect(detectNonTextContent({ photo: [{ file_id: "abc" }] })).toBe("photo");
  });

  it("detects voice message", () => {
    expect(detectNonTextContent({ voice: { file_id: "abc" } })).toBe("voice");
  });

  it("detects video", () => {
    expect(detectNonTextContent({ video: { file_id: "abc" } })).toBe("video");
  });

  it("detects video note", () => {
    expect(detectNonTextContent({ video_note: { file_id: "abc" } })).toBe("video_note");
  });

  it("detects audio", () => {
    expect(detectNonTextContent({ audio: { file_id: "abc" } })).toBe("audio");
  });

  it("detects document", () => {
    expect(detectNonTextContent({ document: { file_id: "abc" } })).toBe("document");
  });

  it("detects location", () => {
    expect(detectNonTextContent({ location: { latitude: 0, longitude: 0 } })).toBe("location");
  });

  it("detects contact", () => {
    expect(detectNonTextContent({ contact: { phone_number: "+1" } })).toBe("contact");
  });

  it("detects poll", () => {
    expect(detectNonTextContent({ poll: { question: "?" } })).toBe("poll");
  });

  it("detects dice", () => {
    expect(detectNonTextContent({ dice: { emoji: "🎲", value: 1 } })).toBe("dice");
  });

  it("returns null for empty message", () => {
    expect(detectNonTextContent({})).toBeNull();
  });

  it("returns first detected type when multiple present", () => {
    // sticker comes before photo in check order
    const result = detectNonTextContent({ sticker: { file_id: "a" }, photo: [{ file_id: "b" }] });
    expect(result).toBe("sticker");
  });
});
