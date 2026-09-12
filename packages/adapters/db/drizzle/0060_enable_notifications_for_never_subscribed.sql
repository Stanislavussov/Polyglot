-- Subscribe the users who were never asked.
--
-- Migration 0059 flipped `notification_enabled` to default true, but a column
-- default only reaches rows inserted after it. Everyone who registered before
-- that carries `false` — not because they declined, but because the toggle lives
-- three taps deep in Settings and onboarding never mentions it. On the
-- production database that is six of nine users, none of whom has ever received
-- a single notification.
--
-- `notification_history` is the only evidence of an actual decision this schema
-- keeps: there is no audit trail for the toggle itself. A user with delivered
-- notifications who now has them off turned them off on purpose, and this
-- migration must not undo that. A user with none never had them on in the first
-- place, so switching them on takes nothing away — and leaving is one tap, while
-- discovering a feature you were never shown is not.
--
-- `notification_times` is deliberately left as it is. Most of these rows hold
-- '08:00', which is the column default migration 0038 wrote and 0050 removed
-- rather than an hour anyone picked — but a user who *did* pick 08:00 back then
-- is indistinguishable from one who did not, and overriding a real preference is
-- the worse of the two mistakes. An empty list resolves to the product default
-- at send time (see `getUsersForWindow`), so those rows are already correct.
--
-- One-shot and not idempotent by intent: re-running it after someone opts out
-- would re-enable them. Drizzle records applied migrations in
-- `__drizzle_migrations`, so it runs exactly once per database.
UPDATE "user_language_settings" s
SET "notification_enabled" = true,
    "updated_at" = now()
WHERE s."notification_enabled" = false
  AND NOT EXISTS (
    SELECT 1 FROM "notification_history" h WHERE h."user_id" = s."user_id"
  );
