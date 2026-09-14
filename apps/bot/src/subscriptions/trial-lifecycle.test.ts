/**
 * Task 84 — the trial lifecycle sweep.
 *
 * Spec under test (the decision table itself is proved in
 * `packages/core/src/modules/subscriptions/subscriptions.test.ts`; what matters
 * here is that the sweep carries each decision out and spends it exactly once):
 *
 * - A trial a day from its end warns, and the warning names the earn-more deal
 *   while it is still on offer.
 * - A user who saved enough words gets the extension written to the ledger
 *   BEFORE they are told about it.
 * - An ended trial is downgraded to free and closed with one message.
 * - Every message is spent in `notification_history`, so a second sweep the same
 *   day sends nothing — and a user whose trial is already closed costs the sweep
 *   nothing but the history read.
 * - A transient Telegram failure leaves the message unspent (retried tomorrow);
 *   a permanent one spends it and retires the recipient.
 */
import {
  formatLongDate,
  type Subscription,
  TRIAL_ENDED_SOURCE,
  TRIAL_ENDING_FINAL_SOURCE,
  TRIAL_ENDING_SOURCE,
  TRIAL_EXTENDED_SOURCE,
  TRIAL_EXTENSION_DAYS,
  TRIAL_EXTENSION_WORDS,
  TRIAL_PLAN,
  TRIAL_PROVIDER,
  t,
} from "@polyglot/core";
import { GrammyError } from "grammy";
import { describe, expect, it, vi } from "vitest";
import { runTrialLifecycleSweep, type TrialSweepServices } from "./trial-lifecycle.wiring.js";

const NOW = new Date("2026-09-18T10:20:00Z");
/** A row whose period already carries the extension (created + 7d + 3d). */
const EXTENDED_NOW = new Date("2026-09-21T10:20:00Z");
const USER_ID = 7;
const CHAT_ID = 7001;

