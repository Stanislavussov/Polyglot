import type { IdentityRepository } from "@polyglot/core";
import { and, eq } from "drizzle-orm";
import { getDb } from "../connection.js";
import { identities } from "../schema.js";

/**
 * Identity repository adapter (Fable T24/A1).
 *
 * Persists the `userId ↔ (channel, externalId)` mapping in the `identities`
 * table. External ids are opaque strings so any channel (telegram, whatsapp, …)
 * fits without a schema change.
 */
export const identityRepository: IdentityRepository = {
  async resolveUserId(channel: string, externalId: string): Promise<number | null> {
    const db = getDb();
    const rows = await db
      .select({ userId: identities.userId })
      .from(identities)
      .where(and(eq(identities.channel, channel), eq(identities.externalId, externalId)))
      .limit(1);
    return rows[0]?.userId ?? null;
  },

  async findExternalId(userId: number, channel: string): Promise<string | null> {
    const db = getDb();
    const rows = await db
      .select({ externalId: identities.externalId })
      .from(identities)
      .where(and(eq(identities.userId, userId), eq(identities.channel, channel)))
      .limit(1);
    return rows[0]?.externalId ?? null;
  },

  async linkIdentity(userId: number, channel: string, externalId: string): Promise<void> {
    const db = getDb();
    // Idempotent: a repeated link for the same (channel, externalId) is a no-op,
    // so this is safe to call on every resolution to self-heal channel-only users.
    await db
      .insert(identities)
      .values({ userId, channel, externalId })
      .onConflictDoNothing({ target: [identities.channel, identities.externalId] });
  },
};
