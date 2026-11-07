import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MAX_LOGIN_AGE_SECONDS, type TelegramLogin, verifyTelegramLogin } from "./telegram-hash.js";

const TOKEN = "123456:TEST-token";
const NOW = 1_800_000_000;

/** Signs the way Telegram documents it, independently of the code under test. */
function signed(fields: Omit<TelegramLogin, "hash">, token = TOKEN): TelegramLogin {
  const dcs = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const key = createHash("sha256").update(token).digest();
  return { ...fields, hash: createHmac("sha256", key).update(dcs).digest("hex") };
}

const fields = { id: 42, first_name: "Ann", username: "ann", auth_date: NOW - 10 };

describe("verifyTelegramLogin", () => {
  it("accepts a fresh login signed with the bot token", () => {
    expect(verifyTelegramLogin(signed(fields), TOKEN, NOW)).toEqual({ ok: true });
  });

  it("rejects a tampered field", () => {
    expect(verifyTelegramLogin({ ...signed(fields), id: 43 }, TOKEN, NOW)).toEqual({ ok: false, reason: "bad_hash" });
  });

  it("rejects a login signed by another bot", () => {
    expect(verifyTelegramLogin(signed(fields, "999:other"), TOKEN, NOW)).toEqual({ ok: false, reason: "bad_hash" });
  });

  it("rejects a stale login", () => {
    const stale = signed({ ...fields, auth_date: NOW - MAX_LOGIN_AGE_SECONDS - 1 });
    expect(verifyTelegramLogin(stale, TOKEN, NOW)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects an auth_date in the future", () => {
    expect(verifyTelegramLogin(signed({ ...fields, auth_date: NOW + 120 }), TOKEN, NOW)).toEqual({
      ok: false,
      reason: "future",
    });
  });
});
