/**
 * Momentum persistence — real-DB integration tests (Task 81, plan §8.2.2).
 *
 * Everything proven here is a property of Postgres, not of the repository code:
 * the unique `(user_id, dedupe_key)` index under concurrency, half-open local-day
 * bounds crossing a UTC midnight, the retention sweep's deliberate exemption of
 * `user_momentum`, and the fact that `occurred_at` carries the app's clock rather
 * than the database's `now()` (§4.4). A mocked query builder can assert none of it.
 *
 * Every test provisions its own user through `uniqueTelegramId()` and scopes all
 * reads to that user, so parallel workers cannot see each other's rows.
 */
import { createMomentumService, DEFAULT_MOTIVATION_CONFIG, localDayBounds, MATURE_INTERVAL_DAYS } from "@polyglot/core";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../connection.js";
import { languageRepository } from "../repositories/language.repository.js";
import { momentumRepository } from "../repositories/momentum.repository.js";
import { userRepository } from "../repositories/user.repository.js";
import { vocabularyRepository } from "../repositories/vocabulary.repository.js";
import { runTelemetryRetention } from "../retention.js";
import { momentumEvents } from "../schema.js";
import { uniqueTelegramId } from "../test-helpers/integration/id-factory.js";

async function freshUserId(): Promise<number> {
  const user = await userRepository.create({ telegramId: uniqueTelegramId(), username: "momentum-test" });
  return user.id;
}

async function langId(code: string): Promise<number> {
  const lang = await languageRepository.findByCode(code);
  if (!lang) throw new Error(`Expected seeded language '${code}' to exist on the migrated branch`);
  return lang.id;
}