function trialRow(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 11,
    userId: USER_ID,
    plan: TRIAL_PLAN,
    status: "active",
    provider: TRIAL_PROVIDER,
    externalId: null,
    // Two hours left — inside the warning window.
    currentPeriodEnd: new Date("2026-09-18T12:20:00Z"),
    createdAt: new Date("2026-09-11T12:20:00Z"),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** The same trial after its one extension: created + 7d + 3d. */
const extendedRow = (): Subscription => trialRow({ currentPeriodEnd: new Date("2026-09-21T12:20:00Z") });

interface Harness {
  services: TrialSweepServices;
  api: { sendMessage: ReturnType<typeof vi.fn> };
  history: Array<{ userId: number; source: string }>;
  activeSubscription: Subscription | null;
  plan: string;
}

/**
 * Sweep services over a tiny in-memory `notification_history`, so "sent once" is
 * asserted the way production enforces it — by reading back what the previous
 * send wrote — rather than by counting mock calls.
 */
function harness(
  options: { row?: Subscription; wordsSaved?: number; sent?: string[]; userPlan?: string } = {},
): Harness {
  const row = options.row ?? trialRow();
  const history: Array<{ userId: number; source: string }> = (options.sent ?? []).map((source) => ({
    userId: USER_ID,
    source,
  }));

  const state = { activeSubscription: row as Subscription | null, plan: options.userPlan ?? TRIAL_PLAN };

  const services: TrialSweepServices = {
    subscriptionRepository: {
      create: vi.fn(),
      findActiveByUser: vi.fn(async () => state.activeSubscription),
      findTrialByUser: vi.fn(async () => row),
      findTrialsEndingBetween: vi.fn(async () => [row]),
      findExpired: vi.fn(async () => []),
      extend: vi.fn(async (_id: number, newPeriodEnd: Date) => {
        state.activeSubscription = { ...row, currentPeriodEnd: newPeriodEnd };
      }),
      updateStatus: vi.fn(async (_id: number, status: Subscription["status"]) => {
        state.activeSubscription = status === "active" ? state.activeSubscription : null;
      }),
    },
    userRepository: {
      findById: vi.fn(async () => ({ id: USER_ID, subscriptionPlan: options.userPlan ?? state.plan }) as never),
      getSettings: vi.fn(async () => ({ interfaceLang: "en" }) as never),
      getTelegramIdById: vi.fn(async () => CHAT_ID),
      updateSubscriptionPlan: vi.fn(async (_userId: number, plan: string) => {
        state.plan = plan;
        return null;
      }),
    },
    notificationRepository: {
      hasSentFromSource: vi.fn(async (userId: number, source: string) =>
        history.some((row) => row.userId === userId && row.source === source),
      ),
      recordSentWord: vi.fn(async (userId: number, _original: string, source: string) => {
        history.push({ userId, source });
      }),
      disableNotifications: vi.fn(async () => {}),
    },
    momentumRepository: {
      countEventsSince: vi.fn(async () => options.wordsSaved ?? 0),
    },
    notificationDeliveryRepository: { record: vi.fn(async () => {}) },
  };

  const api = { sendMessage: vi.fn(async () => ({ message_id: 1 })) };

  return {
    services,
    api,
    history,
    get activeSubscription() {
      return state.activeSubscription;
    },
    get plan() {
      return state.plan;
    },
  };
}

function sentText(api: Harness["api"]): string {
  return String(api.sendMessage.mock.calls[0]?.[1] ?? "");
}

describe("trial lifecycle sweep — a day before the end", () => {
  it("warns a user short of the threshold, and names the deal that is still open", async () => {
    const h = harness({ wordsSaved: TRIAL_EXTENSION_WORDS - 1 });

    await runTrialLifecycleSweep(h.api, h.services, NOW);

    expect(h.api.sendMessage).toHaveBeenCalledTimes(1);
    expect(sentText(h.api)).toContain(String(TRIAL_EXTENSION_WORDS));
    expect(h.history).toEqual([{ userId: USER_ID, source: TRIAL_ENDING_SOURCE }]);
    expect(h.services.subscriptionRepository.extend).not.toHaveBeenCalled();
    expect(h.plan).toBe(TRIAL_PLAN);
    expect(h.services.notificationDeliveryRepository.record).toHaveBeenCalledWith({
      userId: USER_ID,
      kind: "trial",
      text: sentText(h.api),
      meta: { source: TRIAL_ENDING_SOURCE },
    });
  });

  it("drops the earn-more offer once the extension is on the row, and files it separately", async () => {
    // An extended row carries more than TRIAL_DAYS, which is the only marker
    // trusted here: the congratulation's history row may never have been written.
    const h = harness({ row: extendedRow(), wordsSaved: TRIAL_EXTENSION_WORDS * 4 });

    await runTrialLifecycleSweep(h.api, h.services, EXTENDED_NOW);

    expect(h.services.subscriptionRepository.extend).not.toHaveBeenCalled();
    expect(sentText(h.api)).not.toContain(String(TRIAL_EXTENSION_WORDS));
    // A distinct source, so a user warned before earning the extension is still
    // warned before the new end.
    expect(h.history.map((row) => row.source)).toEqual([TRIAL_ENDING_FINAL_SOURCE]);
  });

  it("never re-extends after a congratulation that failed to send", async () => {
    // The unbounded-free-Plus regression: the extension was committed, the
    // message was not, and the sweep used to read the missing message as
    // "not extended yet" and grant another three days on every pass.
    const h = harness({ row: extendedRow(), wordsSaved: TRIAL_EXTENSION_WORDS * 4, sent: [] });

    await runTrialLifecycleSweep(h.api, h.services, EXTENDED_NOW);

    expect(h.services.subscriptionRepository.extend).not.toHaveBeenCalled();
  });

  it("warns again before the extended end for a user already warned before it", async () => {
    const h = harness({ row: extendedRow(), wordsSaved: TRIAL_EXTENSION_WORDS, sent: [TRIAL_ENDING_SOURCE] });

    await runTrialLifecycleSweep(h.api, h.services, EXTENDED_NOW);

    expect(h.api.sendMessage).toHaveBeenCalledTimes(1);
    expect(h.history.map((row) => row.source)).toEqual([TRIAL_ENDING_SOURCE, TRIAL_ENDING_FINAL_SOURCE]);
  });

  it("names the date this trial ends, not a count of hours", async () => {
    // A daily sweep first meets a trial anywhere between one and two days from
    // its end, so a fixed hour count would be a lie — and a variable one breaks
    // noun agreement in half the locales.
    // Created exactly TRIAL_DAYS before it ends, as the grant writes it — a row
    // whose period is longer than that reads as already extended.
    const endsAt = new Date("2026-09-20T02:20:00Z");
    const h = harness({
      row: trialRow({ createdAt: new Date("2026-09-13T02:20:00Z"), currentPeriodEnd: endsAt }),
      wordsSaved: 1,
    });

    await runTrialLifecycleSweep(h.api, h.services, NOW);

    expect(sentText(h.api)).toBe(
      t("trialEndingSoon", "en", {
        date: formatLongDate(endsAt, "en", "UTC"),
        words: String(TRIAL_EXTENSION_WORDS),
        extraDays: String(TRIAL_EXTENSION_DAYS),
      }),
    );
  });

  it("says nothing to a user who bought the plan mid-trial", async () => {
    // `activate` supersedes the trial row. Warning a paying convert that their
    // Plus is about to switch off aims the worst message in the product at the
    // one cohort the trial exists to produce.
    const h = harness({ row: trialRow({ status: "canceled" }), wordsSaved: 2, userPlan: "plus" });

    await runTrialLifecycleSweep(h.api, h.services, NOW);

    expect(h.api.sendMessage).not.toHaveBeenCalled();
    expect(h.history).toHaveLength(0);
  });

  it("says nothing about a live trial the user's plan pointer never took", async () => {
    // The crash window inside the grant: the row landed, the pointer did not.
    const h = harness({ wordsSaved: 2, userPlan: "free" });

    await runTrialLifecycleSweep(h.api, h.services, NOW);

    expect(h.api.sendMessage).not.toHaveBeenCalled();
    expect(h.history).toHaveLength(0);
  });

  it("extends the period before announcing it, for a user who earned it", async () => {
    const h = harness({ wordsSaved: TRIAL_EXTENSION_WORDS });

    await runTrialLifecycleSweep(h.api, h.services, NOW);

    const expectedEnd = new Date(trialRow().currentPeriodEnd.getTime() + TRIAL_EXTENSION_DAYS * 24 * 60 * 60 * 1000);
    expect(h.services.subscriptionRepository.extend).toHaveBeenCalledWith(11, expectedEnd);
    expect(h.activeSubscription?.currentPeriodEnd).toEqual(expectedEnd);
    expect(h.history).toEqual([{ userId: USER_ID, source: TRIAL_EXTENDED_SOURCE }]);
    expect(h.plan).toBe(TRIAL_PLAN);
  });

  it("sends nothing on a second sweep the same day", async () => {
    const h = harness({ wordsSaved: 1 });

    await runTrialLifecycleSweep(h.api, h.services, NOW);
    await runTrialLifecycleSweep(h.api, h.services, NOW);

    expect(h.api.sendMessage).toHaveBeenCalledTimes(1);
    expect(h.history).toHaveLength(1);
  });
});

describe("trial lifecycle sweep — after the end", () => {
  const endedRow = trialRow({ currentPeriodEnd: new Date("2026-09-18T09:00:00Z") });

  it("downgrades to free and closes the trial with one message", async () => {
    const h = harness({ row: endedRow, wordsSaved: 12 });

    await runTrialLifecycleSweep(h.api, h.services, NOW);

    expect(h.services.subscriptionRepository.updateStatus).toHaveBeenCalledWith(11, "expired");
    expect(h.plan).toBe("free");
    expect(sentText(h.api)).toContain("12");
    expect(h.history).toEqual([{ userId: USER_ID, source: TRIAL_ENDED_SOURCE }]);
  });

  it("leaves the tally out of the closing message when nothing was saved", async () => {
    const h = harness({ row: endedRow, wordsSaved: 0 });

    await runTrialLifecycleSweep(h.api, h.services, NOW);

    // The variant without a tally, rather than the one that would read
    // "saved this week: 0".
    expect(sentText(h.api)).toBe(t("trialEndedEmpty", "en"));
    expect(h.plan).toBe("free");
  });

  it("still closes the trial when the renewal sweep already expired the row", async () => {
    const h = harness({ row: { ...endedRow, status: "expired" }, wordsSaved: 3 });

    await runTrialLifecycleSweep(h.api, h.services, NOW);

    // Nothing left to expire, but the user is still owed the message.
    expect(h.services.subscriptionRepository.updateStatus).not.toHaveBeenCalled();
    expect(h.history).toEqual([{ userId: USER_ID, source: TRIAL_ENDED_SOURCE }]);
  });

  it("costs nothing but the history read once the closing message is spent", async () => {
    const h = harness({ row: endedRow, sent: [TRIAL_ENDED_SOURCE] });

    await runTrialLifecycleSweep(h.api, h.services, NOW);

    expect(h.api.sendMessage).not.toHaveBeenCalled();
    expect(h.services.momentumRepository.countEventsSince).not.toHaveBeenCalled();
    expect(h.services.subscriptionRepository.updateStatus).not.toHaveBeenCalled();
  });
});

describe("trial lifecycle sweep — delivery failures", () => {
  it("leaves the message unspent when the failure is transient", async () => {
    const h = harness({ wordsSaved: 1 });
    h.api.sendMessage.mockRejectedValue(new Error("socket hang up"));

    await runTrialLifecycleSweep(h.api, h.services, NOW);

    expect(h.history).toHaveLength(0);
    expect(h.services.notificationRepository.disableNotifications).not.toHaveBeenCalled();
  });

  it("spends the message and retires the recipient when the failure is permanent", async () => {
    const h = harness({ wordsSaved: 1 });
    // A real GrammyError, because the classifier discriminates on the type as
    // well as the code — a look-alike object would pass this test and still be
    // retried forever in production.
    const description = "Forbidden: bot was blocked by the user";
    h.api.sendMessage.mockRejectedValue(
      new GrammyError(
        `Call to 'sendMessage' failed! (403: ${description})`,
        { ok: false, error_code: 403, description },
        "sendMessage",
        {},
      ),
    );

    await runTrialLifecycleSweep(h.api, h.services, NOW);

    expect(h.history).toEqual([{ userId: USER_ID, source: TRIAL_ENDING_SOURCE }]);
    expect(h.services.notificationRepository.disableNotifications).toHaveBeenCalledWith(USER_ID);
  });

  it("skips a user with no chat id rather than spending their message", async () => {
    const h = harness({ wordsSaved: 1 });
    h.services.userRepository.getTelegramIdById = vi.fn(async () => null);

    await runTrialLifecycleSweep(h.api, h.services, NOW);

    expect(h.api.sendMessage).not.toHaveBeenCalled();
    expect(h.history).toHaveLength(0);
  });
});
