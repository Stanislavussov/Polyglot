import type { IdentityRepository } from "../../ports/identity.repository.js";
import type { VerifiedLogin } from "../../ports/login-verifier.port.js";
import type { User, UserRepository } from "../../ports/user.repository.js";

export const TELEGRAM_CHANNEL = "telegram";

export interface AccountDeps {
  identities: IdentityRepository;
  users: Pick<UserRepository, "findById" | "create" | "getTelegramIdById" | "findIdByTelegramId" | "setTelegramId">;
}

export type LinkOutcome =
  /** The method now signs in to this account. */
  | "linked"
  /** It already did. */
  | "already"
  /** Another account owns this method's id — accounts are never merged. */
  | "taken"
  /** This account already has a different account of the same method. */
  | "channel_taken";

/**
 * One account per person, many ways in. Telegram and Google give no shared key
 * (Telegram exposes no email), so two methods become one account only when the
 * person, signed in with one, proves the other. Two existing accounts are never
 * merged: their dictionaries, progress and subscriptions would collide.
 */
export function createAccounts(deps: AccountDeps) {
  // Rows created before `identities` (migration 0044, no backfill) are found by
  // their legacy telegram_id; the identity row self-heals on the next resolution.
  async function ownerOf(login: VerifiedLogin): Promise<{ userId: number; linked: boolean } | null> {
    const userId = await deps.identities.resolveUserId(login.channel, login.externalId);
    if (userId !== null) return { userId, linked: true };
    if (login.channel !== TELEGRAM_CHANNEL) return null;
    const legacy = await deps.users.findIdByTelegramId(Number(login.externalId));
    return legacy !== null ? { userId: legacy, linked: false } : null;
  }

  return {
    /** Sign in, creating the account on first use. */
    async signIn(login: VerifiedLogin): Promise<{ user: User; created: boolean }> {
      const owner = await ownerOf(login);
      const existing = owner ? await deps.users.findById(owner.userId) : null;
      if (existing) {
        // Only a legacy row writes: the bot signs in on every update, so no write on the common path.
        if (!owner?.linked) await deps.identities.linkIdentity(existing.id, login.channel, login.externalId);
        return { user: existing, created: false };
      }
      // Telegram's create is a get-or-create on telegram_id: concurrent first
      // messages converge on one row instead of failing on the unique index.
      const user = await deps.users.create(
        login.channel === TELEGRAM_CHANNEL
          ? { telegramId: Number(login.externalId), username: login.username ?? null }
          : { username: login.username ?? null },
      );
      await deps.identities.linkIdentity(user.id, login.channel, login.externalId);
      return { user, created: true };
    },

    /** Add a sign-in method to the account the person is signed in to. */
    async link(userId: number, login: VerifiedLogin): Promise<LinkOutcome> {
      const owner = await ownerOf(login);
      if (owner?.userId === userId) {
        if (!owner.linked) await deps.identities.linkIdentity(userId, login.channel, login.externalId);
        return "already";
      }
      if (owner) return "taken";

      const sameMethod = await deps.identities.findExternalId(userId, login.channel);
      const legacyTelegram = login.channel === TELEGRAM_CHANNEL ? await deps.users.getTelegramIdById(userId) : null;
      if (sameMethod !== null || legacyTelegram !== null) return "channel_taken";

      await deps.identities.linkIdentity(userId, login.channel, login.externalId);
      // linkIdentity ignores a conflict: re-read, since a parallel sign-up may have won the id.
      if ((await deps.identities.resolveUserId(login.channel, login.externalId)) !== userId) return "taken";
      if (login.channel === TELEGRAM_CHANNEL) {
        await deps.users.setTelegramId(userId, Number(login.externalId));
      }
      return "linked";
    },

    listMethods: (userId: number) => deps.identities.listChannels(userId),
  };
}

export type Accounts = ReturnType<typeof createAccounts>;
