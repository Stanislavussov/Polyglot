import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableLanguageError,
  YoutubeTranscriptVideoUnavailableError,
  fetchTranscript as ytFetchTranscript,
} from "youtube-transcript";
import { fetchTranscript, TranscriptNotAvailableError, VideoNotFoundError } from "../transcript.js";

vi.mock("youtube-transcript", async (importOriginal) => ({
  ...(await importOriginal<typeof import("youtube-transcript")>()),
  fetchTranscript: vi.fn(),
}));

const ytFetch = vi.mocked(ytFetchTranscript);

const enSegments = [
  { text: "hello", offset: 0, duration: 1000, lang: "en" },
  { text: "world", offset: 1000, duration: 1000, lang: "en" },
];

beforeEach(() => {
  ytFetch.mockReset();
});

describe("fetchTranscript", () => {
  it("returns the transcript in the requested language when available", async () => {
    ytFetch.mockResolvedValueOnce([{ text: "привет", offset: 500, duration: 2000, lang: "ru" }]);

    const result = await fetchTranscript("vid123", "ru");

    expect(ytFetch).toHaveBeenCalledTimes(1);
    expect(ytFetch).toHaveBeenCalledWith("vid123", { lang: "ru" });
    expect(result.language).toBe("ru");
    expect(result.text).toBe("привет");
    expect(result.segments[0]).toEqual({ text: "привет", offset: 0.5, duration: 2 });
  });

  it("falls back to the default caption track when the requested language has none", async () => {
    ytFetch
      .mockRejectedValueOnce(new YoutubeTranscriptNotAvailableLanguageError("ru", ["en"], "vid123"))
      .mockResolvedValueOnce(enSegments);

    const result = await fetchTranscript("vid123", "ru");

    expect(ytFetch).toHaveBeenNthCalledWith(1, "vid123", { lang: "ru" });
    expect(ytFetch).toHaveBeenNthCalledWith(2, "vid123", undefined);
    expect(result.language).toBe("en");
    expect(result.text).toBe("hello world");
  });

  it("throws TranscriptNotAvailableError when the fallback also finds no transcript", async () => {
    ytFetch
      .mockRejectedValueOnce(new YoutubeTranscriptNotAvailableLanguageError("ru", [], "vid123"))
      .mockRejectedValueOnce(new YoutubeTranscriptDisabledError("vid123"));

    await expect(fetchTranscript("vid123", "ru")).rejects.toThrow(TranscriptNotAvailableError);
    expect(ytFetch).toHaveBeenCalledTimes(2);
  });

  it("throws TranscriptNotAvailableError without falling back when no language was requested", async () => {
    ytFetch.mockRejectedValueOnce(new YoutubeTranscriptDisabledError("vid123"));

    await expect(fetchTranscript("vid123")).rejects.toThrow(TranscriptNotAvailableError);
    expect(ytFetch).toHaveBeenCalledTimes(1);
  });

  it("throws VideoNotFoundError for unavailable videos without falling back", async () => {
    ytFetch.mockRejectedValueOnce(new YoutubeTranscriptVideoUnavailableError("vid123"));

    await expect(fetchTranscript("vid123", "ru")).rejects.toThrow(VideoNotFoundError);
    expect(ytFetch).toHaveBeenCalledTimes(1);
  });

  it("treats an empty segment list as no transcript", async () => {
    ytFetch.mockResolvedValueOnce([]);

    await expect(fetchTranscript("vid123", "ru")).rejects.toThrow(TranscriptNotAvailableError);
  });
});
