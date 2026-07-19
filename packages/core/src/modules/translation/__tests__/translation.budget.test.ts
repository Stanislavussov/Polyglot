/**
 * Spec — Phase 2.5: bounding the post-generation AI tail.
 *
 * Behavior under test (public surface: `translate()` + `TranslateInput.deadlineAt`
 * + the `onPhase` observation seam). All time is driven by the injected
 * `now` clock so budget arithmetic is deterministic; only the genuine
 * time-box races use a real timer, with a wide margin.
 *
 * Non-goals: translation OUTPUT/product behavior. Phase 2.5 is a latency and
 * robustness change — with no `deadlineAt` the pipeline must behave exactly as
 * it did before budgets existed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../../../logger.js";
import { setLogger } from "../../../logger.js";
import { MIN_JUDGE_BUDGET_MS, RESERVED_JUDGE_MS } from "../budget.js";
import { translate } from "../translation.service.js";
import type { TranslateInput, TranslationPhase, TranslationResult } from "../types.js";

const mockLogger: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  setLogger(mockLogger);
});

// ─── fixtures ───────────────────────────────────────────────────────────────

/** A high-risk input: `inputType: "phrase"` alone scores HIGH, so the judge runs. */
const highRiskInput: TranslateInput = {
  word: "break a leg",
  sourceLang: "en",
  targetLangs: ["cs"],
  inputType: "phrase",
  model: "openai/gpt-4o",
};

function makeResult(csText: string): TranslationResult {
  return {
    emoji: "🍀",
    nativeSynonyms: [],
    translations: {
      cs: {
        text: csText,
        synonyms: [{ text: "hodně štěstí" }],
        examples: [
          { context: "neutral", target: "Zlom vaz na zkoušce." },
          { context: "colloquial", target: "Zlom vaz!" },
          { context: "professional", target: "Zlom vaz na prezentaci." },
        ],
        expressionType: null,
        equivalentNote: null,
        usageNote: null,
        alternatives: null,
        connotationWarning: null,
      },
    },
  };
}

/** A result whose cs block fails deterministic validation (translation === source). */
function makeUnfixableResult(): TranslationResult {
  return makeResult("break a leg");
}

const GOOD = makeResult("zlom vaz");
const JUDGE_PROMPT_MARKER = "translation quality judge";
const METADATA_MARKER = "Do NOT include any translations";
const LANG_MARKER = 'translation block for language "cs"';

function isJudgeCall(prompt: string): boolean {
  return prompt.includes(JUDGE_PROMPT_MARKER);
}

/**
 * Mock AI. `result` drives metadata + language + repair blocks; `judge` is the
 * judge response (or a function returning one, e.g. a promise that never
 * settles to simulate a hung judge). `onCall` runs before each response and is
 * how the tests advance the injected clock.
 */
function createMock(options: {
  result: TranslationResult;
  repaired?: TranslationResult;
  judge?: () => Promise<unknown>;
  onCall?: (prompt: string) => void;
  /** Real wall-clock delay a targeted-repair round takes before it answers. */
  repairDelayMs?: number;
}) {
  const { translations, ...metadata } = options.result;
  return vi.fn().mockImplementation(async (prompt: string) => {
    options.onCall?.(prompt);
    if (isPreflightCall(prompt)) {
      return { outcome: "proceed", confidence: 0.99, explanation: "", options: [], correctedText: null };
    }
    if (isJudgeCall(prompt)) {
      return options.judge ? await options.judge() : { issues: [], summary: "ok" };
    }
    if (prompt.includes(METADATA_MARKER)) return { ...metadata, nativeSynonyms: metadata.nativeSynonyms ?? [] };
    if (prompt.includes("Targeted repair only")) {
      if (options.repairDelayMs !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, options.repairDelayMs));
      }
      return (options.repaired ?? options.result).translations.cs;
    }
    if (prompt.includes(LANG_MARKER)) return translations.cs;
    return options.result;
  });
}

/** The AI preflight round-trip, which only happens on low-confidence detection. */
function isPreflightCall(prompt: string): boolean {
  return prompt.includes("preflight ambiguity checker");
}

function countPreflightCalls(mock: ReturnType<typeof vi.fn>): number {
  return mock.mock.calls.filter((call) => isPreflightCall(call[0] as string)).length;
}

function countJudgeCalls(mock: ReturnType<typeof vi.fn>): number {
  return mock.mock.calls.filter((call) => isJudgeCall(call[0] as string)).length;
}

function countRepairCalls(mock: ReturnType<typeof vi.fn>): number {
  return mock.mock.calls.filter((call) => (call[0] as string).includes("Targeted repair only")).length;
}

