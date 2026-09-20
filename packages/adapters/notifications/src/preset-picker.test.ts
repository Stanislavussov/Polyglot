import { initLanguageRegistry } from "@polyglot/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPresetWordPicker, presetCandidates } from "./preset-picker.js";
import type { PresetWordPickerDeps } from "./types.js";

const user = { userId: 1, nativeLang: "ru", learningLangs: ["de", "fr"] };

const cardFor = (text: string) => ({ emoji: "🎯", nativeMeaning: "meaning", translations: { ru: text } });

function buildDeps(overrides: Partial<PresetWordPickerDeps> = {}): PresetWordPickerDeps {
  return {
    findDemoCard: vi.fn().mockResolvedValue(cardFor("перевод")),
    ...overrides,
  };
}

beforeEach(() => {
  initLanguageRegistry([
    { code: "ru", name: "Russian", nativeName: "Русский", flag: "🇷🇺", isSupported: true },
    { code: "de", name: "German", nativeName: "Deutsch", flag: "🇩🇪", isSupported: true },
    { code: "fr", name: "French", nativeName: "Français", flag: "🇫🇷", isSupported: true },
  ]);
});

describe("presetCandidates", () => {
  it("alternates between the learning languages instead of draining the first", () => {
    // A two-language learner should see both languages early, not exhaust
    // German before French ever appears.
    const candidates = presetCandidates(["de", "fr"]);

    expect(candidates.length).toBeGreaterThan(2);
    expect(candidates[0]?.lang).toBe("de");
    expect(candidates[1]?.lang).toBe("fr");
  });

  it("returns nothing for a language with no curated set", () => {
    expect(presetCandidates(["xx"])).toEqual([]);
  });

  it("gives two users different queues so they are not mailed the same word on the same day", () => {
    // A shared queue is what made the whole layer feel like a handful of words:
    // the picker takes the first candidate it has not sent, so every user in a
    // language marched through the identical list from the identical start.
    const forUserA = presetCandidates(["de"], 1).map((c) => c.headword);
    const forUserB = presetCandidates(["de"], 2).map((c) => c.headword);

    expect(forUserA).not.toEqual(forUserB);
    expect([...forUserA].sort()).toEqual([...forUserB].sort());
  });

  it("keeps one user's queue stable across ticks", () => {
    // Only the de-dup memory may advance between sends — a re-rolled order
    // would re-serve words the user has already seen.
    expect(presetCandidates(["de", "fr"], 7)).toEqual(presetCandidates(["de", "fr"], 7));
  });
});

