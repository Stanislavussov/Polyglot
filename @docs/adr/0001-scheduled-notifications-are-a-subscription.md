# ADR 0001 — A scheduled notification is a subscription, not a nudge

**Status:** accepted · **Date:** 2026-08-13 · **Supersedes:** the quiet-gate design merged in `96bafe9`

> **If you are reading this because `notifications.defaultTime` appears to govern nobody: that is known,
> intended, and stated in the admin help text. The fix is the one-time in-bot prompt, not a bulk `UPDATE`.**
> The full argument is under *Alternatives considered → Conditional normalization*.

## Decision

Remove the `QUIET_DAYS` `NOT EXISTS` gate from `getUsersForWindow`, restoring scheduled notifications to an
explicit opt-in subscription that always fires while enabled.

Separately, wire `notifications.defaultTime` (new value 19:00) into the notification toggle and make
"unconfigured" a representable state (`notification_times` default `[]`), **without backfilling or normalizing
any existing row**, and honestly rescope the admin knob's stated cohort instead.

Prove both with e2e tests that assert a captured outbound Telegram `sendMessage` attributed to the test's own
chat.

## Drivers

- **D1 — the defect was total, not partial.** `notification_enabled` is `default(false)`, and the only writer
  that ever sets it `true` is the user's own `/settings` toggle. So every row the gated query could return
  belonged to someone who had explicitly opted in *and* explicitly picked their times in a 48-slot grid. A
  daily user always has a `translation_requests` row inside a 3-day window, so they received **zero**
  notifications — permanently, not late — while `/settings` kept rendering "Notifications: on, 08:00".
  The gate also made nobody newly reachable: the re-engagement audience is by definition people who did *not*
  opt in, and every notification query, including the 14-day sweep, leads with `notification_enabled = true`.
- **D2 — `['08:00']` is ambiguous by construction.** The database cannot distinguish "never opened settings"
  from "deliberately chose 08:00", and `notification_enabled` does not disambiguate it either (see (c) below).
  Every option for the default-time work is really a choice about how to handle that ambiguity.
- **D3 — the unit lane is structurally blind to both failures.** Both look like "nothing changed" from a
  mocked query builder; the gate shipped through a green suite of ~2650 tests. Verification has to be
  integration/e2e — *and correctly isolated*, or it does not count either.

## Alternatives considered

- **(A2) Split scheduled delivery from re-engagement now** — deferred. It needs product decisions this change
  cannot make: cadence, how someone who never consented opts out, how many nudges before stopping, new i18n
  across 11 locales, a new `notification_history.source`. Bundling it made the blocking fix un-shippable.
- **(A3) Apply the gate only to users who did not explicitly configure a time** — invalidated. Unrepresentable
  in the data (D2), and vacuous even if it were: since `notification_enabled = true` is *only* ever written by
  the explicit toggle, 100 % of the cohort is explicit, so the condition is a no-op wrapped in complexity.
- **(A4) The middle option — suppress only until the next scheduled notification**, comparing
  `notification_history.sent_at` against `translation_requests.created_at` (both already stored), so nobody is
  silenced permanently. **Two readings, both rejected:** *(i)* suppress if the user translated since our last
  send — degrades to permanent suppression for any daily user, i.e. the present defect with extra machinery;
  *(ii)* suppress at most one notification, then always send the following one — genuinely bounded, and the
  engagement-inversion objection does **not** land on it. Rejected regardless because it is an A2-class
  product redesign (new suppression semantics, a new claim in the UI about what "on" means, new history reads
  on the delivery hot path), not a defect correction — a ground that holds for both readings. Secondarily:
  applying engagement targeting to *content the user scheduled for themselves* is a category error.
- **(B2) Change the constants only** — leaves `defaultTime` dead, failing half the requirement.
- **(B3) Read `defaultTime` at toggle-on but keep the `['08:00']` column default** — invalidated. Without `[]`
  there is no way to tell "unconfigured" from "chose 08:00", so toggle-on would overwrite a deliberate 08:00.
  That is the gate's own failure mode in a new place.
- **(B4) Add a `notification_times_configured_at` column** — rejected *with* argument, not by restatement. A
  new column can only be populated honestly for writes that happen after it exists. For every pre-existing row
  it is `NULL`, and `NULL` is exactly as ambiguous as `['08:00']` is today — so it buys **no** disambiguation
  for the population that matters, at the price of a wider migration, a second source of truth about
  configuredness, and a nullable column every read site must handle. It would have been the right design
  before the population existed; it is not a retrofit.
