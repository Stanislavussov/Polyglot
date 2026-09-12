/**
 * Migration 0060 — subscribing the users who were never asked.
 *
 * A data migration is the one kind that a green migration chain proves nothing
 * about: the integration lane replays it against an empty database, where an
 * `UPDATE` that matches the wrong rows and one that matches the right rows are
 * indistinguishable. Getting this wrong is not a crash either — it silently
 * mails people who had deliberately opted out, which is the single worst outcome
 * this whole feature can produce.
 *
 * So this file executes **the shipped `.sql` file itself**, read from disk rather
 * than restated here: a copy of the statement would drift from the migration the
 * moment either is edited, and would then prove only that the copy is correct.
 *
 * Everything runs inside a transaction that is always rolled back. The migration
 * is deliberately unscoped — it sweeps every row in the table — so letting it
 * commit here would re-enable notifications for users seeded by other files in
 * the shared database, in the middle of their own assertions.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getDb } from "../connection.js";
import { uniqueTelegramId } from "../test-helpers/integration/id-factory.js";

const MIGRATION_SQL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../drizzle/0060_enable_notifications_for_never_subscribed.sql"),
  "utf8",
);

interface SeedSpec {
  notificationEnabled: boolean;
  /** Seed a delivered notification — the only evidence of a real decision the schema keeps. */
  withHistory: boolean;
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["$client"]["begin"]>[0]>[0];

async function seed(sql: Tx, spec: SeedSpec): Promise<number> {
  const [user] = await sql<Array<{ id: number }>>`
    insert into users (telegram_id, onboarded, onboarding_step, is_active)
    values (${uniqueTelegramId()}, true, 4, true)
    returning id`;
  const userId = user!.id;

  await sql`
    insert into user_language_settings (user_id, interface_lang, native_lang, learning_langs, notification_enabled)
    values (${userId}, 'ru', 'ru', ${sql.array(["de"])}, ${spec.notificationEnabled})`;

  if (spec.withHistory) {
    await sql`insert into notification_history (user_id, original, source) values (${userId}, 'Haus', 'preset')`;
  }
  return userId;
}

async function isEnabled(sql: Tx, userId: number): Promise<boolean> {
  const rows = await sql<Array<{ notification_enabled: boolean }>>`
    select notification_enabled from user_language_settings where user_id = ${userId}`;
  return rows[0]!.notification_enabled;
}

/**
 * Seed, apply the shipped migration, read the outcome back — then roll everything
 * back, including the migration's effect on rows this test did not create.
 */
async function applyMigrationTo(specs: Record<string, SeedSpec>): Promise<Record<string, boolean>> {
  const rolledBack = new Error("intentional rollback");
  const outcome: Record<string, boolean> = {};

  try {
    await getDb().$client.begin(async (sql) => {
      const ids: Record<string, number> = {};
      for (const [name, spec] of Object.entries(specs)) {
        ids[name] = await seed(sql, spec);
      }

      await sql.unsafe(MIGRATION_SQL);

      for (const [name, id] of Object.entries(ids)) {
        outcome[name] = await isEnabled(sql, id);
      }
      throw rolledBack;
    });
  } catch (err) {
    if (err !== rolledBack) throw err;
  }

  return outcome;
}

describe("migration 0060 — backfill notification opt-in (integration)", () => {
  it("subscribes a user who was never asked, and leaves an opt-out alone", async () => {
    const outcome = await applyMigrationTo({
      // Registered before notifications defaulted to on: switched off, and never
      // received one. Nothing was ever taken from them, so nothing is overridden.
      neverAsked: { notificationEnabled: false, withHistory: false },
      // Received notifications and then turned them off — an actual decision, and
      // the row this migration exists to *not* touch.
      optedOut: { notificationEnabled: false, withHistory: true },
      // Already subscribed: the statement must be a no-op rather than churn
      // `updated_at` on rows it has no business rewriting.
      alreadyOn: { notificationEnabled: true, withHistory: true },
    });

    expect(outcome).toEqual({ neverAsked: true, optedOut: false, alreadyOn: true });
  });

  it("does not re-subscribe someone who opts out after their first card", async () => {
    // The lifelike ordering of the case above: a backfilled user receives a card,
    // decides against it, and switches off. Re-running the statement must not
    // reverse that — which is also why it is a one-shot migration rather than a
    // recurring job.
    const outcome = await applyMigrationTo({
      churned: { notificationEnabled: false, withHistory: true },
    });

    expect(outcome.churned).toBe(false);
  });
});