describe("pickPresetWord", () => {
  it("serves a reviewed cached card without paying for an AI call", async () => {
    const translateHeadword = vi.fn();
    const pick = createPresetWordPicker(buildDeps({ translateHeadword }));

    const word = await pick(user);

    expect(word).toMatchObject({ source: "preset", translations: { ru: "перевод" } });
    expect(word?.original).toEqual(expect.any(String));
    expect(translateHeadword).not.toHaveBeenCalled();
  });

  it("never repeats a preset the user was just sent", async () => {
    const pick = createPresetWordPicker(buildDeps());
    const all = presetCandidates(user.learningLangs).map((c) => c.headword);
    const alreadySent = all.slice(0, 1);

    const word = await pick(user, alreadySent);

    expect(word).not.toBeNull();
    expect(alreadySent).not.toContain(word?.original);
  });

  it("restarts the cycle with the stalest word once every preset has been sent", async () => {
    // Going silent here mails the "add some words" prompt to precisely the
    // lapsed user this fallback exists for. `recentWords` is newest first, so
    // the last entry is the one they saw longest ago.
    const pick = createPresetWordPicker(buildDeps());
    const newestFirst = presetCandidates(user.learningLangs, user.userId).map((c) => c.headword);

    const word = await pick(user, newestFirst);

    expect(word?.original).toBe(newestFirst.at(-1));
  });

  it("prefers a word the user has never seen over the stalest seen one", async () => {
    const pick = createPresetWordPicker(buildDeps());
    const queue = presetCandidates(user.learningLangs, user.userId).map((c) => c.headword);
    const allButLast = queue.slice(0, -1);

    const word = await pick(user, allButLast);

    expect(word?.original).toBe(queue.at(-1));
  });

  it("never re-sends the most recent preset when it restarts the cycle", async () => {
    // A restart that reached for the freshest word would repeat the previous
    // notification outright — the most visible form of the bug.
    const pick = createPresetWordPicker(buildDeps());
    const single = { userId: 5, nativeLang: "ru", learningLangs: ["de"] };
    const newestFirst = presetCandidates(single.learningLangs, single.userId).map((c) => c.headword);

    const word = await pick(single, newestFirst);

    expect(word?.original).not.toBe(newestFirst[0]);
  });

  it("exhausts the free reviewed cache across the whole pool before paying for a translation", async () => {
    // Cost order was applied per candidate, not across the pool: the first
    // headword in the queue billed an AI call even with dozens of reviewed cards
    // sitting behind it. Invisible while the queue was a fixed list whose head
    // was the reviewed part — a per-user order exposes it on every send.
    const reviewed = presetCandidates(user.learningLangs, user.userId).at(-1)?.headword;
    const translateHeadword = vi.fn().mockResolvedValue({ translations: { ru: "платный" } });
    const pick = createPresetWordPicker(
      buildDeps({
        findDemoCard: vi.fn(async (_lang, _native, headword) => (headword === reviewed ? cardFor("бесплатный") : null)),
        translateHeadword,
      }),
    );

    const word = await pick(user);

    expect(word).toMatchObject({ original: reviewed, translations: { ru: "бесплатный" } });
    expect(translateHeadword).not.toHaveBeenCalled();
  });

  it("still prefers an unseen word over a stale one within the reviewed cache", async () => {
    // Preferring the free path must not cost the anti-repetition guarantee: the
    // ranking still decides which of the reviewed cards is served.
    const queue = presetCandidates(user.learningLangs, user.userId).map((c) => c.headword);
    const reviewed = new Set([queue[0], queue[1]]);
    const pick = createPresetWordPicker(
      buildDeps({
        findDemoCard: vi.fn(async (_lang, _native, headword) =>
          reviewed.has(headword) ? cardFor(`перевод ${headword}`) : null,
        ),
      }),
    );

    const word = await pick(user, [queue[0] as string]);

    expect(word?.original).toBe(queue[1]);
  });

  it("pays for a fresh word rather than repeating a reviewed one", async () => {
    // Cost order must never outrank freshness. Only a handful of cards are
    // reviewed at any time, so preferring the free source across the whole pool
    // parked the user inside that handful — the very loop this layer was fixed
    // to stop. One cheap translation is worth a word they have not seen.
    const queue = presetCandidates(user.learningLangs, user.userId).map((c) => c.headword);
    const alreadySent = queue.slice(0, 3);
    const translateHeadword = vi.fn().mockResolvedValue({ translations: { ru: "свежий" } });
    const pick = createPresetWordPicker(
      buildDeps({
        // Reviewed cards cover only words the user has already been sent.
        findDemoCard: vi.fn(async (_lang, _native, headword) =>
          alreadySent.includes(headword) ? cardFor("уже видел") : null,
        ),
        translateHeadword,
      }),
    );

    const word = await pick(user, [...alreadySent].reverse());

    expect(alreadySent).not.toContain(word?.original);
    expect(translateHeadword).toHaveBeenCalled();
  });

  it("falls back to a just-in-time translation when no reviewed card covers the pair", async () => {
    // The cache only covers the native languages the warm-up ran for; without
    // this path the whole layer would be silently dead for everyone else.
    const translateHeadword = vi.fn().mockResolvedValue({ translations: { ru: "живой перевод" } });
    const pick = createPresetWordPicker(
      buildDeps({ findDemoCard: vi.fn().mockResolvedValue(null), translateHeadword }),
    );

    const word = await pick(user);

    expect(word).toMatchObject({ source: "preset", translations: { ru: "живой перевод" } });
    expect(translateHeadword).toHaveBeenCalled();
  });

  it("returns null when neither source can resolve a word", async () => {
    const pick = createPresetWordPicker(buildDeps({ findDemoCard: vi.fn().mockResolvedValue(null) }));

    expect(await pick(user)).toBeNull();
  });

  it("survives a cache lookup that throws and moves on to the next source", async () => {
    const translateHeadword = vi.fn().mockResolvedValue({ translations: { ru: "запасной" } });
    const pick = createPresetWordPicker(
      buildDeps({ findDemoCard: vi.fn().mockRejectedValue(new Error("db down")), translateHeadword }),
    );

    await expect(pick(user)).resolves.toMatchObject({ translations: { ru: "запасной" } });
  });

  it("returns null for a user whose languages have no curated presets at all", async () => {
    const pick = createPresetWordPicker(buildDeps());

    expect(await pick({ userId: 1, nativeLang: "ru", learningLangs: ["xx"] })).toBeNull();
  });
});