/** A clock the test advances explicitly. */
function fakeClock(startAt = 1_000_000) {
  let t = startAt;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

// ─── 1. judge exceeds its time box ──────────────────────────────────────────

describe("Task 2.5a — judge time box", () => {
  it("returns the validated pre-judge result instead of blocking when the judge exceeds its box", async () => {
    // A judge that never settles. Without a time box this test would hang.
    const mock = createMock({
      result: GOOD,
      judge: () => new Promise(() => {}),
    });

    const decision = await translate({ ...highRiskInput, deadlineAt: Date.now() + MIN_JUDGE_BUDGET_MS + 200 }, mock);

    // The pipeline resolved, and the OUTPUT is the pre-judge, already-validated result.
    expect("output" in decision && decision.output.translations.cs.text).toBe("zlom vaz");
    expect(countJudgeCalls(mock)).toBe(1);
    // No judge correction was invented, and no repair-and-re-judge cycle ran.
    expect(countRepairCalls(mock)).toBe(0);
  });

  it("routes a high-risk judge time-box expiry to needs_review, never a bare accepted card", async () => {
    const mock = createMock({
      result: GOOD,
      judge: () => new Promise(() => {}),
    });

    const decision = await translate({ ...highRiskInput, deadlineAt: Date.now() + MIN_JUDGE_BUDGET_MS + 200 }, mock);

    expect(decision.status).toBe("needs_review");
    if (decision.status !== "needs_review") throw new Error("expected needs_review");
    expect(decision.issues.some((issue) => issue.message.includes("judge_timeout"))).toBe(true);
    expect(decision.issues.some((issue) => issue.severity === "blocking")).toBe(true);
  });

  it("treats a window shorter than MIN_JUDGE_BUDGET_MS as an expiry without spending it on a doomed round-trip", async () => {
    const clock = fakeClock();
    const mock = createMock({
      result: GOOD,
      // Every AI call burns 2s of the injected clock.
      onCall: () => clock.advance(2_000),
    });

    // 5s budget, ~2s consumed by generation → under MIN_JUDGE_BUDGET_MS after the reservation math.
    const decision = await translate(
      { ...highRiskInput, deadlineAt: clock.now() + 2_000 + MIN_JUDGE_BUDGET_MS - 100, now: clock.now },
      mock,
    );

    expect(decision.status).toBe("needs_review");
    // The judge was never even called — no clock burned on a request that cannot land.
    expect(countJudgeCalls(mock)).toBe(0);
  });

  it("still applies the judge's corrections when it answers within budget (unchanged behavior)", async () => {
    // Judge answers in time with a blocking issue → repair-and-re-judge runs and
    // the corrected block ships. Only the CLOCK ever falls back, never a correction.
    let judgeCalls = 0;
    const mock = createMock({
      result: GOOD,
      repaired: makeResult("zlom vaz!"),
      judge: async () => {
        judgeCalls++;
        return judgeCalls === 1
          ? {
              issues: [
                { fieldPath: "translations.cs.text", severity: "blocking", message: "register is wrong", summary: "" },
              ],
              summary: "needs work",
            }
          : { issues: [], summary: "ok" };
      },
    });

    const decision = await translate({ ...highRiskInput, deadlineAt: Date.now() + 120_000 }, mock);

    expect(decision.status).toBe("accepted");
    expect("output" in decision && decision.output.translations.cs.text).toBe("zlom vaz!");
    expect(countJudgeCalls(mock)).toBe(2);
    expect(countRepairCalls(mock)).toBe(1);
  });
});

// ─── 2. adaptive repair budget ──────────────────────────────────────────────

describe("Task 2.5b — adaptive repair budget", () => {
  it("reduces repair rounds under a near-exhausted budget and returns the best validated result so far", async () => {
    const clock = fakeClock();
    const mock = createMock({
      result: makeUnfixableResult(),
      onCall: () => clock.advance(3_000),
    });

    // 5s total; generation alone burns ~3s, leaving ~2s < RESERVED_JUDGE_MS → no repair round starts.
    const decision = await translate(
      {
        word: "hello",
        sourceLang: "en",
        targetLangs: ["cs"],
        model: "openai/gpt-4o",
        deadlineAt: clock.now() + 5_000,
        now: clock.now,
      },
      mock,
    );

    expect(countRepairCalls(mock)).toBe(0);
    // The best result so far is still returned (flagged), not thrown away.
    expect(decision.status).toBe("needs_review");
    expect("output" in decision && decision.output.translations.cs.text).toBe("break a leg");
  });

  it("runs the full repair path on a fresh budget — no silent skipping while budget remains", async () => {
    const withBudget = createMock({ result: makeUnfixableResult() });
    await translate(
      {
        word: "hello",
        sourceLang: "en",
        targetLangs: ["cs"],
        model: "openai/gpt-4o",
        deadlineAt: Date.now() + 600_000,
      },
      withBudget,
    );

    const unbounded = createMock({ result: makeUnfixableResult() });
    await translate({ word: "hello", sourceLang: "en", targetLangs: ["cs"], model: "openai/gpt-4o" }, unbounded);

    // A fresh budget spends exactly as many repair rounds as no budget at all.
    expect(countRepairCalls(withBudget)).toBe(countRepairCalls(unbounded));
    expect(countRepairCalls(withBudget)).toBeGreaterThan(0);
  });

  it("bounds what a repair round may CONSUME, not merely when it may start, so the judge reservation survives an overrun", async () => {
    // Amendment 3 requires "repair may consume at most remaining − reservedJudgeMs".
    // A start-gate alone ("repair may START while remaining > reservedJudgeMs")
    // is strictly weaker: a repair admitted with a hair over the reservation can
    // then run for the AI adapter's full per-request timeout and eat the whole
    // reservation. This drives that exact case.
    // A genuine time-box race, so this one runs on the real clock: `runWithTimeBox`
    // arms a real `setTimeout`, and an `advance()`-driven clock cannot express
    // "this call is still running" — it jumps the moment a call starts, whether
    // or not anyone is waiting for it.
    const SPENDABLE_WINDOW_MS = 500;
    const REPAIR_HANG_MS = 2_500; // 5x the window it is allowed to spend
    // Repair is admitted with 500ms beyond the reservation, so the start-gate
    // passes; the repair then hangs far past that window.
    const deadlineAt = Date.now() + RESERVED_JUDGE_MS + SPENDABLE_WINDOW_MS;

    const mock = createMock({
      result: makeUnfixableResult(),
      repaired: GOOD,
      repairDelayMs: REPAIR_HANG_MS,
    });

    const startedAt = Date.now();
    await translate({ ...highRiskInput, deadlineAt }, mock);
    const elapsedMs = Date.now() - startedAt;

    // The repair round did start — this is an overrun, not a skipped round.
    expect(countRepairCalls(mock)).toBe(1);
    // …and it was abandoned at its bound rather than awaited to completion.
    expect(elapsedMs).toBeLessThan(REPAIR_HANG_MS);
    // The reservation survived: the judge's window is still there for it to use.
    // The 1s slack absorbs real-timer jitter.
    expect(deadlineAt - Date.now()).toBeGreaterThan(RESERVED_JUDGE_MS - 1_000);
  });

  it("never starts a repair round that would eat into the judge reservation", async () => {
    const clock = fakeClock();
    const mock = createMock({
      result: makeUnfixableResult(),
      onCall: () => clock.advance(1_000),
    });

    await translate({ ...highRiskInput, deadlineAt: clock.now() + RESERVED_JUDGE_MS + 1_500, now: clock.now }, mock);

    // Generation burned 2 x 1s of the (RESERVED_JUDGE_MS + 1.5s) budget, leaving
    // 3.5s: real time remains, but less than the judge reservation, so repair
    // must not start even though the deadline itself has not passed.
    expect(countRepairCalls(mock)).toBe(0);
    // Unrepaired blocking issues short-circuit the judge (pre-existing gate),
    // so nothing downstream spends the reserved window either.
    expect(countJudgeCalls(mock)).toBe(0);
  });
});

// ─── 3. regression guard: absent budget === today's behavior ────────────────

describe("no deadlineAt supplied", () => {
  it("behaves identically to the pre-budget pipeline for a repair-and-judge flow", async () => {
    const build = () =>
      createMock({
        result: makeUnfixableResult(),
        repaired: GOOD,
      });

    const unbounded = build();
    const unboundedDecision = await translate(highRiskInput, unbounded);

    // Explicitly-unusable budgets must degrade to unbounded, NOT to an instant
    // abort — `setTimeout(fn, NaN)` fires immediately (the NaN-budget outage).
    for (const deadlineAt of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
      const guarded = build();
      const guardedDecision = await translate({ ...highRiskInput, deadlineAt }, guarded);

      expect(guardedDecision).toEqual(unboundedDecision);
      expect(guarded.mock.calls.length).toBe(unbounded.mock.calls.length);
      expect(countJudgeCalls(guarded)).toBe(countJudgeCalls(unbounded));
      expect(countRepairCalls(guarded)).toBe(countRepairCalls(unbounded));
    }
  });

  it("keeps the clarify-rerun repair cap intact when a budget is present", async () => {
    const rerunInput: TranslateInput = {
      word: "tow",
      sourceLang: "en",
      targetLangs: ["cs"],
      model: "openai/gpt-4o",
      correctionPolicy: { skipInputCorrection: true },
    };

    const capped = createMock({ result: makeUnfixableResult() });
    await translate({ ...rerunInput, deadlineAt: Date.now() + 600_000 }, capped);

    const full = createMock({ result: makeUnfixableResult() });
    await translate({ word: "tow", sourceLang: "en", targetLangs: ["cs"], model: "openai/gpt-4o" }, full);

    // MAX_TARGETED_REPAIRS_ON_RERUN (1) still beats a generous budget.
    expect(countRepairCalls(capped)).toBe(1);
    expect(countRepairCalls(full)).toBe(2);
  });
});

// ─── 4. the onPhase observation seam ────────────────────────────────────────

describe("onPhase observation seam", () => {
  it("reports generate, validate, and judge with plausible durations", async () => {
    const clock = fakeClock();
    const observed: { phase: TranslationPhase; elapsedMs: number }[] = [];
    const mock = createMock({ result: GOOD, onCall: () => clock.advance(500) });

    await translate({ ...highRiskInput, now: clock.now }, mock, {
      onPhase: (phase, elapsedMs) => observed.push({ phase, elapsedMs }),
    });

    expect(observed.map((entry) => entry.phase)).toEqual(["generate", "validate", "judge"]);
    for (const entry of observed) {
      expect(Number.isFinite(entry.elapsedMs)).toBe(true);
      expect(entry.elapsedMs).toBeGreaterThanOrEqual(0);
    }
    // generate made 2 AI calls (metadata + cs) and judge made 1 → 1000ms / 500ms.
    expect(observed[0]?.elapsedMs).toBe(1_000);
    expect(observed[2]?.elapsedMs).toBe(500);
    // Deterministic validation is pure — no AI call, so no clock burned.
    expect(observed[1]?.elapsedMs).toBe(0);
  });

  it("does not report a judge timing when the judge never ran", async () => {
    // The judge only runs on riskLevel === "high". Most interactive traffic is
    // medium, so reporting `judge` unconditionally would flood the histogram
    // with ~0ms no-op samples and drag p50/p95 toward zero — hiding exactly the
    // tail the metric exists to bound. An absent observation is the honest one.
    const clock = fakeClock();
    const observed: { phase: TranslationPhase; elapsedMs: number }[] = [];
    // A plain word between two common languages scores medium, not high.
    const mediumRiskInput: TranslateInput = {
      word: "hello",
      sourceLang: "en",
      targetLangs: ["cs"],
      model: "openai/gpt-4o",
    };
    const mock = createMock({ result: GOOD, onCall: () => clock.advance(500) });

    const decision = await translate({ ...mediumRiskInput, now: clock.now }, mock, {
      onPhase: (phase, elapsedMs) => observed.push({ phase, elapsedMs }),
    });

    expect(decision.status).toBe("accepted");
    expect(countJudgeCalls(mock)).toBe(0);
    expect(observed.map((entry) => entry.phase)).toEqual(["generate", "validate"]);
  });

  it("reports the AI preflight round-trip when detection was too weak to skip it", async () => {
    // The preflight is a full AI round-trip. Leaving it unmapped meant the phase
    // breakdown silently omitted one of the sequential AI calls it exists to
    // localize, so a dashboard reader would find unexplained time with no label
    // to blame it on.
    const clock = fakeClock();
    const observed: { phase: TranslationPhase; elapsedMs: number }[] = [];
    const mock = createMock({ result: GOOD, onCall: () => clock.advance(500) });

    // Below PREFLIGHT_DEFAULTS.autoProceedAboveConfidence (0.86), so the
    // preflight actually reaches the model instead of short-circuiting.
    const decision = await translate({ ...highRiskInput, detectionConfidence: 0.5, now: clock.now }, mock, {
      onPhase: (phase, elapsedMs) => observed.push({ phase, elapsedMs }),
    });

    expect(decision.status).toBe("accepted");
    expect(countPreflightCalls(mock)).toBe(1);
    const preflight = observed.filter((entry) => entry.phase === "preflight");
    expect(preflight).toHaveLength(1);
    expect(preflight[0]?.elapsedMs).toBe(500);
  });

  it("is a no-op when absent and never breaks translation when it throws", async () => {
    const withoutHook = createMock({ result: GOOD });
    const baseline = await translate(highRiskInput, withoutHook);

    const withThrowingHook = createMock({ result: GOOD });
    const decision = await translate(highRiskInput, withThrowingHook, {
      onPhase: () => {
        throw new Error("metrics registry exploded");
      },
    });

    expect(decision).toEqual(baseline);
    expect(decision.status).toBe("accepted");
  });
});