async function eventsOf(userId: number): Promise<Array<{ kind: string; weight: number; occurredAt: Date }>> {
  return getDb()
    .select({ kind: momentumEvents.kind, weight: momentumEvents.weight, occurredAt: momentumEvents.occurredAt })
    .from(momentumEvents)
    .where(eq(momentumEvents.userId, userId));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("momentumRepository (integration)", () => {
  it("keeps a single row when the same dedupeKey is recorded twice", async () => {
    const userId = await freshUserId();
    const event = {
      userId,
      kind: "translate" as const,
      weight: 1,
      occurredAt: new Date("2026-03-04T10:00:00.000Z"),
      dedupeKey: "translate:req:7",
    };

    expect(await momentumRepository.recordEvent(event)).toBe(true);
    expect(await momentumRepository.recordEvent(event)).toBe(false);

    expect(await eventsOf(userId)).toHaveLength(1);
  });

  it("lets exactly one of two concurrent identical inserts win", async () => {
    const userId = await freshUserId();
    const event = {
      userId,
      kind: "save" as const,
      weight: 2,
      occurredAt: new Date("2026-03-04T10:00:00.000Z"),
      dedupeKey: "save:entry:42",
    };

    const results = await Promise.all([momentumRepository.recordEvent(event), momentumRepository.recordEvent(event)]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await eventsOf(userId)).toHaveLength(1);
  });

  it("counts a Berlin night that straddles UTC midnight as one local day", async () => {
    const userId = await freshUserId();
    // Berlin is UTC+2 in July, so both instants are 16 July local — but 15 and 16 July in UTC.
    const beforeUtcMidnight = new Date("2026-07-15T23:30:00.000Z");
    const afterUtcMidnight = new Date("2026-07-16T00:30:00.000Z");
    await momentumRepository.recordEvent({
      userId,
      kind: "translate",
      weight: 1,
      occurredAt: beforeUtcMidnight,
      dedupeKey: "translate:berlin:1",
    });
    await momentumRepository.recordEvent({
      userId,
      kind: "translate",
      weight: 1,
      occurredAt: afterUtcMidnight,
      dedupeKey: "translate:berlin:2",
    });

    const berlinDay = localDayBounds("Europe/Berlin", afterUtcMidnight);
    expect(await momentumRepository.sumWeightsForLocalDay(userId, "translate", berlinDay.start, berlinDay.end)).toBe(2);

    const utcDay = localDayBounds("UTC", afterUtcMidnight);
    expect(await momentumRepository.sumWeightsForLocalDay(userId, "translate", utcDay.start, utcDay.end)).toBe(1);
  });

  it("writes occurred_at from the app clock, not the database's now()", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));

    const userId = await freshUserId();
    await momentumRepository.recordEvent({
      userId,
      kind: "review",
      weight: 3,
      occurredAt: new Date(),
      dedupeKey: "review:clock",
    });

    const [row] = await eventsOf(userId);
    expect(row?.occurredAt.toISOString()).toBe("2026-01-01T12:00:00.000Z");
  });

  it("prunes momentum_events by retention and leaves the user_momentum snapshot alone", async () => {
    const userId = await freshUserId();
    const ancient = new Date("1990-01-01T00:00:00.000Z");
    await momentumRepository.recordEvent({
      userId,
      kind: "translate",
      weight: 1,
      occurredAt: ancient,
      dedupeKey: "translate:ancient",
    });
    await momentumRepository.applySnapshot(userId, {
      score: 12.5,
      scoredAt: ancient,
      updatedAt: ancient,
    });

    // The sweep is global, so a 90-day horizon would delete rows belonging to
    // tests running in parallel workers. A horizon no other fixture can reach
    // proves the same two branches without touching anyone else's data.
    await runTelemetryRetention(365 * 20);

    expect(await eventsOf(userId)).toHaveLength(0);
    expect(await momentumRepository.getSnapshot(userId)).toMatchObject({ score: 12.5 });
  });

  it("upserts the snapshot, patching only the fields it is given", async () => {
    const userId = await freshUserId();
    const first = new Date("2026-05-01T08:00:00.000Z");
    const second = new Date("2026-05-08T08:00:00.000Z");

    await momentumRepository.applySnapshot(userId, { score: 9, scoredAt: first, updatedAt: first });
    await momentumRepository.applySnapshot(userId, { lastSeenAt: second, updatedAt: second });

    const snapshot = await momentumRepository.getSnapshot(userId);
    expect(snapshot).toEqual({
      score: 9,
      scoredAt: first,
      lastSeenAt: second,
      lastPraiseAt: null,
      lastRecoveryAt: null,
    });
  });

  it("returns replay events oldest-first", async () => {
    const userId = await freshUserId();
    const later = new Date("2026-04-02T09:00:00.000Z");
    const earlier = new Date("2026-04-01T09:00:00.000Z");
    await momentumRepository.recordEvent({
      userId,
      kind: "save",
      weight: 2,
      occurredAt: later,
      dedupeKey: "save:replay:2",
    });
    await momentumRepository.recordEvent({
      userId,
      kind: "translate",
      weight: 1,
      occurredAt: earlier,
      dedupeKey: "translate:replay:1",
    });

    expect(await momentumRepository.listEventsForReplay(userId)).toEqual([
      { kind: "translate", weight: 1, occurredAt: earlier },
      { kind: "save", weight: 2, occurredAt: later },
    ]);
  });

  it("counts active local days, ignoring days that only produced capped-out rows", async () => {
    const userId = await freshUserId();
    const since = new Date("2026-06-01T00:00:00.000Z");
    await momentumRepository.recordEvent({
      userId,
      kind: "translate",
      weight: 1,
      occurredAt: new Date("2026-06-02T10:00:00.000Z"),
      dedupeKey: "translate:ad:1",
    });
    await momentumRepository.recordEvent({
      userId,
      kind: "translate",
      weight: 1,
      occurredAt: new Date("2026-06-02T20:00:00.000Z"),
      dedupeKey: "translate:ad:2",
    });
    await momentumRepository.recordEvent({
      userId,
      kind: "translate",
      weight: 0,
      occurredAt: new Date("2026-06-05T10:00:00.000Z"),
      dedupeKey: "translate:ad:3",
    });

    expect(await momentumRepository.countActiveDays(userId, since, "UTC")).toBe(1);
  });
});

