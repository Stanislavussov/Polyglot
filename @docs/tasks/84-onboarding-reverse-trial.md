# Task 84 — Onboarding reverse trial (a week of Plus, then a survivable free tier)

Status: **implemented** (2026-09-12) · Date: 2026-09-12
Builds on: Task 72 (stateless onboarding) · Task 79 (`@docs/tasks/79-paid-features-presentation-layer.md`) · Task 81 (momentum journal)

## 1. The question this answers

The original proposal was "give a new user every feature free for their first day". The instinct behind it is right — a user who has never felt what the product does cannot want it — but all three parameters were wrong, and the third one is the whole task.

**Length.** One day is below the floor where a trial does anything. RevenueCat's 2026 cohort data puts trials of four days or less at 25.5 % trial-to-paid against 42.5 % for 17–32 days, and 64 % of seven-day trials are abandoned inside the first 24 hours. A language habit does not exist on day one: the user has no saved words, no reviews coming back, nothing to lose. Loss aversion needs something to grab onto.

**Tier.** "Every feature" hands out the two most expensive calls on the platform (TTS, mentor) to a cohort that has not yet shown it will return, and leaves nothing above the tier the user was just given — there is no upsell left after Pro. Worse, it teaches the user that pronunciation and voice input are part of the product, then takes them away.

**The ending.** This is where resentment actually comes from, and the research is blunt about it: confusing endowment with lock-in earns resentment rather than loyalty. The felt injury is not "the trial ended", it is "the product stopped being usable". Before this task the free tier was 10 translations a month and *no* card features at all — not a smaller product, a landing page. Any trial expiring onto that floor converts into churn no matter how the message is worded.

So: a **seven-day Plus** reverse trial, announced honestly at the start, warned about before it ends, earnable by use, landing on a free tier that still works.

