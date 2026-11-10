/**
 * Pack word picker (Task 87) — the curated layer a lapsed learner is won back
 * with: a striking word from an editor's pack, in the language they study.
 *
 * Unlike the hook-word layer it never recycles. Once a learner has been sent
 * every pack word they can read, it returns null and the dictionary and
 * hook-word layers take over, so a pack never turns into a loop of reruns.
 */
import type { ActiveWordPackItem } from "@polyglot/core";
import { logEvent } from "@polyglot/core";
import { seededShuffle } from "./seeded-shuffle.js";
import type { PresetWordPickerDeps, SuggestedWord } from "./types.js";

/**
 * A word with no reviewed card costs an AI call. When translation is failing,
 * trying every word of every pack would burn one call per word per lapsed user.
 */
const MAX_TRANSLATION_ATTEMPTS = 3;

export interface PackWordPickerDeps extends PresetWordPickerDeps {
  findActivePackItems: () => Promise<ActiveWordPackItem[]>;
}

interface PackCandidate {
  lang: string;
  headword: string;
  item: ActiveWordPackItem;
}

/**
 * Pack words in the learner's send order, one language per word.
 *
 * Interleaved across learning languages, as the hook-word layer is, and shuffled
 * per learner so a cohort does not share one queue.
 */
function packCandidates(
  items: readonly ActiveWordPackItem[],
  user: { userId: number; nativeLang: string; learningLangs: string[] },
): PackCandidate[] {
  const claimed = new Set<number>();
  const perLang = user.learningLangs
    .filter((lang) => lang !== user.nativeLang)
    .map((lang, langIndex) =>
      seededShuffle(
        items.flatMap((item) => {
          const headword = item.headwords[lang];
          return headword ? [{ lang, headword, item }] : [];
        }),
        Math.imul(user.userId, 0x9e3779b1) + langIndex,
      ),
    );

  const ordered: PackCandidate[] = [];
  const longest = Math.max(0, ...perLang.map((list) => list.length));
  for (let index = 0; index < longest; index++) {
    for (const list of perLang) {
      const candidate = list[index];
      // One language per word: a bilingual learner gets the idea once, not twice.
      if (candidate && !claimed.has(candidate.item.itemId)) {
        claimed.add(candidate.item.itemId);
        ordered.push(candidate);
      }
    }
  }
  return ordered;
}

function toSuggestedWord(
  candidate: PackCandidate,
  output: { emoji?: string; nativeMeaning?: string; translations: Record<string, string> },
): SuggestedWord {
  return {
    original: candidate.headword,
    emoji: candidate.item.emoji ?? output.emoji ?? "✨",
    sourceLang: candidate.lang,
    ...(output.nativeMeaning !== undefined && { nativeMeaning: output.nativeMeaning }),
    translations: output.translations,
    source: "pack",
  };
}

export function createPackWordPicker(deps: PackWordPickerDeps) {
  /** @param recentWords words already sent to this learner; none of them is sent again. */
  return async function pickPackWord(
    user: { userId: number; nativeLang: string; learningLangs: string[] },
    recentWords: string[] = [],
  ): Promise<SuggestedWord | null> {
    const sent = new Set(recentWords);
    const candidates = packCandidates(await deps.findActivePackItems(), user).filter(
      (candidate) => !sent.has(candidate.headword),
    );

    for (const candidate of candidates) {
      const cached = await deps.findDemoCard(candidate.lang, user.nativeLang, candidate.headword).catch(() => null);
      if (cached) {
        logEvent("notification.pack.picked", { packId: candidate.item.packId, lang: candidate.lang, origin: "cache" });
        return toSuggestedWord(candidate, cached);
      }
    }

    if (!deps.translateHeadword) return null;
    for (const candidate of candidates.slice(0, MAX_TRANSLATION_ATTEMPTS)) {
      const translated = await deps
        .translateHeadword(candidate.headword, candidate.lang, user.nativeLang)
        .catch(() => null);
      if (translated) {
        logEvent("notification.pack.picked", { packId: candidate.item.packId, lang: candidate.lang, origin: "jit" });
        return toSuggestedWord(candidate, translated);
      }
    }

    if (candidates.length > 0) {
      logEvent("notification.pack.unresolvable", { attempted: candidates.length }, "warn");
    }
    return null;
  };
}
