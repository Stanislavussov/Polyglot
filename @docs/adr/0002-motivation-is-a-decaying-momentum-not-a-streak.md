# ADR 0002 — Motivation is measured by a decaying momentum, not by a streak

**Status:** accepted · **Date:** 2026-08-25 · **Implements:** Task 81 (`.omc/plans/motivation-and-momentum-scoring.md`)

> **If you are reading this because the motivation surfaces are invisible in production: that is intended.**
> Recording is on from day one; every *visible* surface ships behind its own switch, off, until 28 days of
> recorded distribution exist to calibrate the band thresholds against. The switches are in the admin panel,
> under Settings → Motivation.

## Decision

Build the motivation layer on a **continuously decaying index of effort** — half-life 7 days, daily caps
applied as weight rather than as a refused insert — kept as a durable per-user snapshot plus a 90-day
idempotency journal on deterministic keys.

Show the user a **band phrasing** and counters in the form "Label: N", and **never the raw number**. Pay for
every praise with a countable fact from the database, with a 24-hour cooldown and a cap of two per week.

Keep the surfaces pull-first: `/progress` (entered from a button at the end of an SRS or flashcard session),
a praise line and a recovery line appended to a translation card. The outbound channel gains **one line inside
an already-subscribed notification** and nothing else.

**Streaks, XP, levels and leaderboards are not introduced — in any form, including hidden or pull-only.**

## Drivers

- **D1 — the outbound channel to lapsed users is not built.** `getUsersForWindow` and `getInactiveUsers` both
  lead with `notification_enabled = true`, and the only writer of that flag is the user's own `/settings`
  toggle. Reaching someone who drifted away is not "technically impossible by construction" — it is
  *unbuilt, and deliberately deferred by ADR 0001, follow-up 1*, together with its cadence, opt-out and
  frequency cap. So a motivation layer that needs a push cannot ship here; it has to be pull-first.
- **D2 — every source a score could be derived from is deleted at 90 days.** `runTelemetryRetention` prunes
  `word_review_log`, `translation_requests`, `user_daily_request_counts` and `notification_history` on a
  `DEFAULT_RETENTION_DAYS = 90` horizon. A purely derived score would silently reset for a user with a longer
  history. Hence a durable snapshot alongside the pruned journal.
- **D3 — the calendar day costs something, and today it is almost always UTC anyway.**
  `user_language_settings.timezone` defaults to `'UTC'` and its only writer is a manual picker buried under the
  notifications sub-menu; onboarding never writes it. So for most rows "local day" *is* the UTC day. Continuous
  decay removes the calendar boundary from the core of the model; it survives in exactly one place — the daily
  caps — where it is a known, measured simplification rather than a hidden assumption.

## Alternatives considered

- **(A) Streak + XP + levels.** Understood by everyone without explanation, proven at scale, and — stated
  plainly — **buildable with the same tools and an order of magnitude cheaper**: a streak's local day comes
  from the same code as the daily caps, so it carries no separate technical difficulty, and it needs one
  counter column and one date column instead of a journal, a snapshot, a service and a calibration period. It
  also needs no calibration at all, having no thresholds to guess. **Rejected by the owner on exactly one
  ground: loss mechanics are forbidden.** A streak breaks, and for the target persona (an emigrant aged 28–40,
  four or five years in the country, plateaued at A2/B1) a break reads as "you failed", and "it is broken
  anyway" reads as permission to leave. Two grounds asserted in earlier drafts are withdrawn as false: "it
  cannot run without a push" does not distinguish A from B (B's surfaces are pull-first too), and "it is
  incorrect across timezones" is refuted by this plan's own local-day handling.
- **(C) Mastery narrative only, no scoring.** The cheapest and most honest option (~40 % of B): impossible to
  farm, impossible to offend with, zero new tables. Rejected on two counts: a new user has no matured words
  for a month, so the layer is empty precisely when churn risk peaks; and it yields no countable frequency
  metric, so AD/28 cannot be measured before and after with one instrument.
- **(D) A self-assigned weekly goal** ("three days a week"). Better suited to an adult than a game — the bar is
  the user's own, so there is no external demand and no guilt — and it addresses frequency directly.
  **Not invalidated, deferred.** It needs a new setting, a picker screen, an onboarding question and a much
  larger i18n footprint: a feature, not a layer. B already counts active days as a by-product, so D lands on
  top later without rework. Follow-up 1.

