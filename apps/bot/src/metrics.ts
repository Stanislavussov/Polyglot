/**
 * Lightweight HTTP server exposing Prometheus metrics on :9090/metrics
 * and a health endpoint on :9090/healthz.
 */
import { createServer, type Server } from "node:http";
import { pingDatabase } from "@polyglot/adapter-db";
import { logger } from "@polyglot/core";
import { Counter, collectDefaultMetrics, Gauge, Histogram, register } from "prom-client";
import { checkLiveness, checkReadiness } from "./health.js";

// ── Default Node.js metrics (CPU, memory, event-loop, GC) ───────────
collectDefaultMetrics();

// ── Custom metrics ───────────────────────────────────────────────────

export const translationCounter = new Counter({
  name: "bot_translations_total",
  help: "Total translation requests",
  labelNames: ["status"] as const,
});

export const translationDuration = new Histogram({
  name: "bot_translation_duration_seconds",
  help: "Translation request duration in seconds",
  buckets: [0.5, 1, 2, 5, 10, 30],
});

/**
 * The fixed, bounded label set for {@link translationPhaseDuration}. Keeping the
 * values enumerated here (rather than passing free-form strings at the call
 * site) is what keeps the metric's cardinality bounded — never add a
 * user/word/model dimension to this histogram.
 *
 * `pre_ai`, `detection` and `post_ai` are measured here; `preflight`, `generate`,
 * `validate` and `judge` happen inside the pure-core pipeline and arrive through
 * the `onPhase` sink handed to `translateWithContext`.
 *
 * A phase that did no work is NOT observed — `preflight` short-circuits on
 * confident detection and `judge` only runs on high-risk input, so emitting a
 * zero for them would drag those quantiles toward zero and hide the tail the
 * metric exists to expose. Absent is the honest signal.
 *
 * These do not sum exactly to `bot_translation_duration_seconds`: the dictionary
 * context lookup that runs inside `translateWithContext` before the pipeline
 * starts carries no label of its own. It is a single SELECT, so the residual is
 * small — but do not read the phases as an exhaustive partition.
 */
export const TRANSLATION_PHASES = [
  "pre_ai",
  "detection",
  "preflight",
  "generate",
  "validate",
  "judge",
  "post_ai",
] as const;

export type TranslationPhase = (typeof TRANSLATION_PHASES)[number];

export const translationPhaseDuration = new Histogram({
  name: "bot_translation_phase_duration_seconds",
  help: "Per-phase breakdown of the translate path in seconds (pre_ai, detection, preflight, generate, validate, judge, post_ai) — complements bot_translation_duration_seconds by showing where the wall-clock time goes. Phases that did no work on a request are not observed at all.",
  labelNames: ["phase"] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30],
});

export const inputCorrectionCounter = new Counter({
  name: "bot_input_correction_total",
  help: "Input typo detection/correction outcomes in translate mode",
  labelNames: ["outcome", "input_type"] as const,
});

export const unrecognizedWordCounter = new Counter({
  name: "bot_unrecognized_word_total",
  help: "Unrecognized-word guard outcomes in translate mode (Task 70)",
  labelNames: ["outcome"] as const,
});

export const staleCallbackCounter = new Counter({
  name: "bot_stale_callback_total",
  help: "Inline-button taps whose backing state was already gone, by guard and whether the card's input could still seed a one-tap retry",
  labelNames: ["action", "recovered"] as const,
});

export const onboardingStepCounter = new Counter({
  name: "bot_onboarding_step_total",
  help: "Onboarding screen entries and outcomes (Task 72) — labels are a bounded enum, never free-form",
  labelNames: ["step", "outcome"] as const,
});

/**
 * Motivation-layer counters (Task 81 §7.3). Every label set is a bounded enum —
 * `kind` is a PraiseKind, `surface` one of the four motivation surfaces, `reason`
 * one of cooldown/weekly_cap/killswitch/no_evidence, `band` one of four ranges —
 * so cardinality stays in the same order as `bot_onboarding_step_total`.
 *
 * Praise suppression is a counter and NOT a log event on purpose: production runs
 * at `info`, suppression happens more than once per user action, and a safety
 * signal nobody can see is not a safety signal.
 */
