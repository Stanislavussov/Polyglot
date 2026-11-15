import type { LoginVerifier, VerifiedLogin } from "@polyglot/core";
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";

export const GOOGLE_CHANNEL = "google";
const GOOGLE_CERTS = new URL("https://www.googleapis.com/oauth2/v3/certs");
// Google signs ID tokens with either issuer spelling.
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

/**
 * "Sign in with Google" (Google Identity Services): the browser receives a signed
 * ID token; this checks its signature against Google's keys, the issuer, the
 * expiry and that it was minted for our client id. `sub` is the account id —
 * never the email, which a Google account can change.
 */
export function createGoogleVerifier(
  clientId: string,
  keys: JWTVerifyGetKey = createRemoteJWKSet(GOOGLE_CERTS),
): LoginVerifier {
  return {
    channel: GOOGLE_CHANNEL,
    async verify(credential: string): Promise<VerifiedLogin | null> {
      try {
        const { payload } = await jwtVerify(credential, keys, { issuer: GOOGLE_ISSUERS, audience: clientId });
        if (typeof payload.sub !== "string" || payload.sub === "") return null;
        const name = typeof payload.given_name === "string" ? payload.given_name : null;
        return { channel: GOOGLE_CHANNEL, externalId: payload.sub, username: name };
      } catch {
        return null;
      }
    },
  };
}
