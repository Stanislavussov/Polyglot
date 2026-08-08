# Task 72 — Repair the Observability Safety Net (autoheal, alerts, dead metrics)

**Status:** 🔲 To Do
**Category:** Infrastructure / Reliability
**Priority:** 🔴 Critical
**Created:** 2026-08-04
**Source:** [Weekly Grafana Report 2026-08-04](../reports/weekly-grafana/2026-08-04.md)
**Related:** Task 55 (Health Check & Basic Observability)

---

## Incident

A three-day Grafana review (2026-08-01 → 2026-08-04) found that **every layer of the
safety net is broken at the same time**, while the product itself is healthy. Three
real user-facing translation failures produced **zero** alerts; meanwhile 17 false
criticals were pushed to Telegram.

| Layer | Expected | Actual |
|---|---|---|
| `polyglot_autoheal` | restarts a hung bot | **crash-looping every 60 s for 3 days** (4 305 restarts) — never ran once |
| `Bot restart loop detected` | fires on crash loop | `NoData` since 2026-07-12 — queries a label that does not exist |
| `AI model circuit breaker open` | fires when a provider is fast-failed | metric `bot_ai_circuit_state` does not exist; `or vector(0)` masks it |
| `Elevated translation error rate` | fires on AI outage | threshold unreachable at current traffic — 3 real failures, 0 alerts |
| `No Telegram updates for 10m` | detects stuck long-polling | **17 firings + 16 pendings in 3 days, all false** — the only rule reaching Telegram |
| cAdvisor | per-container CPU/mem | exports only systemd slices; no container metrics at all |
| `Polyglot Bot` dashboard | shows AI/notification/mentor traffic | 4 panels query non-existent metrics → permanently empty |

---

## Root Causes

### 1. autoheal — wrong image contents

`deploy/docker-compose.yml:160` pins `willfarrell/autoheal:1.2.0`. The container exits
immediately:

```
/docker-entrypoint: exec: line 104: autoheal: not found
```

The entrypoint execs `autoheal`, which is not on `PATH` in that tag/arch. `restart:
unless-stopped` turns this into a 60-second restart loop that also produces 4 305 log
lines per 3 days.

### 2. Alert rules reference metrics/labels that were never emitted

```
polyglot_bot_restart_loop → changes(container_start_time_seconds{name="polyglot_bot"}[15m])
polyglot_bot_circuit_open → max(bot_ai_circuit_state) or vector(0)
polyglot_bot_translation_errors → sum(rate(bot_translations_total{status="error"}[5m])) > 0.05
```

- cAdvisor emits `container_start_time_seconds` with labels `id`, `instance`, `job` only —
  no `name`. With `no_data_state: OK` the rule is silent forever.
- `bot_ai_circuit_state` is not in the registry. `or vector(0)` converts "metric missing"
  into a healthy 0, so the rule cannot distinguish "breaker closed" from "no telemetry".
- `0.05 errors/s` = 3 errors per minute. Observed peak: 3 errors per **3 days**.

### 3. `No Telegram updates for 10m` encodes "idle" as "incident"

`sum(increase(bot_telegram_messages_total[10m])) == 0` on a bot with 7 users and
~49 updates/day fires every night. Severity `critical`, routed to the only contact point.

### 4. Dashboard panels outlived their metrics

`bot_ai_requests_total`, `bot_ai_tokens_total`, `bot_notifications_total`,
`bot_mentor_requests_total` do not exist. Three of four series in "Error Rate (All
Sources)" are dead, so the panel stays blank even during a real outage.

Also: `bot_active_users_total` is registered but never updated (constant 0), and the
Loki `level` label picks up CEFR values (`A1`, `A2`, `B2`) from log bodies.

---

## Goal

An operator looking at Grafana can trust it: real failures page, idle traffic does not,
and no panel or rule silently reads a metric that does not exist.

---

## Scope

### 72.1 — autoheal actually runs 🔴

- Verify the image ships the binary before pinning:
  `docker run --rm --entrypoint sh willfarrell/autoheal:<tag> -c 'command -v autoheal'`.
- Pin to a tag that passes; keep the socket-proxy-only access model as-is.
- Confirm `polyglot_bot` carries the `autoheal=true` label the daemon watches.
- **Add a liveness assertion for the watchdog itself** — an autoheal that dies must not be
  silently equivalent to an autoheal that has nothing to do (see 72.2).

### 72.2 — alert rules that can fire 🔴

Rewrite `deploy/monitoring/grafana/provisioning/alerting/rules.yml`:

| Rule | Change |
|---|---|
| Translation errors | Ratio + floor, e.g. `errors / total > 0.2` over 30 m with `total >= 5`. Absolute rate thresholds do not work at this traffic |
| Restart loop | Drop the `name` matcher; use a label cAdvisor actually emits once 72.4 lands, or drive it from `bot_boot_total` (`increase(bot_boot_total[15m]) > 3`) which the app already exports |
| Circuit breaker | Either export `bot_ai_circuit_state` from the breaker in `packages/adapters/ai/src/failover.ts`, or delete the rule. Do not keep a rule whose "healthy" state is indistinguishable from "no data" |
| Update silence | Widen the window (hours, not 10 minutes) or gate on a traffic baseline; downgrade from `critical`. Idle is not an incident |
| **New:** watchdog down | Alert when `polyglot_autoheal` is restarting or absent |
| **New:** AI fallback broken | Alert on fallback attempts with a 100% failure rate (see Task 73) |

Set `no_data_state` deliberately per rule — `OK` is only correct where absence of data
genuinely means health.

### 72.3 — no dead references in dashboards 🟠

- Remove or re-point the 4 panels on non-existent metrics.
- Either implement `bot_ai_requests_total` / `bot_ai_tokens_total` (Task 24 covers token
  accounting) or drop the panels — the DB table `ai_request_latencies` already holds this
  data and could back a panel instead.
- Fix `bot_active_users_total` (never updated) or remove it.

### 72.4 — cAdvisor sees containers again 🟠

Per-container CPU/memory/restart metrics are entirely missing (only `/system.slice/*`
cgroups are exported). Restore container-level labels so the Docker dashboard and any
container-based alert have data. Verify with:
`count(container_memory_working_set_bytes{id=~"/docker/.*"})`.

### 72.5 — clean log labels 🟡

Promtail/Loki extract `level` from the log body, so CEFR difficulty levels (`A1`, `A2`,
`B2`) become log-level label values. Scope the extraction to the pino `level` field.

---

## Acceptance Criteria

- [ ] `polyglot_autoheal` has 0 restarts over 24 h and its Docker API connection is proven
      (kill a labelled test container; autoheal restarts it).
- [ ] Every alert rule's query returns a series in Prometheus — a scripted check fails CI
      if a rule references an unknown metric.
- [ ] A simulated AI outage (force-fail the provider) fires the translation-error alert
      within 30 min at production traffic levels.
- [ ] No alert fires for a quiet night with zero user traffic.
- [ ] Every panel on the `Polyglot Bot` dashboard renders data.
- [ ] `count(container_memory_working_set_bytes{id=~"/docker/.*"}) > 0`.
- [ ] `count(count by (level) ({container_name="polyglot_bot"}))` yields only pino levels.

---

## Non-Goals

- Rebuilding the metrics stack or moving off Prometheus/Loki.
- New product telemetry beyond what an alert needs (that is Task 24).
