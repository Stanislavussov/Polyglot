/**
 * Dev user reset — real-DB integration tests.
 *
 * Proves the contract the dev deploy relies on: after `resetUsers`, the tester
 * is gone together with everything that hangs off the row (settings via FK
 * cascade) AND the FK-less bot session, while every other user is untouched.
 * Each test provisions its own users with unique telegram ids.
 */
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../connection.js";
import { resetUsers } from "../dev-user-reset.js";
import { botSessionRepository } from "../repositories/bot-session.repository.js";
import { userRepository } from "../repositories/user.repository.js";
import { userLanguageSettings, users } from "../schema.js";
import { uniqueTelegramId } from "../test-helpers/integration/id-factory.js";

async function provisionUser(username: string) {
  const telegramId = uniqueTelegramId();
  const user = await userRepository.create({ telegramId, username });
  await userRepository.updateSettings(user.id, {
    interfaceLang: "en",
    nativeLang: "ru",
    learningLangs: ["de"],
    timezone: "UTC",
    activeMode: "translate",
  });
  await botSessionRepository.upsert(String(telegramId), { onboarding: { step: 2 } });
  return user;
}

async function userExists(userId: number): Promise<boolean> {
  const rows = await getDb().select({ id: users.id }).from(users).where(eq(users.id, userId));
  return rows.length > 0;
}

describe("resetUsers (integration)", () => {
  it("deletes the user by telegram id together with settings and the bot session", async () => {
    const user = await provisionUser(`reset_tg_${uniqueTelegramId()}`);

    const result = await resetUsers([{ kind: "telegramId", telegramId: user.telegramId }]);

    expect(result.deleted).toEqual([{ userId: user.id, telegramId: user.telegramId, username: user.username }]);
    expect(result.notFound).toEqual([]);
    expect(await userExists(user.id)).toBe(false);
    expect(await botSessionRepository.get(String(user.telegramId))).toBeNull();
    const settings = await getDb()
      .select({ userId: userLanguageSettings.userId })
      .from(userLanguageSettings)
      .where(eq(userLanguageSettings.userId, user.id));
    expect(settings).toEqual([]);
  });

  it("matches a username case-insensitively and leaves other users alone", async () => {
    const suffix = uniqueTelegramId();
    const target = await provisionUser(`Standa_${suffix}`);
    const bystander = await provisionUser(`bystander_${suffix}`);

    const result = await resetUsers([{ kind: "username", username: `standa_${suffix}` }]);

    expect(result.deleted.map((row) => row.userId)).toEqual([target.id]);
    expect(await userExists(target.id)).toBe(false);
    expect(await userExists(bystander.id)).toBe(true);
    expect(await botSessionRepository.get(String(bystander.telegramId))).not.toBeNull();
  });

  it("reports identifiers that match nobody without failing the run", async () => {
    const ghostId = uniqueTelegramId();

    const result = await resetUsers([
      { kind: "telegramId", telegramId: ghostId },
      { kind: "username", username: `ghost_${ghostId}` },
    ]);

    expect(result.deleted).toEqual([]);
    expect(result.notFound).toEqual([
      { kind: "telegramId", telegramId: ghostId },
      { kind: "username", username: `ghost_${ghostId}` },
    ]);
  });
});
