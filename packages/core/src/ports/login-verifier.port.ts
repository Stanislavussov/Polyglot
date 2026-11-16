/**
 * A sign-in method's proof, checked. Each method (Google, later Apple) is one
 * adapter behind this port; what happens after the check — find, create or
 * link the account — is decided once, in `modules/identity/accounts.ts`.
 */
export interface VerifiedLogin {
  /** `identities.channel`: "telegram", "google", … */
  channel: string;
  /** The method's stable account id (Google `sub`, Telegram user id). */
  externalId: string;
  /** Display handle for a new account; never used to match accounts. */
  username?: string | null;
}

export interface LoginVerifier {
  readonly channel: string;
  /** null = the proof is forged, expired or for another app. */
  verify(credential: string): Promise<VerifiedLogin | null>;
}
