/**
 * @business One account, many ways in.
 *
 * Spec:
 * - signIn: a known method opens its account; an unknown one creates an account
 *   (Telegram keeps its chat id on the row, Google has none). A Telegram user from
 *   before the identity table is found by the legacy chat id, not duplicated.
 * - link: adds a method to the signed-in account. Refused when another account
 *   already owns that method's id (no merging), or when this account already has
 *   a different account of the same method. Linking Telegram stores the chat id.
 */
import { describe, expect, it } from "vitest";
import type { IdentityRepository } from "../../ports/identity.repository.js";
import type { User } from "../../ports/user.repository.js";
import { type AccountDeps, createAccounts } from "./accounts.js";

function memory() {
  const identities: { userId: number; channel: string; externalId: string }[] = [];
  const rows: (User & { telegramId: number | null })[] = [];
  const identityRepo: IdentityRepository = {
    async resolveUserId(channel, externalId) {
      return identities.find((i) => i.channel === channel && i.externalId === externalId)?.userId ?? null;
    },
    async findExternalId(userId, channel) {
      return identities.find((i) => i.userId === userId && i.channel === channel)?.externalId ?? null;
    },
    async linkIdentity(userId, channel, externalId) {
      if (!identities.some((i) => i.channel === channel && i.externalId === externalId)) {
        identities.push({ userId, channel, externalId });
      }
    },
    async listChannels(userId) {
      return identities.filter((i) => i.userId === userId).map((i) => i.channel);
    },
  };
  const users: AccountDeps["users"] = {
    async findById(id) {
      return rows.find((r) => r.id === id) ?? null;
    },
    async create(data) {
      const row = {
        id: rows.length + 1,
        telegramId: data.telegramId ?? null,
        username: data.username ?? null,
        onboarded: false,
        isActive: true,
      } as User & { telegramId: number | null };
      rows.push(row);
      return row;
    },
    async getTelegramIdById(id) {
      return rows.find((r) => r.id === id)?.telegramId ?? null;
    },
    async findIdByTelegramId(telegramId) {
      return rows.find((r) => r.telegramId === telegramId)?.id ?? null;
    },
    async setTelegramId(id, telegramId) {
      const row = rows.find((r) => r.id === id);
      if (row) row.telegramId = telegramId;
    },
  };
  return { accounts: createAccounts({ identities: identityRepo, users }), rows, identities, users };
}

const GOOGLE = { channel: "google", externalId: "g-1" };
const TELEGRAM = { channel: "telegram", externalId: "555", username: "ann" };

describe("accounts — signIn", () => {
  it("creates an account on first sign-in and opens the same one afterwards", async () => {
    const { accounts } = memory();

    const first = await accounts.signIn(GOOGLE);
    const again = await accounts.signIn(GOOGLE);

    expect(first.created).toBe(true);
    expect(again).toEqual({ user: first.user, created: false });
  });

  it("finds a Telegram user from before the identity table instead of creating a second one", async () => {
    const { accounts, users, identities } = memory();
    const legacy = await users.create({ telegramId: 555 });

    const { user, created } = await accounts.signIn(TELEGRAM);

    expect(created).toBe(false);
    expect(user.id).toBe(legacy.id);
    expect(identities).toContainEqual({ userId: legacy.id, channel: "telegram", externalId: "555" });
  });
});

describe("accounts — link", () => {
  it("lets a Google account add Telegram, which then signs in to it and keeps its chat id", async () => {
    const { accounts, rows } = memory();
    const { user } = await accounts.signIn(GOOGLE);

    expect(await accounts.link(user.id, TELEGRAM)).toBe("linked");

    expect((await accounts.signIn(TELEGRAM)).user.id).toBe(user.id);
    expect(rows.find((r) => r.id === user.id)?.telegramId).toBe(555);
    expect(await accounts.listMethods(user.id)).toEqual(["google", "telegram"]);
  });

  it("refuses to link a Telegram that already has its own account, and merges nothing", async () => {
    const { accounts } = memory();
    const telegramUser = (await accounts.signIn(TELEGRAM)).user;
    const googleUser = (await accounts.signIn(GOOGLE)).user;

    expect(await accounts.link(googleUser.id, TELEGRAM)).toBe("taken");
    expect((await accounts.signIn(TELEGRAM)).user.id).toBe(telegramUser.id);
  });

  it("refuses a legacy Telegram row's chat id as well", async () => {
    const { accounts, users } = memory();
    await users.create({ telegramId: 555 });
    const googleUser = (await accounts.signIn(GOOGLE)).user;

    expect(await accounts.link(googleUser.id, TELEGRAM)).toBe("taken");
  });

  it("refuses a second Google account on the same account", async () => {
    const { accounts } = memory();
    const { user } = await accounts.signIn(TELEGRAM);
    await accounts.link(user.id, GOOGLE);

    expect(await accounts.link(user.id, { channel: "google", externalId: "g-2" })).toBe("channel_taken");
  });

  it("answers 'already' when the method is linked to this very account", async () => {
    const { accounts } = memory();
    const { user } = await accounts.signIn(TELEGRAM);

    expect(await accounts.link(user.id, TELEGRAM)).toBe("already");
  });
});
