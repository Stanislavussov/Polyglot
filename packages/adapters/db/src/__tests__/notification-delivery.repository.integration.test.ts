/**
 * Notification delivery journal — real-DB integration tests.
 *
 * The admin panel's per-user view is a join plus three optional filters over a
 * shared table, so the properties worth pinning are the SQL ones: the user
 * filter isolates, the kind and search filters compose with it, the total counts
 * the filtered set rather than the page, and newest rows come first. Every
 * assertion is scoped to users this file created, because parallel lanes write
 * to the same table.
 */
import { describe, expect, it } from "vitest";
import { getDb } from "../connection.js";
import { notificationDeliveryRepository } from "../repositories/notification-delivery.repository.js";
import { notificationDeliveries, users } from "../schema.js";
import { uniqueTelegramId } from "../test-helpers/integration/id-factory.js";

async function seedUser(username: string | null = null): Promise<{ id: number; telegramId: number }> {
  const [user] = await getDb()
    .insert(users)
    .values({ telegramId: uniqueTelegramId(), username, onboarded: true, onboardingStep: 4, isActive: true })
    .returning();
  return { id: user!.id, telegramId: user!.telegramId };
}

describe("notificationDeliveryRepository (integration)", () => {
  it("records a delivery and lists it back with its user", async () => {
    const user = await seedUser("journal_reader");

    await notificationDeliveryRepository.record({
      userId: user.id,
      kind: "word_card",
      text: "<b>Haus</b>",
      parseMode: "HTML",
      meta: { word: "Haus", source: "srs", entryId: 7 },
    });

    const result = await notificationDeliveryRepository.list({ page: 1, limit: 10, userId: user.id });
    expect(result.total).toBe(1);
    expect(result.deliveries[0]).toMatchObject({
      userId: user.id,
      kind: "word_card",
      text: "<b>Haus</b>",
      parseMode: "HTML",
      meta: { word: "Haus", source: "srs", entryId: 7 },
      user: { id: user.id, telegramId: user.telegramId, username: "journal_reader" },
    });
    expect(result.deliveries[0]?.sentAt).toBeInstanceOf(Date);
  });

  it("isolates one user's messages and orders them newest first", async () => {
    const reader = await seedUser();
    const other = await seedUser();
    const db = getDb();
    await db.insert(notificationDeliveries).values([
      { userId: reader.id, kind: "word_card", text: "older", sentAt: new Date("2026-09-01T08:00:00Z") },
      { userId: reader.id, kind: "trial", text: "newer", sentAt: new Date("2026-09-02T08:00:00Z") },
      { userId: other.id, kind: "word_card", text: "someone else's" },
    ]);

    const result = await notificationDeliveryRepository.list({ page: 1, limit: 10, userId: reader.id });

    expect(result.total).toBe(2);
    expect(result.deliveries.map((row) => row.text)).toEqual(["newer", "older"]);
  });

  it("composes the kind and search filters with the user filter, and counts the filtered set", async () => {
    const reader = await seedUser();
    const db = getDb();
    await db.insert(notificationDeliveries).values([
      { userId: reader.id, kind: "word_card", text: "Haus" },
      { userId: reader.id, kind: "word_card", text: "Baum" },
      { userId: reader.id, kind: "trial", text: "Your trial ends: Haus" },
    ]);

    const byKind = await notificationDeliveryRepository.list({ page: 1, limit: 10, userId: reader.id, kind: "trial" });
    expect(byKind.total).toBe(1);
    expect(byKind.deliveries.map((row) => row.kind)).toEqual(["trial"]);

    const bySearch = await notificationDeliveryRepository.list({
      page: 1,
      limit: 10,
      userId: reader.id,
      search: "haus",
    });
    expect(bySearch.total).toBe(2);

    const paged = await notificationDeliveryRepository.list({ page: 2, limit: 2, userId: reader.id });
    expect(paged.total).toBe(3);
    expect(paged.deliveries).toHaveLength(1);
  });

  it("treats LIKE wildcards in the search as literal text", async () => {
    const reader = await seedUser();
    await getDb()
      .insert(notificationDeliveries)
      .values([
        { userId: reader.id, kind: "word_card", text: "100% done" },
        { userId: reader.id, kind: "word_card", text: "1000 words" },
      ]);

    const result = await notificationDeliveryRepository.list({ page: 1, limit: 10, userId: reader.id, search: "100%" });

    expect(result.deliveries.map((row) => row.text)).toEqual(["100% done"]);
  });

  it("links a tap to the delivery sent as that message, and lists the first tap as the open", async () => {
    const reader = await seedUser();
    await notificationDeliveryRepository.record({
      userId: reader.id,
      kind: "word_card",
      text: "Haus",
      telegramMessageId: 51,
    });
    await notificationDeliveryRepository.record({
      userId: reader.id,
      kind: "trial",
      text: "Trial",
      telegramMessageId: 52,
    });

    const linked = await notificationDeliveryRepository.recordInteraction({
      userId: reader.id,
      telegramMessageId: 51,
      action: "notif:reveal:9",
    });
    await notificationDeliveryRepository.recordInteraction({
      userId: reader.id,
      telegramMessageId: 51,
      action: "notif:fb:easy:9",
    });

    expect(linked).toMatchObject({ kind: "word_card" });
    const { deliveries } = await notificationDeliveryRepository.list({ page: 1, limit: 10, userId: reader.id });
    const card = deliveries.find((row) => row.text === "Haus");
    const trial = deliveries.find((row) => row.text === "Trial");
    expect(card?.id).toBe(linked?.deliveryId);
    expect(card?.interactionCount).toBe(2);
    expect(card?.openedAt).toBeInstanceOf(Date);
    expect(trial).toMatchObject({ interactionCount: 0, openedAt: null });
  });

  it("links nothing for a message that was not a notification, or was another user's", async () => {
    const reader = await seedUser();
    const other = await seedUser();
    await notificationDeliveryRepository.record({
      userId: other.id,
      kind: "word_card",
      text: "Baum",
      telegramMessageId: 61,
    });

    const unknownMessage = await notificationDeliveryRepository.recordInteraction({
      userId: reader.id,
      telegramMessageId: 999,
      action: "tr:more:999",
    });
    // Message ids are per chat, so the same id in another user's chat is a different message.
    const foreignMessage = await notificationDeliveryRepository.recordInteraction({
      userId: reader.id,
      telegramMessageId: 61,
      action: "notif:reveal:1",
    });

    expect(unknownMessage).toBeNull();
    expect(foreignMessage).toBeNull();
    const { deliveries } = await notificationDeliveryRepository.list({ page: 1, limit: 10, userId: other.id });
    expect(deliveries[0]).toMatchObject({ interactionCount: 0, openedAt: null });
  });
});
