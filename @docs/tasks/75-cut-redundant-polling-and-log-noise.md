# Task 75 — Cut Redundant Polling and Log Noise

**Status:** 🔲 To Do
**Category:** Cost / Infrastructure
**Priority:** 🟠 High
**Created:** 2026-08-04
**Source:** [Weekly Grafana Report 2026-08-04](../reports/weekly-grafana/2026-08-04.md)
**Related:** Task 48 (Extract Notification Scheduler), Task 55 (Health Check & Observability)

---

## Findings

### Log volume: 874 158 lines in 3 days — the application produced 811 of them (0.09%)

| Container | Lines / 3 d | What it is |
|---|---|---|
| polyglot_loki | 465 652 | Loki logging itself |
| polyglot_promtail | 103 680 | Promtail logging itself |
| polyglot_cadvisor | 51 813 | |
| polyglot_docker_socket_proxy | 34 440 | |
| polyglot_admin_api | 17 604 | **17 258 (98%) are `/healthz`** |
| polyglot_autoheal | 4 305 | crash loop — see Task 72 |
| **polyglot_bot** | **811** | the product |

`/healthz` on admin-api: **8 629 requests / 3 days** (every 30 s), and Fastify writes two
lines per request (`incoming request` + `request completed`).

Root filesystem grew **183 MB in 3 days** ≈ 1.8 GB/month, almost entirely self-inflicted.

### Notification scheduler: 92% of ticks do nothing but wake the database

- 144 ticks / 3 days (every 30 min)
- **132 (92%)** end in `No users eligible for notification at this time`
- 12 notifications actually sent

Each tick queries Neon. Neon `active_time` for the billing period is **84 775 s ≈ 26% of
wall-clock time**, and session reads still show **p95 1.6 s** (cold-start) — so the polling
is expensive enough to burn compute yet not consistent enough to avoid cold starts.
Related: the earlier `/livez` DB-ping incident, same failure shape.

### Admin panel

23 dashboard load cycles in the window, each also fetching `/api/settings/openrouter/key` —
the provider key is pulled on every stats page load.

---

## Goal

Infrastructure stops paying for work nobody reads: the log pipeline carries signal, and the
database is woken only when there is something to do.

---

## Scope

### 75.1 — stop logging health checks 🟠

Disable request logging for `/healthz` / `/livez` in the admin-api Fastify instance
(`disableRequestLogging` plus explicit logging on real routes, or a route-level serializer).
Removes ~98% of admin-api log volume.

### 75.2 — stop scraping the log pipeline with itself 🟠

Exclude `polyglot_loki`, `polyglot_promtail`, `polyglot_cadvisor` and
`polyglot_docker_socket_proxy` from the promtail scrape config, or drop their `info` lines.
Keep warn/error. Removes ~75% of total ingest.

Confirm afterwards that disk growth flattens (`node_filesystem_avail_bytes` over 7 days)
and set a Loki retention policy if it does not.

### 75.3 — event-driven notification scheduling 🟠

Replace the fixed 30-minute poll with a computed next-due timestamp: query the earliest
upcoming notification window, sleep until it, then act. A tick that reliably finds work is
also a tick worth logging.

Expected effect: ~132 fewer DB wake-ups per 3 days, and Neon `active_time` driven by real
usage rather than by the scheduler. Coordinate with Task 48 — if the scheduler moves to its
own process, this logic moves with it.

### 75.4 — do not re-fetch the provider key per page load 🟡

`/api/settings/openrouter/key` is requested once per admin dashboard load (23 times in the
window) alongside the stats calls. Fetch it only when the settings screen needs it.

### 75.5 — reconcile the request counters 🟡

Four sources disagree for the same window: 43 `translation request started` (logs),
36 `bot_translations_total` (metric: 34 ok + 2 error), 34 rows in `translation_requests`,
31 rows in `translation_request_timings` (28 ok + 3 failed). The metric also disagrees with
the DB on the failure count (2 vs 3). Pick the authoritative source per question and fix
the drift, or the next report repeats this paragraph.

---

## Acceptance Criteria

- [ ] Total Loki ingest drops by ≥ 80%; `polyglot_bot` lines are a visible share of the total.
- [ ] `/healthz` produces no log lines; health checks still function and the container
      healthcheck still flips on failure.
- [ ] Scheduler ticks that find no eligible users approach zero over a week.
- [ ] Neon `active_time` for a comparable period drops measurably.
- [ ] Root-filesystem growth over 7 days is ≤ 200 MB.
- [ ] Translation counts agree across logs, metrics and the two DB tables for a given day.

---

## Non-Goals

- Reducing Prometheus scrape volume (176 lines / 3 days — not a problem).
- Moving off Loki/promtail.