export const motivationPraiseCounter = new Counter({
  name: "bot_motivation_praise_total",
  help: "Motivation praise lines actually shown, by praise kind and the surface that carried them",
  labelNames: ["kind", "surface"] as const,
});

export const motivationPraiseSuppressedCounter = new Counter({
  name: "bot_motivation_praise_suppressed_total",
  help: "Praise decisions withheld, by reason (cooldown, weekly_cap, killswitch, no_evidence)",
  labelNames: ["reason"] as const,
});

export const motivationProgressOpenedCounter = new Counter({
  name: "bot_motivation_progress_opened_total",
  help: "Progress screen opens, by momentum band",
  labelNames: ["band"] as const,
});

export const motivationRecoveryShownCounter = new Counter({
  name: "bot_motivation_recovery_shown_total",
  help: "Recovery lines shown to a returning user — volume only, no labels",
});

export const mentorCounter = new Counter({
  name: "bot_mentor_requests_total",
  help: "Total mentor chat requests",
  labelNames: ["status"] as const,
});

export const mentorDuration = new Histogram({
  name: "bot_mentor_duration_seconds",
  help: "Mentor chat request duration in seconds",
  buckets: [0.5, 1, 2, 5, 10, 30],
});

export const telegramMessagesCounter = new Counter({
  name: "bot_telegram_messages_total",
  help: "Total Telegram messages received",
  labelNames: ["type"] as const,
});

export const notificationCounter = new Counter({
  name: "bot_notifications_total",
  help: "Total notifications sent",
  labelNames: ["status"] as const,
});

export const aiRequestCounter = new Counter({
  name: "bot_ai_requests_total",
  help: "Total AI provider requests",
  labelNames: ["model", "status"] as const,
});

export const aiTokensCounter = new Counter({
  name: "bot_ai_tokens_total",
  help: "Total AI tokens consumed",
  labelNames: ["model", "type"] as const,
});

export const aiFallbackCounter = new Counter({
  name: "bot_ai_fallback_total",
  help: "AI fallback-model failovers (Phase 2): a retriable failure on the primary model succeeded on the fallback",
  labelNames: ["from_model", "to_model", "reason"] as const,
});

export const aiCircuitStateGauge = new Gauge({
  name: "bot_ai_circuit_state",
  help: "AI per-model circuit breaker state (Phase 3): 0=closed, 1=half-open, 2=open",
  labelNames: ["model"] as const,
});

export const aiCircuitTransitionsCounter = new Counter({
  name: "bot_ai_circuit_transitions_total",
  help: "AI circuit breaker state transitions (Phase 3), by target state (bounded labels)",
  labelNames: ["model", "to_state"] as const,
});

export const activeUsersGauge = new Counter({
  name: "bot_active_users_total",
  help: "Total unique users who sent a message",
});

export const videoProcessingCounter = new Counter({
  name: "bot_video_processing_total",
  help: "Total video processing requests",
  labelNames: ["status"] as const,
});

export const videoProcessingDuration = new Histogram({
  name: "bot_video_processing_duration_seconds",
  help: "Video processing duration in seconds",
  buckets: [5, 10, 30, 60, 120, 300],
});

export const videoEnrichmentCounter = new Counter({
  name: "bot_video_enrichment_total",
  help: "Total video phrase enrichment attempts",
  labelNames: ["status"] as const,
});

export const wordPickCounter = new Counter({
  name: "bot_word_pick_total",
  help: "Word-picker set generations by outcome (generated / empty / failed)",
  labelNames: ["status"] as const,
});

export const wordPickEnrichmentCounter = new Counter({
  name: "bot_word_pick_enrichment_total",
  help: "Background enrichment attempts for entries saved from a word-picker set",
  labelNames: ["status"] as const,
});

