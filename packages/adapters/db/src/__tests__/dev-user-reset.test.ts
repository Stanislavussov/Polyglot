import { describe, expect, it } from "vitest";
import { formatUserResetIdentifier, parseUserResetIdentifiers } from "../dev-user-reset.js";

describe("parseUserResetIdentifiers", () => {
  it("accepts usernames with or without @ and numeric telegram ids, in any separator mix", () => {
    expect(parseUserResetIdentifiers("@standa55, 123456 ;other_name")).toEqual([
      { kind: "username", username: "standa55" },
      { kind: "telegramId", telegramId: 123456 },
      { kind: "username", username: "other_name" },
    ]);
  });

  it("treats an unset or blank value as nothing to reset", () => {
    expect(parseUserResetIdentifiers(undefined)).toEqual([]);
    expect(parseUserResetIdentifiers("  , ")).toEqual([]);
  });

  it("rejects tokens that are neither a Telegram username nor a positive id", () => {
    expect(() => parseUserResetIdentifiers("@")).toThrow(/Invalid username/);
    expect(() => parseUserResetIdentifiers("bad-name!")).toThrow(/Invalid username/);
    expect(() => parseUserResetIdentifiers("0")).toThrow(/Invalid telegram id/);
  });

  it("formats identifiers back to the input shape for logs", () => {
    expect(formatUserResetIdentifier({ kind: "username", username: "standa55" })).toBe("@standa55");
    expect(formatUserResetIdentifier({ kind: "telegramId", telegramId: 42 })).toBe("42");
  });
});
