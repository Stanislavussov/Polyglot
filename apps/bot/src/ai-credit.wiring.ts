/**
 * Exports OpenRouter key spend as Prometheus gauges (Task 78).
 *
 * A gauge rather than a Loki rule on the provider's "Key limit exceeded" text:
 * the error text only exists once the outage has started, the gauge crosses its
 * threshold while translation still works.
 */

import { errorFields, logEvent } from "@polyglot/core";
import cron from "node-cron";
import { z } from "zod";
import { aiCreditLimitGauge, aiCreditUsageGauge } from "./metrics.js";

const AI_CREDIT_CRON = "*/5 * * * *";

const OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/key";

const FETCH_TIMEOUT_MS = 10_000;

/** `limit` is null for a key with no spend cap — see {@link applyKeyUsage}. */
const openRouterKeyUsageSchema = z.object({
  data: z.object({
    usage: z.number().nonnegative(),
    limit: z.number().positive().nullable(),
  }),
});

export type OpenRouterKeyUsage = z.infer<typeof openRouterKeyUsageSchema>["data"];

/** The subset of `fetch` this module uses, so tests need not stub the global. */
export type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
}>;

/**
 * A key with no spend limit withdraws both gauges instead of publishing a
 * placeholder: `limit = 0` would make the alert's ratio divide by zero, and
 * `Infinity` serialises as `+Inf` and poisons `sum()`.
 */
function applyKeyUsage(usage: OpenRouterKeyUsage): void {
  if (usage.limit === null) {
    aiCreditUsageGauge.remove();
    aiCreditLimitGauge.remove();
    logEvent("ai.credit.unlimited", { usage: usage.usage });
    return;
  }

  aiCreditUsageGauge.set(usage.usage);
  aiCreditLimitGauge.set(usage.limit);
  logEvent("ai.credit.polled", {
    usage: usage.usage,
    limit: usage.limit,
    ratio: Number((usage.usage / usage.limit).toFixed(4)),
  });
}

/**
 * Poll once and update the gauges. Returns null on any failure.
 *
 * A failed poll leaves the gauges untouched. An unreachable OpenRouter is what
 * coincides with a credit problem, so zeroing usage here would resolve the
 * alert that should be firing.
 */
export async function refreshAiCredit(
  apiKey: string,
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
): Promise<OpenRouterKeyUsage | null> {
  try {
    const response = await fetchImpl(OPENROUTER_KEY_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      logEvent("ai.credit.poll_failed", { status: response.status, statusText: response.statusText }, "warn");
      return null;
    }

    const parsed = openRouterKeyUsageSchema.parse(await response.json());
    applyKeyUsage(parsed.data);
    return parsed.data;
  } catch (err) {
    // Timeout abort, network error, or a response that no longer matches the
    // schema — all mean "no reading this cycle".
    logEvent("ai.credit.poll_failed", errorFields(err), "warn");
    return null;
  }
}

let creditTask: cron.ScheduledTask | null = null;

/** Idempotent, and a no-op without an API key so tests never reach the network. */
export function wireAiCreditPoll(): void {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    logEvent("ai.credit.poll_disabled", { reason: "no_api_key" });
    return;
  }

  if (creditTask) {
    logEvent("ai.credit.schedule_duplicate_ignored", {}, "warn");
    return;
  }

  creditTask = cron.schedule(AI_CREDIT_CRON, () => {
    void refreshAiCredit(apiKey);
  });

  // Poll immediately too, or the gauges are missing for five minutes after
  // every restart.
  void refreshAiCredit(apiKey);

  logEvent("ai.credit.scheduled", { schedule: AI_CREDIT_CRON });
}

export function stopAiCreditPoll(): void {
  if (creditTask) {
    creditTask.stop();
    creditTask = null;
    logEvent("ai.credit.poll_stopped", {});
  }
}
