import { describe, expect, it } from "vitest";
import { formatLongDate } from "../format-date.js";

const NOON_UTC = new Date("2026-09-22T12:00:00Z");

describe("formatLongDate", () => {
  it("writes the month out in the language the sentence is written in", () => {
    expect(formatLongDate(NOON_UTC, "ru", "UTC")).toContain("сентября");
    expect(formatLongDate(NOON_UTC, "en", "UTC")).toContain("September");
    // Never the ISO form the subscription notice used to print.
    expect(formatLongDate(NOON_UTC, "ru", "UTC")).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("reads the instant in the viewer's zone, not the server's", () => {
    // 00:30 in Vladivostok is still the 21st in UTC: a UTC-rendered date would
    // tell that buyer their plan ends a day before it does.
    const justAfterMidnight = new Date("2026-09-21T14:30:00Z");
    expect(formatLongDate(justAfterMidnight, "en", "Asia/Vladivostok")).toContain("22");
    expect(formatLongDate(justAfterMidnight, "en", "UTC")).toContain("21");
  });

  it("falls back to UTC instead of throwing on an unusable zone", () => {
    expect(formatLongDate(NOON_UTC, "en", "Mars/Olympus")).toBe(formatLongDate(NOON_UTC, "en", "UTC"));
    expect(formatLongDate(NOON_UTC, "en", "")).toBe(formatLongDate(NOON_UTC, "en", "UTC"));
  });
});
