# Task 78 — Cut alert noise to signal only

**Status:** 🔲 To Do
**Category:** Observability / Operations
**Priority:** 🟠 High
**Created:** 2026-08-22
**Related:** `@docs/agents/observability.md`, `deploy/monitoring/grafana/provisioning/alerting/`,
Task 77 (the outage that exposed the missing credit alert)

---

## Goal

Alerts should arrive only when something is actually wrong. Today one rule fires
permanently and falsely, and the two failures the operator most wants to hear
about — **the AI key running out of credit** and **a notification failing to
deliver** — have no alert at all.

Alerts are delivered by Grafana to a **Telegram chat that is also the operator's
own chat with the bot** (`contact-points.yml`, chatid `368249477`), so a false
alert is not merely noise: it interleaves with real bot usage.

---

## Confirmed current state (measured 2026-08-22, not assumed)

Seven rules live in Grafana. Six are in
`deploy/monitoring/grafana/provisioning/alerting/rules.yml`. **The seventh is not.**

| rule | severity | live state |
|---|---|---|
| `polyglot_bot_down` | critical | normal |
| **`polyglot_bot_update_silence`** — "No Telegram updates for 10m" | **critical** | **🔴 FIRING** |
| `polyglot_bot_translation_errors` | warning | normal |
| `polyglot_bot_restart_loop` | critical | normal |
| `polyglot_bot_circuit_open` | warning | normal |
| `polyglot_host_disk_low` | warning | normal |
| `polyglot_host_disk_critical` | critical | normal |

### The finding that matters

`polyglot_bot_update_silence` **was deliberately deleted from `rules.yml`** — the
file still carries its obituary as comment `# 2. (Removed)`, explaining that
message volume is a poor liveness proxy because an MVP-sized bot is legitimately
idle and the rule "false-fired constantly".

**It is still live, and it is firing right now.** Deleting it from the
provisioning file did not remove it from the running instance.

With `repeat_interval: 4h` on a single catch-all notification policy, that is a
critical-severity false alarm roughly six times a day, forever. This one rule is
almost certainly the entire complaint.

**Do not assume a YAML edit will fix it.** Whatever caused the file deletion not
to propagate last time is the actual problem to solve; a second identical edit
will produce a second identical non-result. Diagnose first (see step 1).

---

## What is missing

Neither of the two signals the operator explicitly asked for exists.

**1. OpenRouter credit exhausted.** On 2026-08-22 the key hit its `$1` total cap
(`usage 1.0000871 / limit 1`). Every AI call failed instantly; translation was
fully down. Nothing alerted. Note `polyglot_bot_translation_errors` did **not**
catch it either — worth understanding why before trusting it (the outage may have
been shorter than its `for: 5m`, or the error rate stayed under `0.05/s` at this
traffic level, which would mean that rule cannot detect a total outage on a
low-traffic bot — a second defect if confirmed).

Two possible sources, decide with evidence:
- a Loki rule on the provider's error text (`Key limit exceeded`), which needs no
  new code — the string is already in the stream via `ai.request.failed`;
- a real gauge scraped from OpenRouter `GET /api/v1/key` (`usage`, `limit`), which
  alerts *before* exhaustion rather than after. Note the admin API already calls
  this endpoint (`apps/admin-api/src/routes/ai-models.ts`) but its zod schema
  parses only `label` and `expires_at` and discards `usage`/`limit`.

**2. Notification delivery failure.** `bot_notifications_total{status}` exists as
a metric; confirm which status labels are actually emitted before writing a rule
against a label value that never appears — that is exactly how
`polyglot_bot_translation_errors` needed its `or vector(0)` fix.

---

## Recommended keep-list — but confirm with the operator first

The request as stated was "turn everything off and leave only the important
ones". The measured data does not support that: six of the seven rules are quiet
and each covers a real failure mode. Blanket-disabling them would trade a noise
problem for a blindness problem, and the operator has just been bitten by
blindness (the credit outage).

Recommended instead:

- **Delete** `polyglot_bot_update_silence` (live only — already gone from the file).
- **Keep** `polyglot_bot_down`, `polyglot_bot_restart_loop`,
  `polyglot_host_disk_critical` — critical, quiet, each a genuine outage.
