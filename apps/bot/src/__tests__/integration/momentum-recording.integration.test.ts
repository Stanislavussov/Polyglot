/**
 * Momentum recording — grammY e2e integration test (Task 81, Slice 1, §8.2.3).
 *
 * Drives the three effort kinds Slice 1 can reach through the REAL dispatcher and a
 * real Postgres: a translation, a save tap on the rendered card, and an SRS rating
 * of the word that was just saved. Nothing user-visible changes in this slice, so
 * the assertions are on the journal, the snapshot, and the delivered card.
 *
 * Time is driven with `vi.setSystemTime` over a Date-only fake (`toFake: ["Date"]`):
 * every momentum instant is written from the app's injected clock (§4.4), and full
 * fake timers would freeze the `setTimeout` the long-op guard and the Postgres
 * driver depend on. The three events are placed at known instants so the expected
 * score can be computed with core's own `applyEffort` rather than hardcoded.
 */
import { getDb, momentumRepository, translationRequestRepository, vocabularyRepository } from "@polyglot/adapter-db";
import {
  applyEffort,
  createMomentumService,
  DEFAULT_MOTIVATION_CONFIG,
  localDayKey,
  type MomentumRepository,
  type MomentumState,
} from "@polyglot/core";
import { describe, expect, it, vi } from "vitest";
import { arrangeOnboardedTranslator } from "../../test-helpers/integration/arrange.js";
import {
  type BotHarness,
  callbackQueryUpdate,
  createBotHarness,
  lastRenderedCard,
  messageUpdate,
} from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../test-helpers/integration/translate-ai-mock.js";

const TRANSLATED_AT = new Date("2026-05-14T09:00:00.000Z");
const SAVED_AT = new Date("2026-05-14T10:00:00.000Z");
/** Two days on, because `vocabularyRepository.create` schedules a fresh card for tomorrow. */
const REVIEWED_AT = new Date("2026-05-16T11:00:00.000Z");

interface MomentumEventRow {
  id: number;
  kind: string;
  weight: number;
  dedupe_key: string;
  /** Formatted in SQL: the driver's timestamptz decoding is not what this test is about. */
  occurred_at_iso: string;
}

/**
 * `drizzle-orm` is not a dependency of `apps/bot` (only the adapter owns it), and
 * the repository port has no "list with keys" method — the dedupe key is exactly
 * what this test is about, so it is read through the driver the adapter exposes.
 */
function readMomentumEvents(userId: number): Promise<MomentumEventRow[]> {
  return getDb().$client<MomentumEventRow[]>`
    select id, kind, weight, dedupe_key,
           to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as occurred_at_iso
    from momentum_events
    where user_id = ${userId}
    order by occurred_at asc, id asc
  `;
}

function readMomentumScore(userId: number): Promise<Array<{ score: number }>> {
  return getDb().$client<Array<{ score: number }>>`
    select score from user_momentum where user_id = ${userId}
  `;
}

/** Translate one word and return the id of the card the bot rendered. */
async function translateWord(harness: BotHarness, chatId: number, word: string): Promise<number> {
  await harness.dispatch(messageUpdate({ chatId, fromId: chatId, text: word }));
  return lastRenderedCard(harness.sent).messageId;
}

/** Run a one-card SRS session to completion: `/review` → reveal → rate. */
async function reviewOneCard(harness: BotHarness, chatId: number): Promise<void> {
  harness.reset();
  await harness.dispatch(messageUpdate({ chatId, fromId: chatId, text: "/review" }));
  const cardMsgId = harness.sent.filter((call) => call.method === "sendMessage").at(-1)?.messageId;
  if (cardMsgId === undefined) throw new Error("no SRS card was sent — the word was not due for review");

  await harness.dispatch(callbackQueryUpdate({ chatId, fromId: chatId, messageId: cardMsgId, data: "srs:reveal" }));
  await harness.dispatch(callbackQueryUpdate({ chatId, fromId: chatId, messageId: cardMsgId, data: "srs:rate:good" }));
}

/** A momentum service on the real journal, with the kill switches under the test's control. */
function momentumServiceWith(options: { repository?: MomentumRepository; recordingEnabled?: boolean }) {
  return createMomentumService({
    momentumRepository: options.repository ?? momentumRepository,
    getMotivationConfig: async () => ({
      ...DEFAULT_MOTIVATION_CONFIG,
      recordingEnabled: options.recordingEnabled ?? true,
    }),
    getTimezone: async () => "UTC",
  });
}

