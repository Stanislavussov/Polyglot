# Observability — trace context and the event stream

Canonical guidance for logging. Read this before adding a log line.

Records go to stdout → promtail → **self-hosted Loki** → Grafana
(`deploy/monitoring/`). Nothing leaves the VPS.

## The two things every record carries

**1. A trace.** Every unit of work that starts outside the process opens one:
a Telegram update, a scheduler tick, a single notification delivery, a cron
sweep. Everything running underneath shares it through `AsyncLocalStorage`
(`packages/core/src/observability/trace-context.ts`), and the pino `mixin` in
`packages/core/src/logger.ts` stamps it onto every record — including ones
written deep inside a core service or a DB adapter that never saw a `ctx`.

Trace fields: `traceId`, `source`, and whichever of `userId`, `telegramId`,
`chatId`, `updateId`, `jobName`, `parentTraceId` are known. The auth middleware
calls `enrichTrace({ userId })` once the DB lookup resolves, so records written
before and after it share the same identity.

**2. An `event` name.** Emit through `logEvent(name, fields, level)` rather than
`logger.info(...)`. The stable name is what makes the stream queryable instead
of merely readable — `| json | event="translation.failed"` beats grepping prose
someone may reword. Names are `<area>.<subject>.<outcome>`, dot-delimited,
general → specific.

```ts
import { logEvent, tracedOperation, errorFields } from "@polyglot/core";

logEvent("dictionary.entry_removed", { dictionaryId, entryId });
logEvent("translation.failed", { word, ...errorFields(err) }, "error");

// started/finished/failed with a duration, in one wrapper:
await tracedOperation("video.transcript_fetch", { videoId }, () => fetch(...));
```

`logEvent` never throws: observability must not be able to break the flow it
observes.

## Reproducing a problem

A user reports a broken button. In Grafana → Explore → Loki:

```logql
# Everything that user did, newest first
{container_name="polyglot-bot"} | json | telegramId="123456789"

# One tap and its entire causal chain — handler, DB, AI, replies
{container_name="polyglot-bot"} | json | traceId="a1b2c3d4e5f6"

# Buttons that matched no handler (dead keyboards from an old release)
{container_name="polyglot-bot"} | json | event="update.unhandled"

# Slowest translations
{container_name="polyglot-bot"} | json | event="translation.completed" | totalMs > 15000
```

The usual path is: filter by `telegramId` → find the failing action → copy its
`traceId` → filter by that.

## Coverage

Registration in `bot-factory.ts` goes through the `onCommand` / `onCallback`
helpers, which wrap every handler in `withHandlerLog`. **A new command or
callback is therefore logged with no second edit** — keep using the helpers.

| Layer | Events |
|---|---|
| Update lifecycle | `update.received`, `update.finished`, `update.failed`, `update.unhandled` |
| Handlers | `handler.started` (debug), `handler.finished`, `handler.failed` |
| Text routing | `mode_router.routed`, `mode_router.rejected`, `mode_router.idle_fallback` |
| Outgoing Telegram | `telegram.api.call`, `telegram.api.body` (debug), `telegram.api.failed` |
| Session | `session.loaded`/`saved` (debug), `session.miss` (debug), `session.repaired`, `session.reset`, `session.deleted` |
| Translation | `translation.language_detected`, `.direction_resolved`, `.completed`, `.failed`, `.clarification_requested` |
| Translation pipeline | `translation.pipeline.started`, `.sense_anchored` (debug), `.generation_failed`, `.validation_failed`, `.needs_review`, `.judge_failed`, `.judge_timed_out`, `.repair_*` |
| AI | `ai.request.completed`, `ai.request.failed` (with `budgetMs`, `timedOut`) |
| AI credit (Task 78) | `ai.credit.polled`, `.unlimited`, `.poll_failed`, `.poll_disabled`, `.scheduled`, `.schedule_duplicate_ignored`, `.poll_stopped` |
| Callbacks | `callback.stale` — a button whose backing state was gone, for every guard (`action`); `recovered` says whether a retry could be offered. Supersedes the per-site `vocabulary.save_state_lost` / `card.tts_state_lost` |
| Vocabulary | `vocabulary.saved`, `.save_skipped`, `.save_failed` |
| Dictionary | `dictionary.created`, `.renamed`, `.deleted`, `.entry_added`, `.entry_moved`, `.entry_removed`, `.translate_failed` |
| Onboarding | `onboarding.started`, `.screen_rendered`, `.native_lang_selected`, `.learning_lang_confirmed`, `.languages_done`, `.completed`, `.demo_failed` |
| Settings | `settings.native_lang_changed`, `.interface_lang_changed`, `.learning_lang_added`/`_removed`, `.notifications_toggled`, `.notification_*_changed`, `.timezone_changed` |
| SRS / flashcards | `srs.card_rated`, `srs.session_finished`, `flashcard.session_started`, `.session_finished` |
| Notifications / cron | `notification.sent`, `notification.dictionary_exhausted`, `notification.preset.picked`/`.exhausted`/`.no_candidates`/`.unresolvable`, `nudge.*`, `retention.*` |
| Voice input (Task 80) | `voice.transcribed`, `.transcribe_failed`, `.transcribe_empty`, `.too_long` |
| Pronunciation (Task 77) | `card.tts_played`, `.tts_failed`, `.tts_state_lost` |
| Errors | `bot.error`, `bot.error_handler_failed` |

## Levels

Production runs at `info`. Set `LOG_LEVEL=debug` on a container to add the
high-volume half — handler starts, outgoing message bodies, session
reads/writes, per-phase timings — while chasing an incident.

`debug` is the right level for anything emitted more than once per user action,
or anything whose value is only forensic. A `*.started` record is debug on
purpose: at `info` the stream stays one line per completed operation, and at
`debug` an operation that was entered but never returned shows up as a dangling
start — the signature of a hang.

## PII

`packages/core/src/logger.ts` redacts `username` and `password` at every nesting
level. **User message text is deliberately not redacted**: reproducing a
translation bug means knowing the exact input, and Loki is ours. `userId` and
`telegramId` already identify a user, so the handle adds exposure without adding
diagnostic value.

That makes **Loki retention the control that bounds this data** — it is the only
thing deciding how long user-typed text is kept. Check it before widening what
is logged.

## Adding a log line

1. `logEvent`, not `logger.*`. Pick a name from the table's vocabulary or extend
   it in the same shape, and add it to the table.
2. Pass only what is specific to the event — identity comes from the trace.
3. Log the **outcome**, not the intent. "User tapped delete" is already covered
   by `handler.finished`; what is missing without you is *what the tap changed*.
4. Never log a whole session, deck, or translation map. Log sizes and ids.
5. Opening a new background job? Wrap it in `runWithTrace` with a `jobName`, or
   its records will have no thread to pull.
