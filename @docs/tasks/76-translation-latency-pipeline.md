# Task 76 — Translation Latency: 5 AI Calls per Request

**Status:** 🔲 To Do
**Category:** Performance
**Priority:** 🟡 Medium
**Created:** 2026-08-04
**Source:** [Weekly Grafana Report 2026-08-04](../reports/weekly-grafana/2026-08-04.md)
**Related:** Task 06 (AI Token Optimization), Task 24 (Token Usage Tracking)

---

## Findings

Latency over 2026-08-01 → 2026-08-04:

| Metric | Value |
|---|---|
| Translation p95 (histogram) | **7.4 s** |
| Translation avg / p95 (DB, successful only) | 4.8 s / 10.3 s |
| Failed request | **16.4 s** before the user sees an error (Task 73) |
| Update handling p95 | **23 s** (message), 6.8 s (callback) |
| `Slow update handling` (> 4 s) | **44 events = 30% of all updates**; 21/21 = 100% in the busy hour |
| Delivery lag p95 (Telegram → bot) | 0.95 s — fine |
| Session read (Neon) | avg 265 ms, **p95 1.6 s** (cold start) |

Phase averages: `generate` 2.49 s → `post_ai` 2.27 s → `judge` 1.46 s → `detection` 0.87 s
→ `pre_ai` 0.47 s → `validate` 0.40 s.

**The provider is not the bottleneck.** A single AI call averages 1.48 s (p95 2.33 s), but
each translation issues **4.6–5.0 calls** (206 calls / 43 requests; 106 / 21 in the busy
hour). Requests carry **2.5 target languages on average** (86 target rows / 34 requests).

Server load is irrelevant here: host CPU 6.65%, RAM 34.5% of 3.8 GB, bot RSS 130 MB. All
latency is pipeline structure plus the Neon round-trip to `eu-central-1`.

---

## Goal

Cut p95 translation latency without lowering output quality, by removing serialisation
rather than by removing pipeline steps.

---

## Scope

### 76.1 — parallelise per-target-language generation 🟠

With 2.5 target languages per request and one object call per language, generation is the
dominant serial cost. Fan the calls out concurrently and join, keeping per-call budgets
inside the outer op guard. Note the failover budget interaction from Task 73 — a shorter
wall-clock per leg must not reintroduce timeouts.

### 76.2 — investigate `post_ai` (2.27 s avg) 🟠

The second-largest phase runs **after** the model has answered. Break it down (persistence,
card rendering, dictionary writes, follow-up enrichment) and move whatever does not block
the user's first response off the critical path.

### 76.3 — reduce the call count 🟡

Map the 5 calls per request to phases and identify which are unconditional. `detection` ran
38 times for 34 requests; `judge` only 4 (correctly gated on high risk). Repair rounds from
validation add more — Task 74 removes ~23% of them at the source, so **land 74 first and
re-measure before optimising here**.

### 76.4 — absorb the Neon cold start 🟡

Session read p95 1.6 s is a compute cold start on the first update after idle. Task 75.3
removes the polling that was accidentally masking this. Options: keep the read off the
critical path for the first message, or accept it and make the "thinking" UX cover it.

---

## Acceptance Criteria

- [ ] AI calls per translation drop below 3 on the common path (currently 4.6–5.0).
- [ ] Translation p95 drops below 5 s (currently 7.4 s).
- [ ] `Slow update handling` (> 4 s) covers under 10% of updates (currently 30%).
- [ ] Token spend per translation does not increase (baseline: ~3 900 input tokens,
      $0.0026 per translation).
- [ ] Quality does not regress — validation-failure rate and the benchmark corpus stay flat
      or improve.

---

## Non-Goals

- Switching providers or models — `gemini-3.1-flash-lite` at 1.48 s avg is not the problem.
- Removing the semantic judge (it already runs on only ~10% of requests).
- Server/VPS sizing — the host is 93% idle.