- **Keep** `polyglot_bot_circuit_open` — quiet, and directly relevant to AI failure.
- **Investigate** `polyglot_bot_translation_errors` — it should have caught the
  credit outage. Fix its threshold or replace it with a ratio-based rule that works
  at low traffic.
- **Consider muting rather than deleting** `polyglot_host_disk_low` — it is the
  early warning for the critical one. Route it somewhere non-paging instead of
  removing it.
- **Add** the two missing rules above.

If the operator still wants everything else off, say so explicitly in the plan and
record what coverage is being given up.

---

## Which noise is it, actually? — resolve before starting

"Too many notifications" could mean either of two different systems. Confirm with
the operator; the fix is unrelated in each case.

- **Grafana → Telegram alerts.** Everything above. Lever:
  `deploy/monitoring/grafana/provisioning/alerting/`.
- **Log volume in Loki.** A different problem. Production runs at `info`, and
  `telegram.api.call` emits one info record per outbound API call, which dominates
  the stream. Levers: `LOG_LEVEL`, moving specific events to `debug` per
  `@docs/agents/observability.md`, or promtail drop rules in
  `deploy/monitoring/promtail/promtail.yml`. **Do not silence events by deleting
  `logEvent` calls** — the event catalogue in the observability doc is a contract,
  and levels are the intended lever.

---

## Constraints — read before touching anything

1. **The monitoring stack is a separate pipeline from the app deploy.** Changes
   under `deploy/monitoring/**` reach production only via the monitoring deploy.
   See `@docs/agents/deployment.md`. A YAML edit alone changes nothing running.
2. **`contact-points.yml` is booby-trapped.** An empty token or an unquoted numeric
   `chatid` makes Grafana fail provisioning and **crash-loop the container**, which
   surfaces as nginx 502 on the Grafana domain. The file's own comments explain
   why `chatid` is a hardcoded quoted string. Do not "tidy" that.
3. **Do not run `pnpm ansible` against production** without a separate, explicit
   request for that exact action.
4. **Verify against the live instance, not the file.** This whole task exists
   because file state and live state disagreed. After any change, re-list the rules
   through the Grafana API and confirm what is actually running.
5. Alert rules edited in the Grafana UI acquire a provenance that can make
   provisioning skip them. Check this as the likely cause in step 1.

---

## Plan

1. **Diagnose the drift.** Why did deleting `polyglot_bot_update_silence` from
   `rules.yml` not remove it live? Check rule provenance, whether the monitoring
   stack was redeployed after that commit, and provisioning logs. Write down the
   cause — it governs whether the fix is a file edit, an API delete, or both.
2. Remove the firing rule and prove it is gone from the live instance.
3. Confirm the noise source with the operator (alerts vs log volume) and the
   keep-list above.
4. Investigate why `polyglot_bot_translation_errors` missed a total AI outage.
5. Add the credit-exhaustion alert. Prefer the gauge if it is cheap, because it
   warns before the outage instead of during it.
6. Add the notification-failure alert, after confirming the metric's real labels.
7. Redeploy the monitoring stack and re-verify live.

---

## Acceptance criteria

- [ ] No alert rule is in a firing state while the system is healthy.
- [ ] `polyglot_bot_update_silence` is gone from the live instance, and the reason
      it survived its own deletion is documented.
- [ ] An alert fires when the OpenRouter key nears or hits its limit, demonstrated
      against a real or simulated condition — not merely written.
- [ ] An alert fires when notification delivery fails, likewise demonstrated.
- [ ] Live rule list matches `rules.yml` exactly; the drift cannot recur silently.
- [ ] Grafana is reachable after the change (the crash-loop failure mode).
- [ ] `CHANGELOG.md` updated. No app code changed → the app quality gate does not
      apply; if code *is* touched, the full gate does.

---

## Open questions for the operator

1. Alerts, log volume, or both?
2. Accept the recommended keep-list, or genuinely disable everything but the two
   new rules?
3. Should warnings go to a separate channel rather than the personal chat, so
   critical alerts stay distinguishable?
