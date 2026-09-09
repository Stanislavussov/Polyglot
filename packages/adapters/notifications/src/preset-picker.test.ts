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

  it("returns null once every curated preset has been sent, rather than repeating one", async () => {
    const pick = createPresetWordPicker(buildDeps());
    const all = presetCandidates(user.learningLangs).map((c) => c.headword);

    expect(await pick(user, all)).toBeNull();
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
