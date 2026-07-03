/**
 * Lightweight HTTP server exposing Prometheus metrics on :9090/metrics
 * and a health endpoint on :9090/healthz.
 */
import { createServer } from "node:http";
import { logger } from "@polyglot/core";
import { Counter, collectDefaultMetrics, Histogram, register } from "prom-client";

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

// ── HTTP server ──────────────────────────────────────────────────────

const METRICS_PORT = Number(process.env.METRICS_PORT) || 9090;

export function startMetricsServer(): void {
  const server = createServer(async (req, res) => {
    if (req.url === "/metrics") {
      res.setHeader("Content-Type", register.contentType);
      res.end(await register.metrics());
    } else if (req.url === "/healthz") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
    } else {
      res.statusCode = 404;
      res.end("Not Found");
    }
  });

  server.listen(METRICS_PORT, () => {
    logger.info({ port: METRICS_PORT }, "Metrics server started");
  });
}
