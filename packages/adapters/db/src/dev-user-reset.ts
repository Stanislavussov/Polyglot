/**
 * Dev-only user reset: removes a tester's account so the whole flow — /start,
 * onboarding, first translation — can be walked again on a database that was
 * just branched from production. Only the dev deploy pipeline calls this.
 *
 * Deleting the `users` row cascades through every user-owned table, but the
 * grammY session is keyed by chat id in `bot_sessions` with no FK, so it is
 * removed explicitly — otherwise the bot would resume the old conversation
 * state for a user it no longer knows.
 */
import { inArray, or, sql } from "drizzle-orm";
import { getDb } from "./connection.js";
import { botSessions, users } from "./schema.js";

export type UserResetIdentifier = { kind: "telegramId"; telegramId: number } | { kind: "username"; username: string };

export interface UserResetResult {
  deleted: Array<{ userId: number; telegramId: number; username: string | null }>;
  notFound: UserResetIdentifier[];
}

/** Parses `"@standa55, 123456"` — usernames with or without `@`, numeric telegram ids. */
export function parseUserResetIdentifiers(raw: string | undefined): UserResetIdentifier[] {
  const tokens = (raw ?? "")
    .split(/[\s,;]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  return tokens.map((token) => {
    if (/^\d+$/.test(token)) {
      const telegramId = Number(token);
      if (!Number.isSafeInteger(telegramId) || telegramId <= 0) {
        throw new Error(`Invalid telegram id in DEV_RESET_USERS: "${token}"`);
      }
      return { kind: "telegramId", telegramId };
    }
    const username = token.replace(/^@/, "");
    if (!/^[A-Za-z0-9_]{1,32}$/.test(username)) {
      throw new Error(`Invalid username in DEV_RESET_USERS: "${token}"`);
    }
    return { kind: "username", username };
  });
}

export function formatUserResetIdentifier(id: UserResetIdentifier): string {
  return id.kind === "telegramId" ? String(id.telegramId) : `@${id.username}`;
}

export async function resetUsers(identifiers: UserResetIdentifier[]): Promise<UserResetResult> {
  if (identifiers.length === 0) {
    return { deleted: [], notFound: [] };
  }
  const db = getDb();

  const telegramIds = identifiers.flatMap((id) => (id.kind === "telegramId" ? [id.telegramId] : []));
  const usernames = identifiers.flatMap((id) => (id.kind === "username" ? [id.username.toLowerCase()] : []));

  const conditions = [
    ...(telegramIds.length > 0 ? [inArray(users.telegramId, telegramIds)] : []),
    ...(usernames.length > 0 ? [inArray(sql`lower(${users.username})`, usernames)] : []),
  ];

  const matched = await db
    .select({ userId: users.id, telegramId: users.telegramId, username: users.username })
    .from(users)
    .where(conditions.length === 1 ? conditions[0] : or(...conditions));

  const notFound = identifiers.filter((id) =>
    id.kind === "telegramId"
      ? !matched.some((row) => row.telegramId === id.telegramId)
      : !matched.some((row) => row.username?.toLowerCase() === id.username.toLowerCase()),
  );

  if (matched.length > 0) {
    const ids = matched.map((row) => row.userId);
    const sessionKeys = matched.map((row) => String(row.telegramId));
    await db.transaction(async (tx) => {
      await tx.delete(botSessions).where(inArray(botSessions.key, sessionKeys));
      await tx.delete(users).where(inArray(users.id, ids));
    });
  }

  return { deleted: matched, notFound };
}
