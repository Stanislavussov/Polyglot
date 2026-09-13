import { describe, expect, it } from "vitest";
import { DEFAULT_DAILY_CREDIT_CEILING, evaluateDailyCeiling, resolveDailyCeiling } from "./daily-ceiling.js";

describe("resolveDailyCeiling", () => {
  it("falls back to the default when a plan names no ceiling", () => {
    expect(resolveDailyCeiling(null)).toBe(DEFAULT_DAILY_CREDIT_CEILING);
  });

  it("falls back to the default for a config written before the column existed", () => {
    // The whole point of the guard: a shape that predates it must not read as
    // "uncapped", which is what an `?? Infinity` would have made of it.
    expect(resolveDailyCeiling(undefined)).toBe(DEFAULT_DAILY_CREDIT_CEILING);
  });

  it("uses the plan's own ceiling when one is set", () => {
    // Deliberately not the default value, so a regression that ignored the plan
    // and returned the fallback could not pass this test by coincidence.
    expect(resolveDailyCeiling(2500)).toBe(2500);
    expect(2500).not.toBe(DEFAULT_DAILY_CREDIT_CEILING);
  });

  it("treats a non-positive stored ceiling as unset rather than as a total block", () => {
    // A zero typed into the admin form must not take the bot down for everyone on
    // the plan — an ops guard that one keystroke turns into an outage is worse
    // than the runaway it exists to prevent.
    expect(resolveDailyCeiling(0)).toBe(DEFAULT_DAILY_CREDIT_CEILING);
    expect(resolveDailyCeiling(-50)).toBe(DEFAULT_DAILY_CREDIT_CEILING);
  });
});

describe("evaluateDailyCeiling", () => {
  it("allows a call that lands exactly on the ceiling", () => {
    const status = evaluateDailyCeiling(DEFAULT_DAILY_CREDIT_CEILING - 5, 5, null);
    expect(status.allowed).toBe(true);
    expect(status.remainingCredits).toBe(5);
  });

  it("refuses the call that would cross it", () => {
    const status = evaluateDailyCeiling(DEFAULT_DAILY_CREDIT_CEILING - 4, 5, null);
    expect(status.allowed).toBe(false);
    expect(status.ceiling).toBe(DEFAULT_DAILY_CREDIT_CEILING);
  });

  it("weighs the call being requested, not just what was spent", () => {
    // A video costs 5; with 298 spent under a 300 ceiling a translation still
    // fits and a video does not.
    expect(evaluateDailyCeiling(298, 1, 300).allowed).toBe(true);
    expect(evaluateDailyCeiling(298, 5, 300).allowed).toBe(false);
  });

  it("reports no negative remainder once the ceiling is behind the user", () => {
    expect(evaluateDailyCeiling(400, 1, 300).remainingCredits).toBe(0);
  });

  it("honours a raised plan ceiling", () => {
    expect(evaluateDailyCeiling(DEFAULT_DAILY_CREDIT_CEILING + 100, 1, DEFAULT_DAILY_CREDIT_CEILING * 2).allowed).toBe(
      true,
    );
  });
});