- **(Backfill) Rewrite `['08:00']` rows to 19:00** — rejected. From the user's side it is indistinguishable
  from the bug being fixed.
- **(Conditional normalization) Set `notification_times = []` where `notification_enabled = false`, via the
  seed path** — **rejected on three independently sufficient grounds:**
  1. **The mechanism is neither one-time nor a seed.** `apps/admin-api/src/seed.ts` runs on **every push to
     master** (`deploy.yml`) and on every integration run. The normalization would be a recurring conditional
     bulk `UPDATE` of a user-owned column, executed forever, catching rows created long after it landed. It is
     also not an upsert of reference data: `seed.ts` upserts plans, feature access and AI models, and contains
     zero references to user preference columns. `CLAUDE.md`'s Drizzle-seed exception covers reference rows,
     not mutation of user preferences.
  2. **The stored times of a disabled user ARE read.** The picker pre-checks stored slots in the 48-slot grid
     and the sub-menu renders them. A user who switched notifications off for a holiday holding 08:00 would
     reopen a wiped grid and, on re-enable, be silently moved to 19:00.
  3. **The cohort is misdefined.** `notification_enabled = false` is not "never subscribed". It also holds
     everyone who unsubscribed via the toggle and everyone the *server* unsubscribed through
     `disableNotifications` — the 14-day auto-pause and the 403-blocked path. And `WHERE notification_times =
     '{08:00}'` re-commits D2 in the other direction: it still cannot tell a disabled user who *chose* 08:00
     from one who never touched it. This design refuses to guess; the normalization guesses, merely with the
     opposite sign.

## Why chosen

It is the smallest change that makes shipped behaviour match what the UI promises; it keeps every genuinely
good part of `96bafe9` (the layered word picker, the no-repeat rules, the preset cache-then-JIT source, the
whole observability layer); it resolves an ambiguity by declining to guess rather than by guessing in the
opposite direction; it tells the truth about the knob's reach instead of manufacturing reach; and it leaves
the real re-engagement product decision open instead of pre-empting it with an accident.

## Consequences

- **Scheduled notifications resume for all opted-in users, including daily users — by design.** On the first
  tick after deploy this is a visible production event. It is not "everyone at once": each user is mailed only
  in the 30-minute window matching their own slot in their own timezone, so it spreads across 24 hours — but
  it concentrates at each timezone's 08:00, because that is the historic column default and the population
  predates any other choice. **There is no runtime kill switch**; if the 403 rate says stop, the only lever is
  to revert and redeploy.
- **One cohort is silently excluded from that "resumption", and it is worth counting before deploy:** users
  with `notification_enabled = true` **and** `notification_times = '{}'`, reachable through the deselect-all
  hole this change closes. They asked for notifications and will still receive none, because
  `getUsersForWindow` filters empty lists. The new guard prevents the cohort growing; it does not repair
  existing members. Identify them and address them with the one-time prompt — do not bulk `UPDATE` them.
- Re-engagement of non-subscribers remains unbuilt and unreachable — unchanged from before the merge, now
  documented explicitly rather than implicitly claimed.
- New users default to 19:00; existing users keep their current time, so the population is split until a
  prompt is built, and the admin panel says so — including that changing the value moves nobody and has **no
  observable effect at all until the next user opts in**.
- Changing `settings.service.ts`'s fallback also changes **what the admin form pre-fills on a fresh database**,
  because the admin-api notifications route returns `FALLBACK_NOTIFICATIONS` when the `system_settings` row is
  absent. Intended, but it is a second user-visible effect of a one-line constant change.
- One migration (`ALTER COLUMN … SET DEFAULT '{}'`), no data change. `SchedulerDeps` gains one optional
  injected-clock field, and `buildNotificationScheduling` gains one optional AI override so a test can close
  both just-in-time paths at a single seam.
- **The time picker now refuses to deselect a user's last remaining slot** rather than auto-disabling
  notifications. The auto-disable shape was considered and rejected: it parks the user at
  `enabled = false, times = []`, which is exactly the state the new toggle-on seeding fills with the admin
  default — so it would have re-created the very "messaged at a time I never picked" failure the guard exists
  to prevent, and it revokes an explicit opt-in unasked and unexplained. Costs one new i18n key,
  `settingsNotifTimesMin`, in all 11 locales; nothing was reusable (`settingsNotifTimesMax` is maximum copy).
