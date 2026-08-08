# Task 73 — Make the AI Failover Actually Work (strict-schema + budget split)

**Status:** 🔲 To Do
**Category:** Bug / Reliability
**Priority:** 🔴 Critical
**Created:** 2026-08-04
**Source:** [Weekly Grafana Report 2026-08-04](../reports/weekly-grafana/2026-08-04.md)
**Related:** Task 08 (AI Model Fallback — the mechanism this task repairs)

---

## Incident

Over 2026-08-01 → 2026-08-04 the bot showed a user-visible error **3 times**
(words: «в отличие от», «честный», «narradora»). All three followed the identical chain:

```
google/gemini-3.1-flash-lite  → timeout at exactly 10 000 ms
   ↓ failover
openai/gpt-5-nano             → timeout at exactly  5 000 ms
   ↓
AITimeoutError → user waited 15–16 s and got an error
```

Fallback model results over the window (`ai_request_latencies`):

| model | kind | success | n | avg ms |
|---|---|---|---|---|
| google/gemini-3.1-flash-lite | object | ✅ | 169 | 1 478 |
| google/gemini-3.1-flash-lite | text | ✅ | 29 | 996 |
| google/gemini-3.1-flash-lite | object | ❌ | 4 | 10 004 |
| **openai/gpt-5-nano** | object | ❌ | **4** | 3 843 |

**The fallback has a 0% success rate.** Failover, its metrics, its circuit breaker and its
tests all exist — and it has never once rescued a request.

---

## Root Causes

### 1. The output schema is illegal for OpenAI strict structured outputs

One fallback attempt failed in 365 ms, not on a timeout:

> `[Azure] Invalid schema for response_format 'response': In context=('properties','sourceUsage','properties','examples','items'), 'required' is required to be supplied and to be an array including every key in properties. Missing 'native'.`

`packages/core/src/modules/translation/schemas/translation.schema.ts:22`

```ts
native: z.string().min(1, "Example native sentence is required").nullish(),
```

An optional Zod field produces a JSON Schema where `native` is absent from `required`.
OpenAI/Azure strict structured output rejects that unconditionally. Gemini tolerates it.

**Consequence:** the OpenAI fallback can never return an object for this schema — the
timeouts merely hide a structural incompatibility. Any OpenAI-family fallback is dead on
arrival until the schema is provider-portable.

### 2. The fallback gets half the budget of the primary

`apps/bot/src/utils/ai-model.ts:76`

```ts
const reservedFallbackMs = Math.min(RESERVED_FALLBACK_MS, Math.floor(budgetMs / 3)); // 5 000
const primaryBudgetMs = budgetMs - reservedFallbackMs;                               // 10 000
```

With `B = 15 000`: primary 10 s, fallback 5 s. The model invoked **because the first one
was too slow** is given **half the time**. For a reasoning model like `gpt-5-nano`, 5 s is
a near-guaranteed timeout — which is exactly what the other three attempts show.

The invariant `primaryBudgetMs >= reservedFallbackMs` is documented and tested, so the
skew is deliberate; the review just shows the trade-off is wrong in production.

---

## Goal

When the primary model fails, the fallback returns a usable translation more often than
not — and if it cannot, that is visible in monitoring within minutes rather than at the
next manual log review.

---

## Scope

### 73.1 — provider-portable object schemas 🔴

- Emit strict-compatible JSON Schema for object requests: every property listed in
  `required`, optionality expressed as `type: ["string", "null"]` rather than an omitted key.
- Keep the Zod-level semantics (nullish stays nullish for the domain); the change is at
  the schema-serialisation boundary in the AI adapter.
- Audit **all** object schemas the pipeline sends, not just `sourceUsage.examples[].native`
  — this class of bug repeats for every optional field (`alternatives`, `usageNote`,
  `connotationWarning`, `equivalentNote`, `nativeMeaning`).
- Add a test that asserts the generated schema is strict-valid (all keys required,
  `additionalProperties: false`) for every schema variant the builder can produce.

### 73.2 — a fallback budget that can succeed 🔴

Options, to be decided in implementation:

- **Equal split** — `primaryBudgetMs == reservedFallbackMs` with a larger total budget.
- **Raise the total** `B` (currently 15 s via `ai.defaults`) so both legs get ≥10 s.
- **Pick a fast non-reasoning fallback** whose p95 fits a small reserve.

Constraint to preserve: `primaryBudgetMs + reservedFallbackMs <= B`, and `B` must stay
inside the bot's outer long-op guard so the user never waits longer than today's 16 s
worst case — ideally less.

### 73.3 — prove the fallback works, continuously 🟠

- A smoke test that runs the fallback model against a real production-shaped schema and
  asserts a parsed object comes back. A pure-mock test cannot catch a provider-side schema
  rejection — that is precisely how this shipped.
- Export `bot_ai_fallback_total{model,outcome}` and alert on
  `attempts > 0 AND successes == 0` over a rolling window (rule lands in Task 72.2).

### 73.4 — cheaper failure 🟡

A user currently waits **16.4 s on average** to be told it failed, versus 4.8 s for a
success. Once the fallback works this mostly resolves; if both legs fail, fail fast rather
than burning the whole budget silently.

---

## Acceptance Criteria

- [ ] A schema-strictness test covers every object schema the translation pipeline emits.
- [ ] Forcing the primary model to fail yields a **successful** fallback translation
      against the real provider (recorded in `ai_request_latencies` with `success = true`).
- [ ] `openai/*` (or whichever fallback is chosen) shows a non-zero success count in a week
      of production data.
- [ ] Worst-case user-visible failure latency ≤ today's 16.4 s, measured on
      `translation_request_timings.total_ms` where `success = false`.
- [ ] An alert fires when the fallback is attempted and never succeeds.

---

## Non-Goals

- Changing the primary model (`gemini-3.1-flash-lite` at 2% timeout rate is fine).
- Reworking the circuit breaker's state machine — only exporting its state (Task 72.2).
