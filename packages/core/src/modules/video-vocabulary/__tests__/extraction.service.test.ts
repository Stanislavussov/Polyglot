import { describe, expect, it, vi } from "vitest";
import { extractPhrasesFromTranscript } from "../extraction.service.js";
import type { ExtractionResult } from "../types.js";

describe("extractPhrasesFromTranscript", () => {
  it("calls generateObject with correct params and returns phrases", async () => {
    const mockResult: ExtractionResult = {
      phrases: [
        {
          phrase: "break it down",
          nativeTranslation: "разобрать",
          emoji: "🔨",
          type: "idiom",
          level: "B2",
          context: "Let me break it down for you",
          timestampSeconds: 120,
        },
        {
          phrase: "cut to the chase",
          nativeTranslation: "перейти к делу",
          emoji: "✂️",
          type: "idiom",
          level: "C1",
          context: "Let's cut to the chase here",
          timestampSeconds: 450,
        },
      ],
    };

    const generateObject = vi.fn().mockResolvedValue(mockResult);

    const phrases = await extractPhrasesFromTranscript(
      "some transcript",
      "English",
      "B2",
      30,
      generateObject,
      "google/gemini-3.1-flash-lite",
      "Russian",
    );

    expect(generateObject).toHaveBeenCalledOnce();
    expect(phrases).toHaveLength(2);
    expect(phrases[0].phrase).toBe("break it down");
    expect(phrases[0].nativeTranslation).toBe("разобрать");
    expect(phrases[0].emoji).toBe("🔨");
    expect(phrases[1].phrase).toBe("cut to the chase");
  });

  it("truncates results to the target count", async () => {
    const mockResult: ExtractionResult = {
      phrases: Array.from({ length: 50 }, (_, i) => ({
        phrase: `phrase ${i}`,
        nativeTranslation: `перевод ${i}`,
        emoji: "📝",
        type: "word" as const,
        level: "B2" as const,
        context: `context ${i}`,
        timestampSeconds: i * 10,
      })),
    };

    const generateObject = vi.fn().mockResolvedValue(mockResult);
    const phrases = await extractPhrasesFromTranscript(
      "text",
      "English",
      "B2",
      30,
      generateObject,
      "model-id",
      "Russian",
    );

    expect(phrases).toHaveLength(30);
  });

  it("passes model ID and a token budget scaled to the target", async () => {
    const generateObject = vi.fn().mockResolvedValue({ phrases: [] });
    await extractPhrasesFromTranscript(
      "text",
      "English",
      "B2",
      40,
      generateObject,
      "google/gemini-3.1-flash-lite",
      "Russian",
    );

    expect(generateObject).toHaveBeenCalledWith(
      expect.any(String),
      expect.anything(),
      "google/gemini-3.1-flash-lite",
      expect.objectContaining({ maxTokens: expect.any(Number) }),
    );
    // 40 phrases * 160 tokens = 6400, above the 4096 floor.
    const passedMaxTokens = generateObject.mock.calls[0][3].maxTokens;
    expect(passedMaxTokens).toBeGreaterThanOrEqual(6400);
  });

  it("filters out phrases the learner already knows, case-insensitively", async () => {
    const mockResult: ExtractionResult = {
      phrases: [
        {
          phrase: "Break It Down",
          nativeTranslation: "разобрать",
          emoji: "🔨",
          type: "idiom",
          level: "B2",
          context: "ctx",
          timestampSeconds: 10,
        },
        {
          phrase: "cut to the chase",
          nativeTranslation: "перейти к делу",
          emoji: "✂️",
          type: "idiom",
          level: "C1",
          context: "ctx",
          timestampSeconds: 20,
        },
      ],
    };
    const generateObject = vi.fn().mockResolvedValue(mockResult);

    const phrases = await extractPhrasesFromTranscript(
      "text",
      "English",
      "B2",
      30,
      generateObject,
      "model-id",
      "Russian",
      ["  break it down  ", "already saved word"],
    );

    expect(phrases).toHaveLength(1);
    expect(phrases[0].phrase).toBe("cut to the chase");
  });

  it("passes the known phrases into the prompt as a hint", async () => {
    const generateObject = vi.fn().mockResolvedValue({ phrases: [] });

    await extractPhrasesFromTranscript("text", "English", "B2", 30, generateObject, "model-id", "Russian", [
      "serendipity",
    ]);

    const prompt = generateObject.mock.calls[0][0] as string;
    expect(prompt).toContain("serendipity");
    expect(prompt).toContain("DO NOT extract");
  });

  it("behaves as before when no known phrases are given", async () => {
    const mockResult: ExtractionResult = {
      phrases: [
        {
          phrase: "break it down",
          nativeTranslation: "разобрать",
          emoji: "🔨",
          type: "idiom",
          level: "B2",
          context: "ctx",
          timestampSeconds: 10,
        },
      ],
    };
    const generateObject = vi.fn().mockResolvedValue(mockResult);

    const phrases = await extractPhrasesFromTranscript(
      "text",
      "English",
      "B2",
      30,
      generateObject,
      "model-id",
      "Russian",
    );

    expect(phrases).toHaveLength(1);
    const prompt = generateObject.mock.calls[0][0] as string;
    expect(prompt).not.toContain("Already Known");
  });
});
