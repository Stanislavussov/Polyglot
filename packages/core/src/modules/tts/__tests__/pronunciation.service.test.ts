import { describe, expect, it, vi } from "vitest";
import type { TtsCacheHit, TtsCacheRepository } from "../../../ports/tts-cache.repository.js";
import { normalizeTtsText, type PronunciationDeps, playPronunciation } from "../pronunciation.service.js";

const AUDIO = new Uint8Array([1, 2, 3]);

const INPUT = {
  text: "Haus",
  langCode: "de",
  modelId: "google/gemini-3.1-flash-tts-preview",
  voice: "Kore",
  maxChars: 200,
};

function makeDeps(overrides: Partial<PronunciationDeps> = {}): PronunciationDeps {
  const cache: TtsCacheRepository = {
    find: vi.fn<TtsCacheRepository["find"]>().mockResolvedValue(null),
    save: vi.fn<TtsCacheRepository["save"]>().mockResolvedValue(undefined),
    touch: vi.fn<TtsCacheRepository["touch"]>().mockResolvedValue(undefined),
    remove: vi.fn<TtsCacheRepository["remove"]>().mockResolvedValue(undefined),
  };
  return {
    cache,
    synthesize: vi.fn().mockResolvedValue({ bytes: AUDIO, generationId: "gen-tts-1" }),
    deliver: vi.fn().mockResolvedValue("file-123"),
    ...overrides,
  };
}

const hit = (id: number, fileId: string): TtsCacheHit => ({ id, telegramFileId: fileId });

describe("playPronunciation", () => {
  it("synthesizes on a cache miss, delivers the audio, and caches the file_id", async () => {
    const deps = makeDeps();

    const result = await playPronunciation(INPUT, deps);

    expect(result).toEqual({ ok: true, cached: false, charCount: 4, generationId: "gen-tts-1" });
    expect(deps.synthesize).toHaveBeenCalledWith({ text: "Haus", modelId: INPUT.modelId, voice: "Kore" });
    expect(deps.deliver).toHaveBeenCalledWith({ bytes: AUDIO });
    expect(deps.cache.save).toHaveBeenCalledWith({
      text: "Haus",
      langCode: "de",
      modelId: INPUT.modelId,
      voice: "Kore",
      telegramFileId: "file-123",
      charCount: 4,
    });
  });

  it("serves a cache hit without paying for synthesis", async () => {
    const deps = makeDeps();
    vi.mocked(deps.cache.find).mockResolvedValue(hit(7, "cached-file"));

    const result = await playPronunciation(INPUT, deps);

    expect(result).toEqual({ ok: true, cached: true, charCount: 4, generationId: null });
    expect(deps.synthesize).not.toHaveBeenCalled();
    expect(deps.deliver).toHaveBeenCalledWith({ fileId: "cached-file" });
    expect(deps.cache.touch).toHaveBeenCalledWith(7);
    expect(deps.cache.save).not.toHaveBeenCalled();
  });

  it("heals a stale file_id: drops the row, re-synthesizes, and still delivers", async () => {
    const deps = makeDeps();
    vi.mocked(deps.cache.find).mockResolvedValue(hit(7, "stale-file"));
    vi.mocked(deps.deliver)
      .mockRejectedValueOnce(new Error("Bad Request: wrong file identifier"))
      .mockResolvedValueOnce("fresh-file");

    const result = await playPronunciation(INPUT, deps);

    expect(result).toEqual({ ok: true, cached: false, charCount: 4, generationId: "gen-tts-1" });
    expect(deps.cache.remove).toHaveBeenCalledWith(7);
    expect(deps.synthesize).toHaveBeenCalledTimes(1);
    expect(deps.cache.save).toHaveBeenCalledWith(expect.objectContaining({ telegramFileId: "fresh-file" }));
  });

  it("refuses text over the cap before spending anything", async () => {
    const deps = makeDeps();

    const result = await playPronunciation({ ...INPUT, text: "a".repeat(201) }, deps);

    expect(result).toEqual({ ok: false, reason: "too_long" });
    expect(deps.cache.find).not.toHaveBeenCalled();
    expect(deps.synthesize).not.toHaveBeenCalled();
  });

  it("refuses to guess a model when none is configured", async () => {
    // Task 73: an unconfigured model is a refusal, never a hardcoded substitute.
    const deps = makeDeps();

    const result = await playPronunciation({ ...INPUT, modelId: "" }, deps);

    expect(result).toEqual({ ok: false, reason: "disabled" });
    expect(deps.synthesize).not.toHaveBeenCalled();
  });

  it("reports a provider failure without caching anything", async () => {
    const deps = makeDeps({ synthesize: vi.fn().mockRejectedValue(new Error("502 Bad Gateway")) });

    const result = await playPronunciation(INPUT, deps);

    expect(result).toEqual({ ok: false, reason: "synthesis_failed" });
    expect(deps.cache.save).not.toHaveBeenCalled();
  });

  it("keeps a delivered pronunciation successful when caching it loses the insert race", async () => {
    const deps = makeDeps();
    vi.mocked(deps.cache.save).mockRejectedValue(new Error("duplicate key value violates unique constraint"));

    const result = await playPronunciation(INPUT, deps);

    expect(result.ok).toBe(true);
  });

  it("treats whitespace-padded text as the same cache entry", async () => {
    const deps = makeDeps();

    await playPronunciation({ ...INPUT, text: "  der  Haus \n" }, deps);

    expect(deps.cache.find).toHaveBeenCalledWith(expect.objectContaining({ text: "der Haus" }));
    expect(deps.synthesize).toHaveBeenCalledWith(expect.objectContaining({ text: "der Haus" }));
  });
});

describe("normalizeTtsText", () => {
  it("collapses internal whitespace and trims the edges", () => {
    expect(normalizeTtsText("  guten   Tag \n")).toBe("guten Tag");
  });
});
