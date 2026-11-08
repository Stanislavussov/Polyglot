/**
 * The web has no session to keep a shown card in (the bot keeps `lastTranslation`), so
 * the translate response carries the card back to the browser signed: Save then stores
 * exactly what was shown, without a second AI call, and nobody can save a forged card.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { TranslateOutput } from "@polyglot/core";

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export interface SavePayload {
  userId: number;
  inputType: "word" | "phrase";
  output: TranslateOutput;
}

interface SignedPayload extends SavePayload {
  expiresAt: number;
}

// A key of its own, so a save token can never pass as a session JWT signed with the same secret.
function signature(secret: string, body: string): Buffer {
  const key = createHmac("sha256", secret).update("translate-save-token").digest();
  return createHmac("sha256", key).update(body).digest();
}

export function signSaveToken(secret: string, payload: SavePayload, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...payload, expiresAt: now + TOKEN_TTL_MS })).toString("base64url");
  return `${body}.${signature(secret, body).toString("base64url")}`;
}

/** `null` for a forged, damaged or expired token. */
export function verifySaveToken(secret: string, token: string, now = Date.now()): SavePayload | null {
  const [body, mac, extra] = token.split(".");
  if (!body || !mac || extra !== undefined) return null;
  const expected = signature(secret, body);
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SignedPayload;
    if (typeof parsed.expiresAt !== "number" || parsed.expiresAt < now) return null;
    return { userId: parsed.userId, inputType: parsed.inputType, output: parsed.output };
  } catch {
    return null;
  }
}
