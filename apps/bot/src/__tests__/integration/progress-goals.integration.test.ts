/**
 * Goal ladder on `/progress` — grammY e2e integration test (plan
 * `progress-goal-ladder` rev 4, step 5).
 *
 * Drives `/progress` through the real dispatcher against real Postgres: the
 * learner's fifth counted month closes inside the command, the reward lands as a
 * subscription row, the gift message goes out once — also when two `/progress`
 * updates race — and the screen shows the ladder.
 *
 * The ladder's switch lives in the global `system_settings` row, which this lane
 * must not flip (two workers share one database). The test therefore swaps
 * `services.progressService` for one built on the real repository with its own
 * flags, and gives the harness's settings port `enabled` for the screen itself —
 * the same route `momentum-surfaces.integration.test.ts` takes.
 */
import {
  getDb,
  getLang,
  momentumEvents,
  progressMonths,
  progressRepository,
  userRepository,
  vocabularyRepository,
} from "@polyglot/adapter-db";
import {
  createProgressService,
  DEFAULT_MOTIVATION_CONFIG,
  MATURE_INTERVAL_DAYS,
  type MotivationConfig,
  type PlanDays,
  t,
} from "@polyglot/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { arrangeOnboardedTranslator } from "../../test-helpers/integration/arrange.js";
import { type CapturedCall, createBotHarness, messageUpdate } from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";

const NOW = new Date("2026-11-08T09:00:00.000Z");
const FREE_MONTH: PlanDays = { free: 30, plus: 0, pro: 0, trial: 0 };

function configWith(flags: Partial<MotivationConfig>): MotivationConfig {
  return { ...DEFAULT_MOTIVATION_CONFIG, enabled: true, ...flags };
}

function harnessWith(flags: Partial<MotivationConfig>) {
  const harness = createBotHarness({ settings: { getMotivationConfig: async () => configWith(flags) } });
  harness.services.progressService = createProgressService({
    progressRepository,
    getMotivationConfig: async () => configWith(flags),
    getTimezone: async () => "UTC",
    countMatureWords: (userId) => vocabularyRepository.countMatureTranslations(userId, MATURE_INTERVAL_DAYS),
  });
  return harness;
}

function sentTexts(sent: CapturedCall[]): string[] {
  return sent
    .filter((call) => call.method === "sendMessage")
    .map((call) => String((call.payload as { text?: string }).text ?? ""));
}

async function seedWord(userId: number): Promise<void> {
  const source = getLang("en");
  const target = getLang("cs");
  if (!source || !target) throw new Error("language cache is not loaded (en/cs missing)");
  await vocabularyRepository.create(userId, {
    original: `progress-word-${userId}`,
    sourceLangId: source.id,
    inputType: "word",
    unverified: false,
    translations: [{ targetLangId: target.id, text: `slovo-${userId}`, details: { synonyms: [], examples: [] } }],
  });
}

/** Twelve review days and one matured word in `month`: a counted month. */
async function seedCountedMonth(userId: number, month: string): Promise<void> {
  const rows: Array<typeof momentumEvents.$inferInsert> = Array.from({ length: 12 }, (_, index) => ({
    userId,
    kind: "review",
    weight: 3,
    occurredAt: new Date(`${month}-${String(index + 2).padStart(2, "0")}T10:00:00.000Z`),
    dedupeKey: `seed:review:${month}:${index}`,
  }));
  rows.push({
    userId,
    kind: "mature",
    weight: 10,
    occurredAt: new Date(`${month}-02T11:00:00.000Z`),
    dedupeKey: `seed:mature:${month}`,
  });
  await getDb().insert(momentumEvents).values(rows);
}

/** Three counted months already in the ledger plus September and October live: the fifth closes on open. */
async function arrangeFifthMonth(userId: number): Promise<void> {
  await getDb()
    .insert(progressMonths)
    .values(
      ["2026-04", "2026-05", "2026-06"].map((month) => ({
        userId,
        month,
        tz: "UTC",
        activeDays: 15,
        matureGained: 2,
        savedGained: 3,
        counted: true,
        planDays: FREE_MONTH,
        source: "live" as const,
        closedAt: NOW,
      })),
    );
  await seedCountedMonth(userId, "2026-09");
  await seedCountedMonth(userId, "2026-10");
  await seedWord(userId);
}

function subscriptionsOf(userId: number) {
  return getDb().query.subscriptions.findMany({ where: (row, { eq }) => eq(row.userId, userId) });
}

async function planOf(userId: number): Promise<string | undefined> {
  return (await userRepository.findById(userId))?.subscriptionPlan;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("/progress goal ladder (integration)", () => {
  it("closes the fifth counted month, grants a free Plus month once and shows the ladder", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    // Arrange
    const harness = harnessWith({ progressGoalsEnabled: true });
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id);
    await arrangeFifthMonth(userId);

    // Act
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "/progress" }));

    // Assert — reply
    const gift = t("progressRewardCreated", "en", { plan: "Plus" });
    const texts = sentTexts(harness.sent);
    // The gift goes out before the screen, once.
    expect(texts.filter((text) => text === gift)).toHaveLength(1);
    expect(texts.indexOf(gift)).toBe(texts.length - 2);
    const screen = texts.at(-1) ?? "";
    expect(screen).toContain(t("progressTitle", "en"));
    expect(screen).toContain(t("progressGoalMonths", "en", { count: 0, total: 5 }));
    expect(screen).toContain(t("progressGoalMilestone", "en", { target: 10, remaining: 10 }));
    expect(screen).toContain(t("progressGoalDayTodo", "en", { reviews: 0, target: 5 }));
    // Assert — DB
    const rows = await subscriptionsOf(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: "reward", plan: "plus", status: "active" });
    expect(await planOf(userId)).toBe("plus");
    expect((await progressRepository.getLedger(userId)).map((row) => row.month)).toEqual([
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-09",
      "2026-10",
    ]);

    // Cleanup, then Act again: the gift is not announced twice.
    harness.reset();
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "/progress" }));

    expect(sentTexts(harness.sent)).not.toContain(gift);
    expect(await subscriptionsOf(userId)).toHaveLength(1);
  });

  it("grants one reward when two /progress updates race", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    // Arrange
    const harness = harnessWith({ progressGoalsEnabled: true });
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id);
    await arrangeFifthMonth(userId);

    // Act
    await Promise.all([
      harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "/progress" })),
      harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "/progress" })),
    ]);

    // Assert
    const gift = t("progressRewardCreated", "en", { plan: "Plus" });
    expect(sentTexts(harness.sent).filter((text) => text === gift)).toHaveLength(1);
    expect(await subscriptionsOf(userId)).toHaveLength(1);
  });

  it("while hidden shows the old screen and grants nothing, yet the daily close still writes the ledger", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    // Arrange
    const harness = harnessWith({ progressGoalsEnabled: false });
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id);
    await arrangeFifthMonth(userId);

    // Act
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "/progress" }));
    const closed = await harness.services.progressService.closeForUser(userId);

    // Assert
    const screen = sentTexts(harness.sent).at(-1) ?? "";
    expect(screen).toContain(t("progressTitle", "en"));
    expect(screen).not.toContain(t("progressGoalMonths", "en", { count: 0, total: 5 }));
    expect(closed).toMatchObject({ closedMonths: ["2026-09", "2026-10"], countedMonths: 5, granted: [] });
    expect(await subscriptionsOf(userId)).toEqual([]);
    expect(await planOf(userId)).toBe("free");
  });
});
