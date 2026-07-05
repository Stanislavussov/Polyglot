/**
 * Tests for LIKE/ILIKE pattern escaping (S12): user-supplied `%`, `_`, and `\`
 * must be treated as literal characters, not wildcards.
 */
import { describe, expect, it } from "vitest";
import { escapeLikePattern } from "../like-escape.js";

describe("escapeLikePattern", () => {
  it("leaves a plain term untouched", () => {
    expect(escapeLikePattern("alice")).toBe("alice");
  });

  it("escapes the % wildcard so it matches a literal percent", () => {
    expect(escapeLikePattern("50%")).toBe("50\\%");
  });

  it("escapes the _ single-char wildcard", () => {
    expect(escapeLikePattern("a_b")).toBe("a\\_b");
  });

  it("escapes the backslash escape character itself", () => {
    expect(escapeLikePattern("a\\b")).toBe("a\\\\b");
  });

  it("escapes every wildcard in a mixed term", () => {
    expect(escapeLikePattern("%_\\")).toBe("\\%\\_\\\\");
  });

  it("wraps into a literal pattern that cannot broaden the match", () => {
    // Simulates the repository call site: `%${escapeLikePattern(term)}%`.
    const pattern = `%${escapeLikePattern("100%_off")}%`;
    expect(pattern).toBe("%100\\%\\_off%");
  });
});
