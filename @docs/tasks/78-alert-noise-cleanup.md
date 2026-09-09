# Task 78 — Cut alert noise to signal only

**Status:** 🟡 In Progress — config + code landed on `develop`; two live-instance steps outstanding (see Outcome)
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


---

## Outcome (2026-08-22)

### Step 1 — the drift is diagnosed

**All seven live rules report `provenance: "file"`, including the deleted one.**
That rules out the step-1 hypothesis the constraints section flagged as most
likely: the rule had *not* been edited in the UI and had *not* acquired a
UI provenance that made provisioning skip it.

The real cause is duller and worse. **Grafana file provisioning is
create/update-only.** It reconciles the rules a file *declares* and silently
ignores rules it no longer mentions. A rule already in the database therefore
survives its own deletion indefinitely, and no amount of redeploying the
monitoring stack would have removed it — the redeploy was never the missing
piece. The only mechanism that deletes a provisioned rule is an explicit
`deleteRules:` block, which `rules.yml` now carries permanently (idempotent, so
it stays as a standing instruction rather than a one-off).

The brief's insistence on diagnosing before re-deleting was correct: a second
identical YAML edit would have produced a second identical non-result.

### Operator decisions

Both open questions were answered:

1. **Alerts, not log volume.** The Loki/`LOG_LEVEL` half of the brief was not
   the complaint and is untouched.
2. **Critical only.** Not the brief's recommended keep-list — the operator chose
   the narrower option. Implemented as a **mute, not a deletion**: non-critical
   rules still evaluate and still show their true state in Grafana's UI, they
   simply never send a message. That keeps `host_disk_low` available as the
   early warning for `host_disk_critical` instead of trading a noise problem for
   a blindness problem.
3. **Both missing alerts added**, with credit exhaustion implemented as the
   gauge rather than the Loki rule — it warns before the outage instead of
   during it.

### Step 4 — why `translation_errors` missed the outage (confirmed defect)

The brief's second suspicion is confirmed, and it is the threshold, not the
`for: 5m`. `bot_translations_total{status="success"}` measured **4 — lifetime**,
at `bot_boot_total = 1`. The rule needed `0.05/s`, about 15 errors in 5 minutes.
Unreachable by roughly three orders of magnitude. Rewritten as a ratio, which is
traffic-independent.

### Also found, not in the brief

- **`bot_notifications_total` did not exist in Prometheus at all.** The brief
  recorded it as existing. The counter is declared, but the only code that
  incremented it was the daily activation nudge (`nudge_*` statuses) — the
  scheduled-notification path, which is the one that matters here, was
  uninstrumented. A rule written against it as-found would have been a rule
  against a series that never appears. It is now incremented on the real
  delivery path with `delivery_*` statuses.
- **`bot_ai_requests_total` and `bot_ai_tokens_total` are declared in
  `apps/bot/src/metrics.ts` and incremented nowhere.** Dead metrics. This is why
  the credit outage had no signal of any kind: there was no AI-call metric to
  alert on. Left in place — removing them is a separate change — but they should
  not be mistaken for coverage.

### Still outstanding (cannot be done from here)

1. **The firing rule is still live.** `deleteRules:` removes it on the next
   monitoring deploy, but that deploy runs on push to `master`
   (`.github/workflows/deploy-monitoring.yml`, `paths: deploy/monitoring/**`) —
   this work is on `develop`. Until then the false alarm continues. It can be
   killed immediately with a `DELETE /api/v1/provisioning/alert-rules/polyglot_bot_update_silence`
   carrying `X-Disable-Provenance: true`; that is a live production mutation and
   was not performed unattended.
2. **Acceptance criteria 3 and 4 are not yet met as written.** Both new alerts
   are demonstrated at the *expression* level — all three new/changed PromQL
   expressions were evaluated against the live Prometheus and return a clean `0`
   with their series absent, confirming they do not false-fire before the
   metrics exist — and the exporter's behaviour is unit-tested (near-limit,
   unlimited key, provider failure, malformed response) with delivery outcomes
   covered end-to-end through the real dispatcher and real Postgres. But neither
   has been demonstrated *firing* against a real or simulated condition on the
   live instance, which is what those criteria demand. That requires the deploy.
3. **The provisioning smoke test did not run.** The intended check — booting
   `grafana/grafana:13.1.0` locally against these exact provisioning files to
   prove the crash-loop failure mode (constraint 2) is not triggered — could not
   run because the local Docker daemon was down. The files parse as YAML and
   `contact-points.yml` was not touched, but that is weaker evidence than a boot.
   **Run this before merging to `master`**, since a provisioning error surfaces
   as nginx 502 on the Grafana domain, not as a failed deploy.
4. **Re-verify live after the deploy** and confirm the live rule list matches
   `rules.yml` exactly (criterion 5).