- The seeding rule is complete **only because the `/settings` toggle is the single path that enables
  notifications**. `userRepository.updateNotificationPrefs` has zero production callers today and is invisible
  to knip (`"exports": "off"`); wiring it up without carrying the seeding rule would create enabled users with
  `[]` times, permanently ineligible — the same "the UI says on and nothing arrives" symptom by another route.
  The architecture contract now says so.

## Pre-deploy checklist

Three read-only queries, run against **production** before this ships. All are cheap; none writes. They were
each answered on the dev database (7 rows) during implementation, which is not the same as answering them.

1. **Expected magnitude `E`.** `sent > 0` is not an acceptance criterion — it is satisfied by one user, and
   D3's whole premise is that the unit lane is blind here. Compute `E` = (rows below) × the mean number of
   entries in `notification_times`, and put it in the PR body. Day-1 `sent` should land in roughly
   **0.7·E to 1.0·E** — below `E` because of 403-blocked chats and unparseable timezones, never above it. **A
   day-1 total under ~0.5·E means A1 did not work at the expected scale** and a second filter is still
   excluding people; investigate rather than accept "notifications resumed". *(Dev: 2 users, mean 2 slots.)*

   ```sql
   SELECT count(*) FROM user_language_settings
   WHERE notification_enabled = true AND is_active = true
     AND (last_interaction_at IS NULL OR last_interaction_at >= now() - interval '14 days');
   ```

2. **The stranded cohort** — enabled, but with an empty schedule, so permanently ineligible. These users asked
   for notifications and will still receive none; they are the one group for whom "notifications resumed" is
   false, and they will not appear in the day-1 `sent` total or reduce `E`. If non-zero, they belong on
   follow-up 5's list. *(Dev: 0.)*

   ```sql
   SELECT count(*) FROM user_language_settings
   WHERE notification_enabled = true AND notification_times = '{}';
   ```

3. **Malformed stored times.** A row holding an unparseable entry moves from the 08:00 window to 19:00 with no
   write, because `DEFAULT_NOTIFICATION_TIME` is also the parse fallback. This is the only case where the
   CHANGELOG's *"changing this value does not move anyone"* is not literally true. If it returns 0, that claim
   is unconditional. *(Dev: 0 — expected, since every writer goes through `formatNotificationTime`.)*

   ```sql
   SELECT count(*) FROM user_language_settings, unnest(notification_times) AS t
   WHERE t !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$';
   ```

Also capture, before deploying, the `(user_id, notification_times, updated_at)` snapshot that distinguishes
"seeded by us" from "chosen by them" — it is the only artifact that makes the Step 3 data rollback possible,
and it cannot be reconstructed afterwards.

## Follow-ups

1. Spec and build A2 — re-engagement with its own audience, cadence, copy, frequency cap and opt-out.
2. Decide whether to offer existing 08:00 subscribers a one-time move-to-19:00 prompt — the only non-guessing
   route to the ambiguous population.
3. Wire or delete the remaining dead knobs: `defaultType`, `inactivityDays`, `notificationTimesLimit`.
4. Reconsider whether `processInactiveUsers` (the 14-day auto-pause) belongs to the subscription job at all —
   it is the one path that revokes an explicit opt-in without being asked.
5. **Repair the pre-existing `enabled = true, times = '{}'` cohort.** Removing the gate fixes the large route to
   "the UI says on and nothing arrives"; this is a second, smaller route to the same symptom, and it predates
   this change. The new guard stops the cohort growing but repairs nobody already in it. Count it in production
   (`SELECT count(*) FROM user_language_settings WHERE notification_enabled = true AND notification_times = '{}'`
   — it is 0 on the dev database), then address it with the one-time prompt of follow-up 2. **Do not bulk
   `UPDATE` it.**
6. Remove the remaining untyped `any` in `notification-settings.test.ts` (the `(b: any)` keyboard-button
   parameters). The `as any` casts are gone; `DEFAULT_SETTINGS` is now typed against `UserLanguageSettings`.
   Consider turning on Biome's `noExplicitAny`, which is currently `"off"` (`biome.jsonc`) — CLAUDE.md Hard
   Rule 2 forbids `any`, but nothing enforces it, which is exactly how five new casts slipped into this change
   and were caught only in review. Repo-wide, so it is its own task.
7. Give the notification sub-menu an explicit "no times configured" state.
8. Add a global notifications kill switch.
