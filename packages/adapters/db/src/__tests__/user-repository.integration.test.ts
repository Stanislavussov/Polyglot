/**
 * User repository — real-DB integration tests (Task 71, Phase 3).
 *
 * Runs against a real, migrated Postgres branch (see vitest.integration.config.ts).
 * Every test provisions its own user with a unique telegram id and only ever
 * touches that user's own rows — no shared fixtures, no cleanup between tests, no
 * unscoped mutation.
 */

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../connection.js";
import { userRepository } from "../repositories/user.repository.js";
import { users } from "../schema.js";
import { uniqueTelegramId } from "../test-helpers/integration/id-factory.js";

describe("userRepository (integration)", () => {
  it("creates a row with expected defaults on an unseen telegram id", async () => {
    const telegramId = uniqueTelegramId();

    const user = await userRepository.create({ telegramId, username: "alice" });

    expect(user.id).toBeGreaterThan(0);
    expect(user.telegramId).toBe(telegramId);
    expect(user.username).toBe("alice");
    // Schema-level defaults applied on insert.
    expect(user.subscriptionPlan).toBe("free");
    expect(user.audienceGroup).toBe("product");
    expect(user.onboarded).toBe(false);
    expect(user.onboardingStep).toBe(0);
    expect(user.isActive).toBe(true);
    expect(user.createdAt).toBeInstanceOf(Date);
  });

  it("is idempotent on an existing telegram id: same row, no duplicate, createdAt preserved", async () => {
    const telegramId = uniqueTelegramId();

    const first = await userRepository.create({ telegramId, username: "bob" });
    const second = await userRepository.create({ telegramId, username: "bob-again" });

    // Get-or-create by the unique telegram_id constraint — the second call
    // returns the existing row rather than inserting a duplicate.
    expect(second.id).toBe(first.id);
    expect(second.createdAt.getTime()).toBe(first.createdAt.getTime());

    const rows = await getDb().select().from(users).where(eq(users.telegramId, telegramId));
    expect(rows).toHaveLength(1);
  });

  it("updates a mutable field without duplicating the row or losing createdAt", async () => {
    const telegramId = uniqueTelegramId();
    const created = await userRepository.create({ telegramId, username: "carol" });

    const updated = await userRepository.updateSubscriptionPlan(created.id, "plus");

    expect(updated?.id).toBe(created.id);
    expect(updated?.subscriptionPlan).toBe("plus");
    expect(updated?.createdAt.getTime()).toBe(created.createdAt.getTime());

    const rows = await getDb().select().from(users).where(eq(users.telegramId, telegramId));
    expect(rows).toHaveLength(1);
  });

  it("returns null when looking up an unknown user", async () => {
    // A domain id far above anything this run created.
    expect(await userRepository.findById(2_147_000_000)).toBeNull();
    // And the reverse telegram-id lookup for a never-created user.
    expect(await userRepository.getTelegramIdById(2_147_000_000)).toBeNull();
  });
});
