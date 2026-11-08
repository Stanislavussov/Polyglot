/**
 * Goal-ladder backfill — real-DB integration tests. It rides every deploy until it
 * is removed, so what matters is that a second run writes nothing and that it
 * judges a month exactly as the live close does.
 */
import { DEFAULT_MOTIVATION_CONFIG, isMonthCounted, progressGoalsConfig } from "@polyglot/core";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../connection.js";
import { runProgressBackfill } from "../progress-backfill.js";
import { progressRepository } from "../repositories/progress.repository.js";
import { userRepository } from "../repositories/user.repository.js";
import { momentumEvents, subscriptions, userLanguageSettings } from "../schema.js";
import { uniqueTelegramId } from "../test-helpers/integration/id-factory.js";

const NOW = new Date("2026-11-08T12:00:00.000Z");

async function freshUser(): Promise<number> {
  const user = await userRepository.create({ telegramId: uniqueTelegramId(), username: "progress-backfill" });
  await getDb().insert(userLanguageSettings).values({ userId: user.id, interfaceLang: "en", nativeLang: "ru" });
  return user.id;
}

async function seedDays(userId: number, month: string, days: number, kind: "review" | "translate"): Promise<void> {
  await getDb()
    .insert(momentumEvents)
    .values(
      Array.from({ length: days }, (_, index) => ({
        userId,
        kind,
        weight: 1,
        occurredAt: new Date(`${month}-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`),
        dedupeKey: `seed:${kind}:${month}:${index}`,
      })),
    );
  if (kind === "review") {
    await getDb()
      .insert(momentumEvents)
      .values({
        userId,
        kind: "mature",
        weight: 10,
        occurredAt: new Date(`${month}-01T11:00:00.000Z`),
        dedupeKey: `seed:mature:${month}`,
      });
  }
}

describe("runProgressBackfill", () => {
  it("closes the in-window months once, as the live close would, and never grants", async () => {
    const userId = await freshUser();
    await seedDays(userId, "2026-09", 14, "review");
    await seedDays(userId, "2026-10", 5, "review");

    const first = await runProgressBackfill({ now: NOW, userIds: [userId] });
    const ledgerAfterFirst = await progressRepository.getLedger(userId);
    const second = await runProgressBackfill({ now: NOW, userIds: [userId] });

    expect(first).toEqual({ users: 1, monthsClosed: 2 });
    expect(second).toEqual({ users: 1, monthsClosed: 0 });
    expect(await progressRepository.getLedger(userId)).toEqual(ledgerAfterFirst);
    const config = progressGoalsConfig(DEFAULT_MOTIVATION_CONFIG);
    expect(ledgerAfterFirst.map((row) => [row.month, row.source, row.counted, isMonthCounted(row, config)])).toEqual([
      ["2026-09", "backfill", true, true],
      ["2026-10", "backfill", false, false],
    ]);
    expect(await getDb().select().from(subscriptions).where(eq(subscriptions.userId, userId))).toEqual([]);
  });

  it("leaves a user who only translated without a ledger row", async () => {
    const userId = await freshUser();
    await seedDays(userId, "2026-10", 20, "translate");

    expect(await runProgressBackfill({ now: NOW, userIds: [userId] })).toEqual({ users: 1, monthsClosed: 0 });
    expect(await progressRepository.getLedger(userId)).toEqual([]);
  });
});
