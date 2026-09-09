/**
 * Spec for the `motivation` kill-switch blob at the DB read boundary (plan §4.6).
 *
 * The JSONB column is an unchecked cast, so this is the only place that can make a
 * switch trustworthy. Direction matters: an unreadable blob must still record
 * (invisible, irrecoverable if lost) and must show nothing (instantly reversible).
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_MOTIVATION_CONFIG, parseMotivationConfig } from "../momentum.types.js";

describe("parseMotivationConfig", () => {
  it("falls back to recording-only for an empty, null, or garbage blob", () => {
    for (const raw of [{}, null, undefined, "garbage", 42, [], { enabled: null }]) {
      expect(parseMotivationConfig(raw)).toEqual(DEFAULT_MOTIVATION_CONFIG);
    }
    expect(DEFAULT_MOTIVATION_CONFIG).toEqual({
      recordingEnabled: true,
      enabled: false,
      praiseEnabled: false,
      recoveryEnabled: false,
    });
  });

  it("honours a stored boolean", () => {
    expect(parseMotivationConfig({ enabled: true })).toEqual({ ...DEFAULT_MOTIVATION_CONFIG, enabled: true });
    expect(parseMotivationConfig({ recordingEnabled: false })).toEqual({
      ...DEFAULT_MOTIVATION_CONFIG,
      recordingEnabled: false,
    });
  });

  it("repairs one broken switch without discarding its valid siblings", () => {
    expect(parseMotivationConfig({ enabled: "yes", praiseEnabled: true, recoveryEnabled: true })).toEqual({
      recordingEnabled: true,
      enabled: false,
      praiseEnabled: true,
      recoveryEnabled: true,
    });
  });
});