## Why chosen

**B was not chosen because A is unworkable — it was chosen because the owner forbade loss mechanics. That is a
product decision, not a technical conclusion, and this record does not dress it up as one.** What B genuinely
adds beyond honouring the ban: a mechanic with nothing to lose (forgiveness is a property of the decay curve,
not a separate "streak freeze" subsystem); a countable AD/28 measurable with one instrument before and after;
and the project's first computable definition of "lapsed", which is the entry point to the re-engagement work
ADR 0001 deferred. What B does **not** give is a mechanism for bringing anyone back — that remains "one
concrete next step on every screen" ("Review 6 words"), and it needs no scoring whatsoever. C survives inside B
as the content of the praise; D layers on later.

## Consequences

- Two new schema objects (migration `0057`): `momentum_events` and `user_momentum`. `momentum_events` is
  pruned by `runTelemetryRetention`; `user_momentum` is **deliberately excluded** from it, which is the whole
  reason the snapshot exists.
- +23 i18n keys × 11 locales = 253 strings, 9 of them machine-translated. That is why all counting copy is
  restricted to the form "Label: N": the i18n module has **no pluralization at all** (no `Intl.PluralRules`, no
  `_one/_few/_many`), which is why the existing `srsDone` prints "1 карточек". The form sidesteps the gap
  rather than closing it, and a structural test holds the line.
- `SettingsPort` grows one method (`getMotivationConfig`), with a matching admin-api route and admin-panel tab.
- The "matured" threshold, `srsInterval >= 21`, is pinned to the SM-2 ladder in `modules/srs/sm2.ts`
  (1 → 6 → 15 → 38; crossed on the fourth review, 22 calendar days in). A guard test makes the link mechanical
  instead of a comment.
- **No visible surface ships until 28 days of blind recording have accumulated.** That is the price of not
  inventing the thresholds. If the distribution turns out degenerate, the honest outcome is to stop after
  recording, ship nothing, and keep the data for AD/28.
- Momentum reflects at most the last 90 days; a user who has been learning for a year sees a quarter's worth.
- The kill switch exists from day one — **four independent flags**, of which `recordingEnabled` defaults to on
  and the three rendering flags default to off. It does **not** close ADR 0001 follow-up 8: `motivation.*`
  silences this layer's lines only; the project still has no global notifications kill switch, and this task
  does not add one.
- `/progress` occupies no slot in the Telegram command menu, and is therefore invisible to anyone who never
  finishes an SRS or flashcard session. Deliberate, and revisited against the open-rate data.
- The weekly line inside a notification is the **only** change to the outbound stream: no new schedule, no new
  cron, no new audience. It is journalled as its own `weekly_proof` event kind rather than as another `praise`
  token, because the praise cap counts `praise` rows and would otherwise spend one of the card's two weekly
  praise slots on every subscriber, every week.
- Momentum is credited **only inside the bot process**. `apps/admin-api` and the scheduler package reach the
  repositories directly and never see the container's wrappers, so an admin acting on a user's behalf credits
  nothing. That is correct — momentum measures the user, not the operator — and is written down here so that
  nobody "fixes" it later.

## Follow-ups

1. Option D — a self-assigned weekly goal on top of the active-day counter that already exists.
2. Widen the entry to `/progress` if the open counter shows demand (< 30 opens in a month means the entry is
   too narrow).
3. Revisit the band thresholds 12 weeks after the surfaces are switched on, against the then-current
   distribution.
4. Connect the `resting` band to the re-engagement work of ADR 0001 follow-up 1.
5. Extend `packages/@types/temporal.d.ts` to `PlainDate` if "local day" is ever needed somewhere else.
6. Migrate `renderTranslation` onto `assembleCard` so the `footer` slot stops being declared-and-barely-used.
   **Not blocking:** the praise line is appended in `translate-flow.ts`; the slot is needed only for the
   notification's weekly line.
7. Decide whether to write the timezone at onboarding. The dev-database measurement taken before Slice 1 put
   `timezone = 'UTC'` at **71 %** of rows, which is what makes D3's simplification acceptable *for now* and
   what makes this follow-up worth doing rather than assuming.
