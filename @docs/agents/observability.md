# Observability Rules

Logs: stdout → promtail → self-hosted Loki → Grafana (`deploy/monitoring/`).

## Every record carries a trace and an event

- **Trace.** Each unit of work starting outside the process (Telegram update, scheduler
  tick, notification delivery, cron sweep) opens a trace via `AsyncLocalStorage`
  (`packages/core/src/observability/trace-context.ts`); the pino `mixin` stamps it on every
  record. A new background job must wrap itself in `runWithTrace` with a `jobName`.
- **Event.** Use `logEvent(name, fields, level)`, never `logger.*`. Names are
  `<area>.<subject>.<outcome>`. `tracedOperation(name, fields, fn)` emits
  started/finished/failed with duration. `logEvent` never throws.

Debug path: filter `| json | telegramId="…"` → find the failing action → filter by its
`traceId`.

## Adding a log line

1. Reuse or extend the vocabulary below, and add new names to the table.
2. Pass only event-specific fields; identity comes from the trace.
3. Log the outcome, not the intent — `handler.finished` already records the tap.
4. Log sizes and ids, never whole sessions, decks or translation maps.
5. Anything emitted more than once per user action, or purely forensic, is `debug`.
   `*.started` is always `debug` (a dangling start at debug = a hang).
6. Register commands/callbacks through `onCommand`/`onCallback` in `bot-factory.ts` — they
   log automatically.

User message text is deliberately not redacted (only `username`/`password` are); Loki
retention is the control bounding it — check it before widening what is logged.

## Event vocabulary

| Area | Events |
|---|---|
| Update | `update.received`, `.finished`, `.failed`, `.unhandled` |
| Handlers | `handler.started` (debug), `.finished`, `.failed` |
| Routing | `mode_router.routed`, `.rejected`, `.idle_fallback` |
| Mentor | `mentor.idle_prompt_shown` (`idleMs`), `.idle_prompt_choice` (`stay` \| `translate` \| `stale`) |
| Telegram | `telegram.api.call`, `.body` (debug), `.failed` |
| Session | `session.loaded`/`.saved`/`.miss` (debug), `.repaired`, `.reset`, `.deleted` |
| Translation | `translation.language_detected`, `.direction_resolved`, `.completed`, `.failed`, `.clarification_requested` |
| Pipeline | `translation.pipeline.started`, `.sense_anchored` (debug), `.generation_failed`, `.validation_failed`, `.needs_review`, `.judge_failed`, `.judge_timed_out`, `.repair_*` |
| AI | `ai.request.completed`, `.failed` (`budgetMs`, `timedOut`) |
| AI credit | `ai.credit.polled`, `.unlimited`, `.poll_failed`, `.poll_disabled`, `.scheduled`, `.schedule_duplicate_ignored`, `.poll_stopped` |
| Callbacks | `callback.stale` (`action`, `recovered`) — for every stale-state guard |
| Vocabulary | `vocabulary.saved`, `.save_skipped`, `.save_failed` |
| Dictionary | `dictionary.created`, `.renamed`, `.deleted`, `.entry_added`, `.entry_moved`, `.entry_removed`, `.searched`, `.translate_failed` |
| Onboarding | `onboarding.started`, `.screen_rendered`, `.native_lang_selected`, `.learning_lang_confirmed`, `.languages_done`, `.completed`, `.demo_failed`, `.gate_redirected` (`kind`) |
| Settings | `settings.native_lang_changed`, `.interface_lang_changed`, `.learning_lang_added`/`_removed`, `.notifications_toggled`, `.notification_*_changed`, `.timezone_changed` |
| Cards | `cards.session_started`, `.card_rated`, `.session_finished`, `.rating_persist_failed` |
| Notifications | `notification.sent`, `.delivery_log_failed`, `.interaction` (`deliveryId`, `kind`, `action`), `.interaction_log_failed`, `.dictionary_exhausted`, `.preset.picked`/`.exhausted`/`.no_candidates`/`.unresolvable`, `nudge.*`, `retention.*` |
| Momentum | `momentum.effort_recorded` (debug), `.record_failed`, `.mature_word`, `.band_changed`, `.praise_shown`, `.recovery_shown`, `.progress_opened`, `.weekly_line_shown`, `.backfill_finished`, `.recompute_failed` |
| Voice | `voice.transcribed`, `.transcribe_failed`, `.transcribe_empty`, `.too_long` |
| TTS | `card.tts_played`, `.tts_failed` |
| Errors | `bot.error`, `bot.error_handler_failed` |

## Product events

A separate Postgres stream (`product_events`, shown on the admin Product Metrics page) for
aggregate product questions: `trackProductEvent(ctx, event, context)`.

- Closed vocabulary: `PRODUCT_EVENTS` in `packages/core/src/ports/product-event.repository.ts`.
- Two columns only — `event` and a short bounded `context`. No jsonb payload.
- Fire-and-forget: never awaited, never fails a flow. Pruned at 30 days.
- Commands (`onCommand`) and `feature.used`/`feature.locked` (`paid-feature.helper.ts`) are
  already counted in one place each — don't add call sites for them.