Sources consulted: [RevenueCat on trial length](https://www.revenuecat.com/blog/growth/7-day-trial-subscription-app), [Poyar/ChartMogul 2026 free-to-paid report](https://www.growthunhinged.com/p/free-to-paid-conversion-report) (reverse trials: 4–6 % good, 8–12 % great — *not* statistically better than plain freemium, so the effect is entirely in the execution), [Inflection on reverse trials](https://www.inflection.io/post/complete-guide-to-reverse-trials), [The Good on trial strategies and resentment](https://thegood.com/insights/saas-trial-strategies/), [endowment effect](https://www.getmonetizely.com/articles/how-does-the-endowment-effect-make-free-trials-so-powerful), [loss-framed paywall copy (+21 %)](https://anapintar.com/3-behavioral-science-principles-to-run-your-next-product-experiments/), [Duolingo's 3/7-day Super trial and streak-milestone Super gifts](https://www.revenuecat.com/blog/growth/cem-kansu-duolingo-sub-club-podcast-2026).

## 2. Product spec

| | during the trial | after it |
|---|---|---|
| Plan pointer | `plus` | `free` |
| Length | 7 days from onboarding completion, +3 days once if ≥ 10 words saved | — |
| Translations | unlimited | 30 / month |
| Grammar breakdown | ✅ | ✅ (new — was locked) |
| Other meanings / clarify | ✅ | 🔒 |
| Mentor | ✅ (Plus daily cap) | 🔒 |
| YouTube video | ✅ | 🔒 (the one onboarding video stays) |
| Pronunciation / voice input | 🔒 (Pro only, never granted) | 🔒 |

Pro is deliberately never trialled: a user cannot resent losing what they never had, and Pro keeps something left to sell to a converted Plus subscriber.

### 2.1 The four messages

1. **Grant**, on the closing onboarding screen, once: names the tier, the seven days, what stays free afterwards, and the earn-more rule. Announced only when a trial was actually granted.
2. **Warn**, one to two days before the end: names what switches off, states the **date** the trial ends, and repeats the earn-more offer while it is still open (`canEarn`). The decision window is 48 h, not 24, because the sweep runs once a day: at 24 h a trial ending just before the sweep hour would be reached with minutes left — too late to act on the warning and too late to earn the extension, which falls due in the same window. With a daily sweep and a 48 h window, the first sweep that sees a trial is always 24–48 h from its end, so the warning is never late. The copy names a date rather than a count of hours for two reasons: that 24-hour spread makes any fixed number wrong for most users, and a *variable* number breaks noun agreement in ru/uk/pl/cs, where the old fixed "24" happened to be grammatical. A user warned *before* earning the extension is warned again before the new end, under a second history source.
3. **Extend**, once, when ≥ 10 words were saved during the trial: +3 days, "nothing switches off yet".
4. **Close**, on expiry: leads with what stays free, states what switched off, and reports the week's saved-word count (omitted when it is zero — "you saved 0 words" is the one sentence that could only discourage).

Each is one-off per account, recorded in `notification_history` under `trial_ending` / `trial_ending_final` / `trial_extended` / `trial_ended` — the same "the row means the message is spent" discipline as the D+1 activation nudge, including its permanent/transient delivery-failure split.

Those rows answer one question only: *was this message sent*. Whether the extension was **granted** is read off the ledger (`hasBeenExtended`: the row carries more than `TRIAL_DAYS`). The distinction is load-bearing — while "already extended" came from the congratulation's history row, a transiently failed send left the grant looking unspent and the next sweep added another three days, and the next, without bound.

A row also has to still speak for the user before anything is sent: `activate` supersedes a trial the moment the user *buys*, and telling a paying convert that their Plus is over would aim the worst message in the product at the one cohort the whole feature exists to produce.

## 3. Implementation

Nothing new was invented: the trial is a row in the existing `subscriptions` ledger with `provider = "trial"`, so `resolveEntitlements` needed no change at all — the plan pointer does the work.

- `packages/core/src/modules/subscriptions/trial.ts` — the constants, `grantOnboardingTrial` (idempotent per account), and `decideTrialAction` (the pure warn/extend/end/skip decision table).
- `packages/core/src/modules/subscriptions/index.ts` — `processRenewals` now short-circuits `provider === "trial"` and `endTrial` closes one row on demand.
- `apps/bot/src/onboarding/onboarding-screens.ts` — grants at completion, swallowing every failure: the gift may never cost a user their onboarding.
- `apps/bot/src/subscriptions/trial-lifecycle.wiring.ts` — the daily 10:20 UTC sweep that warns, extends and closes.
- `apps/admin-api/src/plan-catalog.ts` + `packages/core/src/modules/entitlements/index.ts` — the new free tier, in lockstep (a drift test holds them together).
- `apps/bot/src/scenes/helpers/card-actions.ts` — the grammar breakdown is now metered against the daily credit budget, because free plans hold it from here on. `ensureAiQuota` gained the internal-role bypass it was missing, which that new call site made visible.

### 3.1 Two cliffs the trial itself would have created

Both are consequences of granting an unmetered week, and both were found by walking the day-8 user through the product rather than by a test:

1. **The monthly translation window.** Trial translations land in the same ledger the free plan is billed against, so a heavy trial week would have exhausted the free month before it began. `resolveMeteredWindowStart` rebases the metered month on the trial's end; the daily credit meter is left alone, where the same overlap costs at most the remainder of one day.

   The same ledger produced a second, subtler one: giving free the grammar breakdown put `[grammar]` rows into the sum the monthly *translation* allowance is billed from, so thirty card taps would have eaten thirty translations. `NON_TRANSLATION_LEDGER_TAGS` excludes exactly those rows — a deny-list, not "everything in brackets", because a dictionary translation and a word pick are still billed monthly as they always were, and widening it would have quietly lifted their ceiling from 30/month to 30/day. A drift test in `apps/bot/src/utils/ai-quota.test.ts` forces the next `AiCallType` to make that decision explicitly.
2. **The one free lifetime video.** The curated starter videos are the empty state of Videos mode, reachable long after onboarding, and their run was charged to the once-per-account giveaway. During a Plus trial the plan already covers the video, so the giveaway is now spent only when the plan has no video allowance at all — otherwise the trial would quietly empty the screen the user meets the week it expires.

### 3.2 Two bugs this would have shipped on top of

Both were live before this task and would have silently broken the feature:

1. **`mockPaymentAdapter.verifyRenewal` answers `paid: true` to everything.** A trial row reaching the nightly renewal sweep would have been *renewed* — a free Plus subscription for life. Fixed by never asking a provider about a trial.
2. **`refuseAsDowngrade` compares the current plan's list price.** A trialling user sits on `plus` (500¢), so the plan comparison hid Plus and a tap on it was refused as a downgrade — the product would have refused the exact purchase the trial exists to produce. Fixed by pricing a trial-held plan at 0 in both places that ask "what has this user paid for".

## 4. Rollout

`bootstrapPlanCatalog` is bootstrap-only, so the new free tier reaches **fresh databases only**. Existing environments (prod, dev) need the same two edits on the admin **Rate Limits** page:

- free `translationLimit`: 10 → 30
- ~~free "Unlocks": tick **grammarBreakdown**~~ — void: the grammar breakdown was removed from
  the card, so the key unlocks nothing. Free has no card feature until one is chosen to replace it.

Until then a production free user keeps the old floor and the trial still expires onto it.

## 5. Deliberately not done

- **Per-feature weekly allowances on free** (e.g. 3 clarifications and 1 mentor thread a week). This is the softest possible landing and it was in the original plan, but the plan schema meters exactly two things — a monthly translation count and a daily credit budget — so a weekly per-feature allowance needs a new usage counter (table, repository, gate and admin fields). That is its own task; the free tier shipped here is survivable without it.
- **A discount at expiry.** Deliberate: it trains users to wait for the offer, and there is no conversion baseline yet to measure it against.
- **Transactional paired writes.** `grantOnboardingTrial` (row, then plan pointer) and `expireAndDowngrade` (status, then pointer) each write through two repositories, and the port layer has no cross-repository transaction. The row-first order is the safe one — the reverse could leave a user holding Plus with nothing to expire it — and a failed pointer write now retires its own row (`canceled`), which keeps the gift spent while making both sweeps skip it forever.

  Two residuals, both narrower than what they replace, both deliberate:

  - A hard process kill between the two statements. The user loses the gift, and the sweep's pointer check keeps that silent rather than mailing them about a week they never had.
  - A pointer write that **commits and then throws** — a dropped connection or a client timeout after the server committed. The compensation then cancels a row whose pointer did take, leaving `subscription_plan = 'plus'` with no active row: Plus indefinitely, and `currentPlanPrice` falls back to the list price, so the upgrade screen hides Plus and refuses a tap on it. Rarer than the any-failure case the compensation replaces, and the alternative outcome (loudly telling a never-trialled user their Plus is over) is the more common one. Guarding it properly means re-reading the pointer before retiring the row, which widens `SubscriptionUserUpdater` — a deliberately narrow port — for a tail case.

  Fixing either properly means a unit of work in the ports, which is its own task.
- **An index on `subscriptions(provider, current_period_end)`.** The daily sweep scans the table once a day; with a few thousand trial rows that is nothing, and a migration is worth adding when it stops being nothing.
- **The demo card's stale ⭐ badges.** The payoff card is rendered just before the grant, so its badges say "locked" for the few seconds until the next card. The tap-time gate is authoritative, so the buttons work; only the cosmetic badge lies, and Telegram's 48-hour edit rule means re-rendering old keyboards is not a path worth taking (see `paid-feature.helper.ts`).

## 6. How to judge it

Not conversion alone — at this traffic it is noise. Watch, by cohort: D7/D30 retention, words saved in week one, the share of users who hit a gate *after* the trial (that is "felt the loss"), and AI cost per trialling user. `bot_notifications_total{status="trial_*"}` covers the delivery side; `bot_onboarding_step_total` already covers the funnel above it.
