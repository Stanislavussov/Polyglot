/**
 * Spec for praise selection (plan §2.3, §8.2.1): praise is earned by evidence, is
 * rare by construction, and is returned as an i18n key so the copy stays in the bot.
 */
import { describe, expect, it } from "vitest";
import { PRAISE_COOLDOWN_MS, PRAISE_WEEKLY_CAP, type PraiseEvidence, selectPraise } from "../praise.selector.js";

const NOW = new Date("2026-08-20T12:00:00.000Z");
const NOTHING_CLAIMED: ReadonlySet<string> = new Set();

function evidence(overrides: Partial<PraiseEvidence> = {}): PraiseEvidence {
  return { dictionaryCount: 12, matureCount: 3, ...overrides };
}

describe("selectPraise", () => {
  it("praises a word that crossed into long-term memory, as a key and params", () => {
    const outcome = selectPraise({
      evidence: evidence({ matureCrossedNow: { entryWord: "Kündigung", translationId: 7 } }),
      lastPraiseAt: null,
      praiseCountLast7d: 0,
      praisedKinds: NOTHING_CLAIMED,
      now: NOW,
    });

    expect(outcome).toEqual({
      decision: { kind: "mature_word", i18nKey: "praiseMatureWord", params: { word: "Kündigung" } },
    });
  });

  it("never praises a mature word for a user with none", () => {
    const outcome = selectPraise({
      evidence: evidence({ matureCount: 0, matureCrossedNow: { entryWord: "Kündigung", translationId: 7 } }),
      lastPraiseAt: null,
      praiseCountLast7d: 0,
      praisedKinds: NOTHING_CLAIMED,
      now: NOW,
    });

    expect(outcome).toEqual({ suppressed: "no_evidence" });
  });

  it("suppresses while the 24h cooldown is alive and releases once it expires", () => {
    const input = {
      evidence: evidence({ matureCrossedNow: { translationId: 7 } }),
      praiseCountLast7d: 0,
      praisedKinds: NOTHING_CLAIMED,
      now: NOW,
    };

    const inCooldown = selectPraise({ ...input, lastPraiseAt: new Date(NOW.getTime() - PRAISE_COOLDOWN_MS + 1000) });
    const expired = selectPraise({ ...input, lastPraiseAt: new Date(NOW.getTime() - PRAISE_COOLDOWN_MS) });

    expect(inCooldown).toEqual({ suppressed: "cooldown" });
    expect("decision" in expired).toBe(true);
  });

  it("suppresses once the weekly cap is spent", () => {
    const outcome = selectPraise({
      evidence: evidence({ matureCrossedNow: { translationId: 7 } }),
      lastPraiseAt: null,
      praiseCountLast7d: PRAISE_WEEKLY_CAP,
      praisedKinds: NOTHING_CLAIMED,
      now: NOW,
    });

    expect(outcome).toEqual({ suppressed: "weekly_cap" });
  });

  it("suppresses with no_evidence when nothing happened", () => {
    const outcome = selectPraise({
      evidence: evidence({ dictionaryCount: 12, previousDictionaryCount: 11 }),
      lastPraiseAt: null,
      praiseCountLast7d: 0,
      praisedKinds: NOTHING_CLAIMED,
      now: NOW,
    });

    expect(outcome).toEqual({ suppressed: "no_evidence" });
  });

  it("praises a dictionary milestone only on the update that crosses it", () => {
    const crossing = selectPraise({
      evidence: evidence({ dictionaryCount: 10, previousDictionaryCount: 9 }),
      lastPraiseAt: null,
      praiseCountLast7d: 0,
      praisedKinds: NOTHING_CLAIMED,
      now: NOW,
    });
    const alreadyPast = selectPraise({
      evidence: evidence({ dictionaryCount: 11, previousDictionaryCount: 10 }),
      lastPraiseAt: null,
      praiseCountLast7d: 0,
      praisedKinds: NOTHING_CLAIMED,
      now: NOW,
    });

    expect(crossing).toEqual({
      decision: { kind: "dictionary_10", i18nKey: "praiseDictionary10", params: { count: 10 } },
    });
    expect(alreadyPast).toEqual({ suppressed: "no_evidence" });
  });

  it("reports the highest milestone crossed in one jump", () => {
    const outcome = selectPraise({
      evidence: evidence({ dictionaryCount: 52, previousDictionaryCount: 8 }),
      lastPraiseAt: null,
      praiseCountLast7d: 0,
      praisedKinds: NOTHING_CLAIMED,
      now: NOW,
    });

    expect(outcome).toEqual({
      decision: { kind: "dictionary_50", i18nKey: "praiseDictionary50", params: { count: 52 } },
    });
  });

  it("never offers a once-ever milestone this user has already claimed", () => {
    const outcome = selectPraise({
      evidence: evidence({ dictionaryCount: 10, previousDictionaryCount: 9 }),
      lastPraiseAt: null,
      praiseCountLast7d: 0,
      praisedKinds: new Set(["dictionary_10"]),
      now: NOW,
    });

    expect(outcome).toEqual({ suppressed: "no_evidence" });
  });

  it("still offers a repeatable praise to a user who claimed a milestone", () => {
    const outcome = selectPraise({
      evidence: evidence({ dictionaryCount: 10, previousDictionaryCount: 9, hardWordRecalledToday: true }),
      lastPraiseAt: null,
      praiseCountLast7d: 0,
      praisedKinds: new Set(["dictionary_10"]),
      now: NOW,
    });

    expect(outcome).toEqual({
      decision: { kind: "hard_word_recalled", i18nKey: "praiseHardWordRecalled", params: {} },
    });
  });

  it("prefers the mature word over a milestone reached in the same update", () => {
    const outcome = selectPraise({
      evidence: evidence({
        dictionaryCount: 10,
        previousDictionaryCount: 9,
        matureCrossedNow: { entryWord: "Kündigung", translationId: 7 },
      }),
      lastPraiseAt: null,
      praiseCountLast7d: 0,
      praisedKinds: NOTHING_CLAIMED,
      now: NOW,
    });

    expect(outcome).toEqual({
      decision: { kind: "mature_word", i18nKey: "praiseMatureWord", params: { word: "Kündigung" } },
    });
  });
});
