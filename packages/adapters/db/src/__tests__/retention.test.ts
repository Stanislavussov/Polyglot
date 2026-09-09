import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Capture the cutoff handed to every `lt(column, cutoff)` predicate ──────────
// Retention issues `delete(table).where(lt(table.ts, cutoff))` per telemetry
// table. Spying on `lt` lets us assert the pruning boundary directly (old rows
// fall below the cutoff, fresh rows do not) without a live database.

interface LtCall {
  column: unknown;
  cutoff: unknown;
}
let ltCalls: LtCall[] = [];

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    lt: (column: unknown, cutoff: unknown) => {
      ltCalls.push({ column, cutoff });
      return { __ltCutoff: cutoff };
    },
  };
});

// ── Mock DB: each delete().where().returning() yields a distinct row set ───────

let deleteInvocations = 0;
/** Rows "deleted" per delete call, in the fixed order retention issues them. */
let rowsPerDelete: unknown[][] = [];
/** Table objects handed to `delete()`, so tests can assert which tables are pruned at all. */
let deletedTables: unknown[] = [];

const mockDb = {
  delete: vi.fn((table: unknown) => {
    const idx = deleteInvocations++;
    deletedTables.push(table);
    return {
      where: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve(rowsPerDelete[idx] ?? [])),
      })),
    };
  }),
};

vi.mock("../connection.js", () => ({
  getDb: () => mockDb,
}));

const { runTelemetryRetention, DEFAULT_RETENTION_DAYS } = await import("../retention.js");
const { momentumEvents, userMomentum } = await import("../schema.js");

const MS_PER_DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  ltCalls = [];
  deleteInvocations = 0;
  rowsPerDelete = [];
  deletedTables = [];
  vi.clearAllMocks();
  mockDb.delete.mockImplementation((table: unknown) => {
    const idx = deleteInvocations++;
    deletedTables.push(table);
    return {
      where: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve(rowsPerDelete[idx] ?? [])),
      })),
    };
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("runTelemetryRetention", () => {
  it("prunes every telemetry table below a now-minus-horizon cutoff", async () => {
    const before = Date.now();
    await runTelemetryRetention(DEFAULT_RETENTION_DAYS);
    const after = Date.now();

    // One delete + one lt predicate per telemetry table (11 tables).
    expect(mockDb.delete).toHaveBeenCalledTimes(11);
    expect(ltCalls).toHaveLength(11);

    // Every timestamp cutoff is exactly `now - 90d`; the compact daily counter
    // uses the same instant rendered as a UTC "YYYY-MM-DD" day string.
    const expectedLo = before - DEFAULT_RETENTION_DAYS * MS_PER_DAY;
    const expectedHi = after - DEFAULT_RETENTION_DAYS * MS_PER_DAY;
    const expectedDay = new Date(expectedLo).toISOString().slice(0, 10);

    for (const { cutoff } of ltCalls) {
      if (cutoff instanceof Date) {
        expect(cutoff.getTime()).toBeGreaterThanOrEqual(expectedLo - 1000);
        expect(cutoff.getTime()).toBeLessThanOrEqual(expectedHi + 1000);
      } else {
        // The user_daily_request_counts `day` column is a date string.
        expect(cutoff).toBe(expectedDay);
      }
    }
  });

  it("keeps rows at the horizon boundary and prunes older ones", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-15T12:00:00.000Z"));

    await runTelemetryRetention(90);

    const cutoff = ltCalls.find((c) => c.cutoff instanceof Date)?.cutoff as Date;
    expect(cutoff).toBeInstanceOf(Date);

    const fresh = new Date("2025-06-15T11:00:00.000Z"); // 1h old — kept
    const stale = new Date("2025-03-01T12:00:00.000Z"); // >90d old — pruned
    // The DELETE removes rows strictly older than the cutoff.
    expect(fresh.getTime() < cutoff.getTime()).toBe(false);
    expect(stale.getTime() < cutoff.getTime()).toBe(true);
  });

  it("honours a custom shorter horizon", async () => {
    const before = Date.now();
    await runTelemetryRetention(7);
    const cutoff = ltCalls.find((c) => c.cutoff instanceof Date)?.cutoff as Date;
    expect(Math.abs(cutoff.getTime() - (before - 7 * MS_PER_DAY))).toBeLessThan(2000);
  });

  it("reports the number of rows deleted per table", async () => {
    // Fixed issue order in retention.ts:
    // [0] dictionary_lookup_logs [1] translation_requests [2] translation_request_timings
    // [3] ai_request_latencies [4] language_detection_events [5] notification_history
    // [6] word_review_log [7] momentum_events [8] bot_sessions [9] user_daily_request_counts [10] mentor_messages
    rowsPerDelete = [
      [{ id: 1 }, { id: 2 }], // dictionary_lookup_logs → 2
      [{ id: 3 }], // translation_requests → 1
      [], // translation_request_timings → 0
      [{ id: 4 }, { id: 5 }, { id: 6 }], // ai_request_latencies → 3
      [], // language_detection_events → 0
      [{ id: 7 }], // notification_history → 1
      [], // word_review_log → 0
      [{ id: 8 }, { id: 9 }], // momentum_events → 2
      [{ key: "a" }], // bot_sessions → 1
      [{ userId: 1 }, { userId: 2 }], // user_daily_request_counts → 2
      [{ id: 8 }], // mentor_messages → 1
    ];

    const result = await runTelemetryRetention();

    expect(result).toEqual({
      dictionary_lookup_logs: 2,
      translation_requests: 1,
      translation_request_timings: 0,
      ai_request_latencies: 3,
      language_detection_events: 0,
      notification_history: 1,
      word_review_log: 0,
      momentum_events: 2,
      bot_sessions: 1,
      user_daily_request_counts: 2,
      mentor_messages: 1,
    });
  });

  it("prunes momentum_events past the horizon and never touches the user_momentum snapshot", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-15T12:00:00.000Z"));

    await runTelemetryRetention(90);

    expect(deletedTables).toContain(momentumEvents);
    // The snapshot is the durable score: retention must leave even a long-stale row alone.
    expect(deletedTables).not.toContain(userMomentum);

    const momentumCutoff = ltCalls.find((c) => c.column === momentumEvents.occurredAt)?.cutoff as Date;
    expect(momentumCutoff).toBeInstanceOf(Date);

    const recentEvent = new Date("2025-06-01T12:00:00.000Z"); // 14d old — kept
    const staleEvent = new Date("2025-01-10T12:00:00.000Z"); // >90d old — pruned
    expect(recentEvent.getTime() < momentumCutoff.getTime()).toBe(false);
    expect(staleEvent.getTime() < momentumCutoff.getTime()).toBe(true);
  });
});