export const updateHandlingDuration = new Histogram({
  name: "bot_update_handling_duration_seconds",
  help: "Time from update receipt to handler completion",
  labelNames: ["update_type"] as const,
  buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
});

export const updateDeliveryLag = new Histogram({
  name: "bot_update_delivery_lag_seconds",
  help: "Lag between the Telegram message timestamp and bot receipt (long-polling delivery delay)",
  buckets: [1, 2, 5, 10, 30, 60, 300],
});

export const sessionStorageDuration = new Histogram({
  name: "bot_session_storage_duration_seconds",
  help: "Postgres session storage operation duration",
  labelNames: ["op"] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
});

export const runnerDeathCounter = new Counter({
  name: "bot_runner_death_detected_total",
  help: "Times /livez detected a silently-dead grammY runner (poller stopped, process alive) — Phase 1a autoheal signal",
});

export const botBootCounter = new Counter({
  name: "bot_boot_total",
  help: "Bot process boots (incremented once at startup) — a rising rate signals a restart loop",
});

/**
 * OpenRouter key spend, polled from `GET /api/v1/key` (Task 78). Two gauges
 * rather than a pre-divided ratio, so the alert picks its own threshold and a
 * dashboard can show dollars; the division happens in PromQL. Both are absent
 * for a key with no spend limit — see `ai-credit.wiring.ts`.
 */
export const aiCreditUsageGauge = new Gauge({
  name: "bot_ai_credit_usage_usd",
  help: "OpenRouter key spend to date, in USD (Task 78) — absent when the key has no spend limit",
});

export const aiCreditLimitGauge = new Gauge({
  name: "bot_ai_credit_limit_usd",
  help: "OpenRouter key spend limit, in USD (Task 78) — absent when the key has no spend limit",
});

// ── HTTP server ──────────────────────────────────────────────────────

const METRICS_PORT = Number(process.env.METRICS_PORT) || 9090;

/**
 * Starts the metrics/health HTTP server and returns the handle so graceful
 * shutdown can close it (B12) — otherwise the open listener keeps the process
 * alive until SIGKILL.
 */
export function startMetricsServer(pingDb: () => Promise<void> = pingDatabase, port: number = METRICS_PORT): Server {
  // One boot per process start (this runs exactly once from main()); feeds a
  // later restart-loop alert built on the rate of this counter.
  botBootCounter.inc();

  const server = createServer(async (req, res) => {
    if (req.url === "/metrics") {
      res.setHeader("Content-Type", register.contentType);
      res.end(await register.metrics());
    } else if (req.url === "/healthz") {
      // Liveness: the process is up. Kept always-ok so a quiet period never
      // triggers a container restart — readiness is a separate signal.
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
    } else if (req.url === "/readyz") {
      // Readiness (T12): non-ok when long-polling is stuck or the DB is down.
      const result = await checkReadiness(pingDb);
      res.statusCode = result.status === "ok" ? 200 : 503;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(result));
    } else if (req.url === "/livez") {
      // Liveness for autoheal (Phase 1a): 503 only on a dead runner. DB-independent
      // by design so Neon serverless Postgres can auto-suspend between probes.
      const result = await checkLiveness();
      if (result.status === "ok") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ status: "ok" }));
      } else {
        // Edge-triggered (Phase 1a fast-follow): counts deaths, not probes-while-dead.
        if (result.isNewRunnerDeath) runnerDeathCounter.inc();
        res.statusCode = 503;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ status: "unhealthy", reason: result.reason }));
      }
    } else {
      res.statusCode = 404;
      res.end("Not Found");
    }
  });

  server.listen(port, () => {
    logger.info({ port }, "Metrics server started");
  });

  return server;
}

/**
 * Closes the metrics server on shutdown (B12). Resolves once the listener stops
 * accepting connections so the process can exit cleanly; a null handle (server
 * never started) resolves immediately.
 */
export function closeMetricsServer(server: Server | null): Promise<void> {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}
