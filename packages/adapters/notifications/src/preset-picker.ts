/**
 * Preset word picker — the layer that keeps a re-engagement notification
 * possible when the user's own dictionary cannot supply one.
 *
 * A user who drifted away is very often exactly the user with an empty or
 * already-exhausted dictionary, so "no word to send" and "most needs a nudge"
 * are the same population. Falling back to the curated hook words means that
 * population still gets something worth opening, in a language they study.
 *
 * Two sources, in cost order:
 *  1. the reviewed onboarding demo-card cache — already rendered, already
 *     human-approved, free to serve;
 *  2. a just-in-time AI translation, when no reviewed card covers the pair.
 *
 * The JIT path matters: the cache only covers the native languages the warm-up
 * script has been run for, and a fallback that silently never fires is how the
 * demo cache itself sat unusable for a release.
 */
import { getHookWords, logEvent } from "@polyglot/core";
import type { PresetWordPickerDeps, SuggestedWord } from "./types.js";

/** One curated headword together with the language it belongs to. */
interface PresetCandidate {
  lang: string;
  headword: string;
}

/**
 * Every curated headword across the languages this user studies.
 *
 * Interleaved by index rather than grouped by language, so a two-language
 * learner alternates between them instead of exhausting the first language
 * before ever seeing the second.
 */
export function presetCandidates(learningLangs: readonly string[]): PresetCandidate[] {
  const perLang = learningLangs.map((lang) => getHookWords(lang).map((hook) => ({ lang, headword: hook.headword })));
  const longest = Math.max(0, ...perLang.map((words) => words.length));
  const interleaved: PresetCandidate[] = [];
  for (let i = 0; i < longest; i++) {
    for (const words of perLang) {
      const candidate = words[i];
      if (candidate) interleaved.push(candidate);
    }
  }
  return interleaved;
}

export function createPresetWordPicker(deps: PresetWordPickerDeps) {
  /**
   * @param recentWords words already sent inside the de-dup window; a preset is
   * never repeated while an unseen one remains.
   */
  return async function pickPresetWord(
    user: { userId: number; nativeLang: string; learningLangs: string[] },
    recentWords: string[] = [],
  ): Promise<SuggestedWord | null> {
    const all = presetCandidates(user.learningLangs);
    if (all.length === 0) {
      // The user studies only languages with no curated set — not an error, but
      // it silently costs them the whole fallback layer, so make it visible.
      logEvent("notification.preset.no_candidates", { learningLangs: user.learningLangs }, "warn");
      return null;
    }

    const unseen = all.filter((candidate) => !recentWords.includes(candidate.headword));
    if (unseen.length === 0) {
      logEvent("notification.preset.exhausted", { candidateCount: all.length });
      return null;
    }

    for (const candidate of unseen) {
      const word = await resolvePreset(deps, user.nativeLang, candidate);
      if (word) return word;
    }

    logEvent("notification.preset.unresolvable", { attempted: unseen.length }, "warn");
    return null;
  };
}

/** Turn one curated headword into a sendable word, cache first, AI second. */
async function resolvePreset(
  deps: PresetWordPickerDeps,
  nativeLang: string,
  candidate: PresetCandidate,
): Promise<SuggestedWord | null> {
  const cached = await deps.findDemoCard(candidate.lang, nativeLang, candidate.headword).catch(() => null);
  if (cached) {
    logEvent("notification.preset.picked", {
      headword: candidate.headword,
      lang: candidate.lang,
      origin: "demo_card_cache",
    });
    return toSuggestedWord(candidate.headword, cached, candidate.lang);
  }

  if (!deps.translateHeadword) return null;

  const translated = await deps.translateHeadword(candidate.headword, candidate.lang, nativeLang).catch(() => null);
  if (!translated) return null;

  logEvent("notification.preset.picked", { headword: candidate.headword, lang: candidate.lang, origin: "jit" });
  return toSuggestedWord(candidate.headword, translated, candidate.lang);
}

function toSuggestedWord(headword: string, output: PresetTranslation, sourceLang?: string): SuggestedWord {
  return {
    original: headword,
    emoji: output.emoji ?? "✨",
    ...(sourceLang ? { sourceLang } : {}),
    ...(output.nativeMeaning !== undefined && { nativeMeaning: output.nativeMeaning }),
    translations: output.translations,
    source: "preset",
  };
}

/** The shape both preset sources reduce to. */
export interface PresetTranslation {
  emoji?: string;
  nativeMeaning?: string;
  translations: Record<string, string>;
}
