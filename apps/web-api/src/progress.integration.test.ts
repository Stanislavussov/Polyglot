/**
 * Momentum on the web, as in the bot (Task 81):
 * - a web translation credits `translate:<requestId>`, its auto-save `save:<entryId>`,
 *   a web rating `review:<entryId>:<day>` — the bot's keys, one journal;
 * - GET /api/progress is the bot's /progress screen in the learner's language.
 */
import {
  getDb,
  getLang,
  momentumEvents,
  progressMonths,
  progressRepository,
  vocabularyRepository,
} from "@polyglot/adapter-db";
import {
  createProgressService,
  DEFAULT_MOTIVATION_CONFIG,
  MATURE_INTERVAL_DAYS,
  type MotivationConfig,
  t,
} from "@polyglot/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { arrangeOnboardedTranslator } from "../../bot/src/test-helpers/integration/arrange.js";
import { uniqueTelegramId } from "../../bot/src/test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../bot/src/test-helpers/integration/translate-ai-mock.js";
import { createWebHarness } from "./test-helpers/web-harness.js";

function momentumKeys(userId: number): Promise<{ kind: string; dedupe_key: string }[]> {
  return getDb().$client<{ kind: string; dedupe_key: string }[]>`
    select kind, dedupe_key from momentum_events where user_id = ${userId} order by id asc
  `;
}

describe("web momentum", () => {
  it("credits translate, save and review, and shows the progress screen", async () => {
    const web = await createWebHarness({
      ai: deterministicTranslateAi(),
      settings: { getMotivationConfig: async () => ({ ...DEFAULT_MOTIVATION_CONFIG, enabled: true }) },
    });
    const telegramId = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(telegramId, { nativeLang: "en", learningLangs: ["cs"] });
    const { cookie } = await web.login(telegramId);

    const empty = await web.call(cookie, "GET", "/api/progress");
    expect(empty).toMatchObject({ status: 200, body: { enabled: true, stats: [] } });

    const { saveToken } = (await web.call(cookie, "POST", "/api/translate", { text: "hello" })).body as {
      saveToken: string;
    };
    const translated = {
      savedEntryId: (
        (await web.call(cookie, "POST", "/api/translate/save", { token: saveToken })).body as { entryId: number }
      ).entryId,
    };
    expect((await web.call(cookie, "POST", `/api/review/${translated.savedEntryId}`, { rating: "good" })).status).toBe(
      200,
    );

    const keys = await momentumKeys(userId);
    expect(keys.map((k) => k.kind)).toEqual(["translate", "save", "review"]);
    expect(keys[1]!.dedupe_key).toBe(`save:${translated.savedEntryId}`);
    expect(keys[2]!.dedupe_key).toMatch(new RegExp(`^review:${translated.savedEntryId}:`));

    const progress = await web.call(cookie, "GET", "/api/progress");
    expect(progress.status).toBe(200);
    const body = progress.body as { stats: string[]; level: number; title: string };
    expect(body.title).toContain("progress");
    expect(body.stats[0]).toContain("1");
    expect(body.level).toBeGreaterThanOrEqual(1);
  });
});

const NOW = new Date("2026-11-08T09:00:00.000Z");

async function harnessWithLadder(flags: Partial<MotivationConfig>) {
  const config = { ...DEFAULT_MOTIVATION_CONFIG, enabled: true, ...flags };
  const web = await createWebHarness({ settings: { getMotivationConfig: async () => config } });
  // The container's progress service reads the global settings row, which this lane must not flip.
  web.bot.services.progressService = createProgressService({
    progressRepository,
    getMotivationConfig: async () => config,
    getTimezone: async () => "UTC",
    countMatureWords: (userId) => vocabularyRepository.countMatureTranslations(userId, MATURE_INTERVAL_DAYS),
  });
  return web;
}

/** Three Plus months already in the ledger, September and October live: the fifth counted month closes on open. */
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
        planDays: { free: 0, plus: 30, pro: 0, trial: 0 },
        source: "live" as const,
        closedAt: NOW,
      })),
    );
  for (const month of ["2026-09", "2026-10"]) {
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
  const source = getLang("en");
  const target = getLang("cs");
  if (!source || !target) throw new Error("language cache is not loaded (en/cs missing)");
  await vocabularyRepository.create(userId, {
    original: `web-progress-${userId}`,
    sourceLangId: source.id,
    inputType: "word",
    unverified: false,
    translations: [{ targetLangId: target.id, text: `slovo-${userId}`, details: { synonyms: [], examples: [] } }],
  });
}

function rewardRows(userId: number) {
  return getDb().query.subscriptions.findMany({
    where: (row, { and, eq }) => and(eq(row.userId, userId), eq(row.provider, "reward")),
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("web goal ladder", () => {
  it("is absent from both endpoints while hidden", async () => {
    const web = await harnessWithLadder({ progressGoalsEnabled: false });
    const telegramId = uniqueTelegramId();
    await arrangeOnboardedTranslator(telegramId);
    const { cookie } = await web.login(telegramId);

    const progress = await web.call(cookie, "GET", "/api/progress");
    const goal = await web.call(cookie, "GET", "/api/progress/goal");

    expect(progress.body).toMatchObject({ enabled: true });
    expect(progress.body).not.toHaveProperty("ladder");
    expect(goal.body).toEqual({ nearest: null, rewards: [] });
  });

  it("shows the ladder and grants the fifth month's reward once, whichever endpoint opens first", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const web = await harnessWithLadder({ progressGoalsEnabled: true });
    const telegramId = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(telegramId);
    await arrangeFifthMonth(userId);
    const { cookie } = await web.login(telegramId);

    const goal = (await web.call(cookie, "GET", "/api/progress/goal")).body as { nearest: string; rewards: string[] };
    const progress = (await web.call(cookie, "GET", "/api/progress")).body as {
      ladder: { lines: string[]; nearest: string; rewards: string[] };
    };

    const gift = t("progressRewardCreated", "en", { plan: "Plus" });
    expect(goal.rewards).toEqual([gift]);
    expect(goal.nearest).toBeTruthy();
    expect(progress.ladder.lines).toEqual([
      t("progressGoalMonths", "en", { count: 0, total: 5 }),
      t("progressGoalMonth", "en", { days: 0, minDays: 12, mature: 0, saved: 0 }),
      t("progressGoalMilestone", "en", { target: 10, remaining: 10 }),
      t("progressGoalDayTodo", "en", { reviews: 0, target: 5 }),
    ]);
    expect(progress.ladder.nearest).toBe(goal.nearest);
    expect(progress.ladder.rewards).toEqual([]);
    expect(await rewardRows(userId)).toHaveLength(1);
  });
});
