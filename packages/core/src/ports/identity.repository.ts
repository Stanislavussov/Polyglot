/**
 * Identity Repository Port (Fable T24/A1).
 *
 * Maps the neutral domain `userId` to a per-channel external id (e.g. a Telegram
 * chat id). The domain identifies a user solely by `userId`; every delivery
 * channel resolves its own `externalId` through this port instead of the domain
 * depending on a channel-specific id. Adding a new channel (WhatsApp, web, …) is
 * a new `channel` value, not a schema/port change.
 */
export interface IdentityRepository {
  /** Resolve the neutral `userId` for a channel's external id, or `null` if unlinked. */
  resolveUserId(channel: string, externalId: string): Promise<number | null>;

  /** Reverse lookup: the external id a channel should deliver to for `userId`, or `null`. */
  findExternalId(userId: number, channel: string): Promise<string | null>;

  /**
   * Idempotently link a `userId` to a channel's external id. A repeated call for
   * an already-linked `(channel, externalId)` is a no-op (upsert / do-nothing on
   * the unique constraint), so it is safe to call on every resolution to
   * self-heal channel-only users into an identity row.
   */
  linkIdentity(userId: number, channel: string, externalId: string): Promise<void>;
}
