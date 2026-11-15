import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { createGoogleVerifier } from "./google.js";

const CLIENT_ID = "client.apps.googleusercontent.com";

async function googleKeys() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
  const sign = (claims: Record<string, unknown>, expires = "1h") =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer("https://accounts.google.com")
      .setAudience(CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime(expires)
      .sign(privateKey);
  return { keys: createLocalJWKSet({ keys: [jwk] }), sign };
}

describe("google verifier", () => {
  it("accepts a token Google signed for our client and returns the stable account id", async () => {
    const { keys, sign } = await googleKeys();
    const verifier = createGoogleVerifier(CLIENT_ID, keys);

    expect(await verifier.verify(await sign({ sub: "1234", given_name: "Ann", email: "a@x.test" }))).toEqual({
      channel: "google",
      externalId: "1234",
      username: "Ann",
    });
  });

  it("refuses a token minted for another app", async () => {
    const { keys, sign } = await googleKeys();
    const verifier = createGoogleVerifier("someone-else", keys);

    expect(await verifier.verify(await sign({ sub: "1234" }))).toBeNull();
  });

  it("refuses an expired token and a token signed by another key", async () => {
    const google = await googleKeys();
    const forger = await googleKeys();
    const verifier = createGoogleVerifier(CLIENT_ID, google.keys);

    expect(await verifier.verify(await google.sign({ sub: "1234" }, "-1m"))).toBeNull();
    expect(await verifier.verify(await forger.sign({ sub: "1234" }))).toBeNull();
    expect(await verifier.verify("not-a-jwt")).toBeNull();
  });
});
