import type { TranslateOutput } from "@polyglot/core";
import { describe, expect, it } from "vitest";
import { signSaveToken, verifySaveToken } from "./save-token.js";

const SECRET = "test-secret-test-secret-test-secret";
const payload = { userId: 7, inputType: "word" as const, output: { original: "hello" } as TranslateOutput };

describe("save token", () => {
  it("round-trips the shown card", () => {
    expect(verifySaveToken(SECRET, signSaveToken(SECRET, payload, 1000), 2000)).toEqual(payload);
  });

  it("refuses a tampered, foreign-key or expired token", () => {
    const token = signSaveToken(SECRET, payload, 1000);
    const [body, mac] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...payload, userId: 8, expiresAt: 9e15 })).toString("base64url");

    expect(verifySaveToken(SECRET, `${forged}.${mac}`, 2000)).toBeNull();
    expect(verifySaveToken(`${SECRET}x`, token, 2000)).toBeNull();
    expect(verifySaveToken(SECRET, `${body}`, 2000)).toBeNull();
    expect(verifySaveToken(SECRET, token, 1000 + 25 * 60 * 60 * 1000)).toBeNull();
  });
});
