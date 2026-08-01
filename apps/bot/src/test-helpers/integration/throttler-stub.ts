/**
 * Pass-through stand-in for `@grammyjs/transformer-throttler` in the integration
 * lane (aliased in `vitest.integration.config.ts`).
 *
 * The real throttler paces outbound calls against Telegram's flood limits
 * (~1 msg/sec per chat). The harness's fake fetch answers instantly and no real
 * API is involved, so that pacing only slows the lane down — the eviction e2e
 * test alone sends 31 same-chat translations, which would take minutes and trip
 * the 30s test timeout.
 */
import type { Transformer } from "grammy";

export function apiThrottler(): Transformer {
  return (prev, method, payload, signal) => prev(method, payload, signal);
}