describe("momentum recording (integration)", () => {
  it("credits a translation, a save and a review exactly once each, and replays add nothing", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(TRANSLATED_AT);
      const harness = createBotHarness({ ai: deterministicTranslateAi() });
      const id = uniqueTelegramId();
      const userId = await arrangeOnboardedTranslator(id);

      const cardMsgId = await translateWord(harness, id, "hello");

      vi.setSystemTime(SAVED_AT);
      const saveUpdate = callbackQueryUpdate({
        chatId: id,
        fromId: id,
        messageId: cardMsgId,
        data: `tr:save:${cardMsgId}`,
      });
      await harness.dispatch(saveUpdate);

      vi.setSystemTime(REVIEWED_AT);
      await reviewOneCard(harness, id);

      const [ledgerRow] = await translationRequestRepository.getRecentRequests(userId, 1);
      if (!ledgerRow) throw new Error("expected a translation_requests row");
      const savedEntry = (await vocabularyRepository.findByUser(userId)).at(0);
      if (!savedEntry) throw new Error("expected the saved vocabulary entry");

      const events = await readMomentumEvents(userId);
      expect(events.map((row) => row.dedupe_key)).toEqual([
        `translate:${ledgerRow.id}`,
        `save:${savedEntry.id}`,
        `review:${savedEntry.id}:${localDayKey("UTC", REVIEWED_AT)}`,
      ]);
      expect(events.map((row) => row.kind)).toEqual(["translate", "save", "review"]);
      // Weights straight from §3.4, none of them capped by a single-action day.
      expect(events.map((row) => row.weight)).toEqual([1, 2, 3]);
      // The instants are the app's, not the database's (§4.4).
      expect(events.map((row) => row.occurred_at_iso)).toEqual([
        TRANSLATED_AT.toISOString(),
        SAVED_AT.toISOString(),
        REVIEWED_AT.toISOString(),
      ]);

      let expected: MomentumState = { score: 0, scoredAt: TRANSLATED_AT };
      expected = applyEffort(expected, 1, TRANSLATED_AT);
      expected = applyEffort(expected, 2, SAVED_AT);
      expected = applyEffort(expected, 3, REVIEWED_AT);
      const [snapshot] = await readMomentumScore(userId);
      expect(snapshot?.score).toBeCloseTo(expected.score, 9);

      // Replay: Telegram redelivering the very same save tap and the same rating.
      // Neither may add a row — the second tap is refused by the card handler, the
      // second rating by the finished session, and behind both stands the dedupe key.
      await harness.dispatch(saveUpdate);
      await harness.dispatch(
        callbackQueryUpdate({ chatId: id, fromId: id, messageId: cardMsgId, data: "srs:rate:good" }),
      );
      expect(await readMomentumEvents(userId)).toEqual(events);
    } finally {
      vi.useRealTimers();
    }
  });

  it("records nothing while the recording kill switch is off", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(TRANSLATED_AT);
      const harness = createBotHarness({ ai: deterministicTranslateAi() });
      harness.services.momentumService = momentumServiceWith({ recordingEnabled: false });
      const id = uniqueTelegramId();
      const userId = await arrangeOnboardedTranslator(id);

      const cardMsgId = await translateWord(harness, id, "world");
      vi.setSystemTime(SAVED_AT);
      await harness.dispatch(
        callbackQueryUpdate({ chatId: id, fromId: id, messageId: cardMsgId, data: `tr:save:${cardMsgId}` }),
      );
      vi.setSystemTime(REVIEWED_AT);
      await reviewOneCard(harness, id);

      const savedEntry = (await vocabularyRepository.findByUser(userId)).at(0);
      if (!savedEntry) throw new Error("expected the saved vocabulary entry");
      // The review really happened — otherwise "no momentum rows" would pass vacuously.
      expect(await harness.services.wordReviewRepository.getReviewsForWord(savedEntry.id)).toHaveLength(1);
      expect(await readMomentumEvents(userId)).toHaveLength(0);
      expect(await readMomentumScore(userId)).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still delivers the translation card when the momentum repository throws", async () => {
    const down = (): Promise<never> => Promise.reject(new Error("momentum journal is down"));
    const failingRepository: MomentumRepository = {
      getSnapshot: down,
      recordEvent: down,
      applySnapshot: down,
      sumWeightsForLocalDay: down,
      countEventsSince: down,
      listPraisedKinds: down,
      countActiveDays: down,
      listEventsForReplay: down,
    };

    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    harness.services.momentumService = momentumServiceWith({ repository: failingRepository });
    const id = uniqueTelegramId();
    await arrangeOnboardedTranslator(id);

    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "hello" }));

    // The guarantee of §4.2: a momentum outage cannot fail a translation.
    const { messageId, buttons } = lastRenderedCard(harness.sent);
    expect(buttons).toContain(`tr:save:${messageId}`);
  });
});