describe("createMomentumService over the real store", () => {
  it("charges a ten-card flashcard session ten rows but only six points", async () => {
    const userId = await freshUserId();
    const now = new Date("2026-02-10T09:00:00.000Z");
    const service = createMomentumService({
      momentumRepository,
      getMotivationConfig: async () => DEFAULT_MOTIVATION_CONFIG,
      getTimezone: async () => "UTC",
      now: () => now,
    });

    for (let card = 0; card < 10; card += 1) {
      await service.record({ userId, kind: "review", dedupeKey: `review:card:${card}`, occurredAt: now });
    }

    const rows = await eventsOf(userId);
    expect(rows).toHaveLength(10);
    expect(rows.reduce((total, row) => total + row.weight, 0)).toBe(6);
  });
});

describe("vocabularyRepository momentum counters (integration)", () => {
  it("counts only live translations at or past the mature interval", async () => {
    const userId = await freshUserId();
    const de = await langId("de");
    const ru = await langId("ru");

    const mature = await vocabularyRepository.create(userId, {
      original: "Backpfeifengesicht",
      sourceLangId: de,
      inputType: "word",
      translations: [{ targetLangId: ru, text: "просит кирпича", details: { synonyms: [], examples: [] } }],
    });
    const young = await vocabularyRepository.create(userId, {
      original: "Haus",
      sourceLangId: de,
      inputType: "word",
      translations: [{ targetLangId: ru, text: "дом", details: { synonyms: [], examples: [] } }],
    });

    await vocabularyRepository.updateSrsState(mature.translations[0]!.id, {
      easeFactor: 2.5,
      interval: MATURE_INTERVAL_DAYS,
      dueDate: new Date("2026-09-01T00:00:00.000Z"),
      reviewCount: 4,
    });
    await vocabularyRepository.updateSrsState(young.translations[0]!.id, {
      easeFactor: 2.5,
      interval: MATURE_INTERVAL_DAYS - 1,
      dueDate: new Date("2026-09-01T00:00:00.000Z"),
      reviewCount: 3,
    });

    expect(await vocabularyRepository.countMatureTranslations(userId, MATURE_INTERVAL_DAYS)).toBe(1);
  });

  it("counts the same cards findDueForSrs would return", async () => {
    const userId = await freshUserId();
    const de = await langId("de");
    const ru = await langId("ru");

    const due = await vocabularyRepository.create(userId, {
      original: "Katze",
      sourceLangId: de,
      inputType: "word",
      translations: [{ targetLangId: ru, text: "кошка", details: { synonyms: [], examples: [] } }],
    });
    await vocabularyRepository.create(userId, {
      original: "Hund",
      sourceLangId: de,
      inputType: "word",
      translations: [{ targetLangId: ru, text: "собака", details: { synonyms: [], examples: [] } }],
    });

    const now = new Date("2026-02-10T09:00:00.000Z");
    await vocabularyRepository.updateSrsState(due.translations[0]!.id, {
      easeFactor: 2.5,
      interval: 6,
      dueDate: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      reviewCount: 2,
    });
    // The second card keeps the `create` default (due tomorrow, real time), which is
    // comfortably in the future relative to `now`.

    expect(await vocabularyRepository.countDueForSrs(userId, now)).toBe(1);
    expect(await vocabularyRepository.findDueForSrs(userId, now, 50)).toHaveLength(1);
  });

  it("excludes a soft-deleted entry from both counters", async () => {
    const userId = await freshUserId();
    const de = await langId("de");
    const ru = await langId("ru");

    const entry = await vocabularyRepository.create(userId, {
      original: "Fenster",
      sourceLangId: de,
      inputType: "word",
      translations: [{ targetLangId: ru, text: "окно", details: { synonyms: [], examples: [] } }],
    });
    await vocabularyRepository.updateSrsState(entry.translations[0]!.id, {
      easeFactor: 2.5,
      interval: MATURE_INTERVAL_DAYS,
      dueDate: new Date("2020-01-01T00:00:00.000Z"),
      reviewCount: 4,
    });
    expect(await vocabularyRepository.countMatureTranslations(userId, MATURE_INTERVAL_DAYS)).toBe(1);

    await vocabularyRepository.delete(entry.id);

    expect(await vocabularyRepository.countMatureTranslations(userId, MATURE_INTERVAL_DAYS)).toBe(0);
    expect(await vocabularyRepository.countDueForSrs(userId, new Date("2026-02-10T09:00:00.000Z"))).toBe(0);
  });
});
