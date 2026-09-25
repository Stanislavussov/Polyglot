/**
 * Preset word picker — the layer that keeps a re-engagement notification
 * possible when the user's own dictionary cannot supply one.
 *
 * A user who drifted away is very often exactly the user with an empty or
 * already-exhausted dictionary, so "no word to send" and "most needs a nudge"
 * are the same population. Falling back to the curated hook words means that
 * population still gets something worth opening, in a language they study.
 *
 * Two sources:
 *  1. the reviewed onboarding demo-card cache — already rendered, already
 *     human-approved, free to serve;
 *  2. a just-in-time AI translation, for a pair no reviewed card covers.
 *
 * **Freshness outranks cost.** The free source is searched across the whole pool
 * before any translation is paid for, but only within one freshness tier: a word
 * the user has not seen is served whatever it costs, and a word they have seen
 * only once no unseen word can be produced at all. Getting this backwards is a
 * regression with a very quiet failure mode — the warm-up script writes its rows
 * pending review (`is_active = false`) and only reviewed rows are ever served,
 * so a handful of the pool is servable for free at any time, and a cost-first
 * order parks every user inside that handful and mails it round and round. That
 * loop is the whole reason this layer was rewritten; one cheap translation is
 * worth strictly more than repeating yesterday's word.
 *
 * The JIT path also covers native languages the warm-up has never been run for,
 * and a fallback that silently never fires is how the demo cache itself sat
 * unusable for a release.
 */
import { getHookWords, logEvent } from "@polyglot/core";
import type { PresetWordPickerDeps, SuggestedWord } from "./types.js";

/** One curated headword together with the language it belongs to. */
interface PresetCandidate {
  lang: string;
  headword: string;
}

/**
 * Deterministic permutation of `items` for `seed`.
 *
 * Fisher-Yates over mulberry32 rather than `Math.random`, because the order has
 * to be *reproducible*: it is recomputed from scratch on every tick, and only
 * the de-dup memory is allowed to advance between sends. A re-rolled order
 * would re-serve words the user has already been shown.
 */
function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  let state = (seed | 0) + 0x6d2b79f5;
  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/**
 * Every curated headword across the languages this user studies, in the order
 * that user should receive them.
 *
 * Interleaved by index rather than grouped by language, so a two-language
 * learner alternates between them instead of exhausting the first language
 * before ever seeing the second.
 *
 * `seed` (the user id) shuffles each language's list before interleaving.
 * Without it every user in a language shares one queue: the picker takes the
 * first candidate it has not sent yet, so the whole cohort gets the same
 * headword on the same day and every rotation restarts at the same word. The
 * shuffle is per language, so the alternation guarantee survives it.
 */
export function presetCandidates(learningLangs: readonly string[], seed = 0): PresetCandidate[] {
  const perLang = learningLangs.map((lang, langIndex) =>
    seededShuffle(
      getHookWords(lang).map((hook) => ({ lang, headword: hook.headword })),
      // Decorrelated per language, or every list would be permuted alike and a
      // two-language learner would walk both in lockstep.
      Math.imul(seed, 0x9e3779b1) + langIndex,
    ),
  );
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

/**
 * Candidates in send order: everything the user has never seen first, then the
 * seen ones, least recently sent first.
 *
 * `recentWords` arrives newest first, so a word's index in it *is* its
 * freshness — a higher index means "seen longer ago". Ranking rather than
 * filtering is what keeps the layer alive once the pool has been worked
 * through: the alternative, returning nothing, mails the "add some words"
 * prompt to exactly the lapsed user this fallback exists for.
 */
function rankByStaleness(
  candidates: readonly PresetCandidate[],
  recentWords: readonly string[],
): { unseen: PresetCandidate[]; seen: PresetCandidate[] } {
  const freshness = new Map<string, number>();
  recentWords.forEach((word, index) => {
    if (!freshness.has(word)) freshness.set(word, index);
  });

  const staleness = (candidate: PresetCandidate): number =>
    freshness.get(candidate.headword) ?? Number.POSITIVE_INFINITY;

  return {
    // Stable partition, so unseen candidates keep the per-user shuffled order.
    unseen: candidates.filter((candidate) => !freshness.has(candidate.headword)),
    seen: candidates
      .filter((candidate) => freshness.has(candidate.headword))
      .sort((a, b) => staleness(b) - staleness(a)),
  };
}

/**
 * The first word one of the two sources can supply, free source first.
 *
 * Cost order applies *within* a freshness tier and never across one: see the
 * module docstring for why a cheap translation beats repeating a word.
 */
async function resolveCheapestFirst(
  deps: PresetWordPickerDeps,
  nativeLang: string,
  candidates: readonly PresetCandidate[],
): Promise<SuggestedWord | null> {
  const uncached: PresetCandidate[] = [];
  for (const candidate of candidates) {
    const cached = await loadReviewedCard(deps, nativeLang, candidate);
    if (cached) return cached;
    uncached.push(candidate);
  }

  for (const candidate of uncached) {
    const translated = await translateOnDemand(deps, nativeLang, candidate);
    if (translated) return translated;
  }

  return null;
}

export function createPresetWordPicker(deps: PresetWordPickerDeps) {
  /**
   * @param recentWords words already sent inside the de-dup window, **newest
   * first**. A preset is never repeated while an unseen one remains; once they
   * have all been seen the order decides which is stalest, so passing this in
   * the wrong direction would re-send the freshest word instead of the oldest.
   */
  return async function pickPresetWord(
    user: { userId: number; nativeLang: string; learningLangs: string[] },
    recentWords: string[] = [],
  ): Promise<SuggestedWord | null> {
    const all = presetCandidates(user.learningLangs, user.userId);
    if (all.length === 0) {
      // The user studies only languages with no curated set — not an error, but
      // it silently costs them the whole fallback layer, so make it visible.
      logEvent("notification.preset.no_candidates", { learningLangs: user.learningLangs }, "warn");
      return null;
    }

    const sentBefore = new Set(recentWords);
    if (all.every((candidate) => sentBefore.has(candidate.headword))) {
      logEvent("notification.preset.cycle_restart", { candidateCount: all.length });
    }

    const { unseen, seen } = rankByStaleness(all, recentWords);

    // Freshness outranks cost, and the two tiers are tried strictly in turn: a
    // word they have not seen, whatever it costs, before any word they have.
    const fresh = await resolveCheapestFirst(deps, user.nativeLang, unseen);
    if (fresh) return fresh;

    const stalest = await resolveCheapestFirst(deps, user.nativeLang, seen);
    if (stalest) return stalest;

    logEvent("notification.preset.unresolvable", { attempted: all.length }, "warn");
    return null;
  };
}

/** The free source: a demo card already rendered and human-reviewed. */
async function loadReviewedCard(
  deps: PresetWordPickerDeps,
  nativeLang: string,
  candidate: PresetCandidate,
): Promise<SuggestedWord | null> {
  const cached = await deps.findDemoCard(candidate.lang, nativeLang, candidate.headword).catch(() => null);
  if (!cached) return null;

  logEvent("notification.preset.picked", {
    headword: candidate.headword,
    lang: candidate.lang,
    origin: "demo_card_cache",
  });
  return toSuggestedWord(candidate.headword, cached, candidate.lang);
}

/** The paid source: one AI translation, for a pair no reviewed card covers. */
async function translateOnDemand(
  deps: PresetWordPickerDeps,
  nativeLang: string,
  candidate: PresetCandidate,
): Promise<SuggestedWord | null> {
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
