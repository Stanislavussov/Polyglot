/**
 * Spec — a user-typed link is fetched only when it points at the public web:
 * http(s) on the standard ports, no credentials, no local names, no private,
 * loopback, link-local or mapped-private addresses. A bare domain gets https.
 */
import { describe, expect, it } from "vitest";
import { isPublicAddress, parseArticleUrl } from "../address-guard.js";
import { ArticleError } from "../errors.js";

function codeOf(raw: string): string | null {
  try {
    parseArticleUrl(raw);
    return null;
  } catch (error) {
    return error instanceof ArticleError ? error.code : "other";
  }
}

describe("parseArticleUrl", () => {
  it("accepts public links and adds https to a bare domain", () => {
    expect(parseArticleUrl("example.com/news/1#top").toString()).toBe("https://example.com/news/1");
    expect(parseArticleUrl("http://news.example.org/a?b=1").hostname).toBe("news.example.org");
  });

  it.each([
    ["ftp://example.com/file", "invalid_url"],
    ["javascript:alert(1)", "invalid_url"],
    ["https://user:pass@example.com/", "invalid_url"],
    ["https://intranet/", "invalid_url"],
    ["http://localhost/admin", "blocked_host"],
    ["http://127.0.0.1/", "blocked_host"],
    ["http://10.1.2.3/", "blocked_host"],
    ["http://169.254.169.254/latest/meta-data", "blocked_host"],
    ["http://[::1]/", "blocked_host"],
    ["http://[::ffff:192.168.0.1]/", "blocked_host"],
    ["https://example.com:5432/", "blocked_host"],
  ])("refuses %s", (raw, code) => {
    expect(codeOf(raw)).toBe(code);
  });
});

describe("isPublicAddress", () => {
  it.each([
    ["8.8.8.8", true],
    ["2a00:1450:4001:80e::200e", true],
    ["192.168.1.1", false],
    ["172.20.0.5", false],
    ["100.64.0.1", false],
    ["fd00::1", false],
    ["fe80::1", false],
    ["not-an-ip", false],
  ])("%s → %s", (address, expected) => {
    expect(isPublicAddress(address)).toBe(expected);
  });
});
