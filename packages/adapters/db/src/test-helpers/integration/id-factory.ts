/**
 * Collision-safe unique Telegram id generator for the integration lane (Task 71).
 *
 * Every integration test provisions its OWN user through a fresh id (no shared
 * fixtures, no cleanup between tests), so ids must never collide — including
 * across the (≤2) parallel workers, each of which runs in its own process under
 * Vitest's fork pool. A per-process random base spreads workers into disjoint
 * numeric regions with overwhelming probability; a monotonic counter guarantees
 * uniqueness within a process. Values stay positive and well within
 * `Number.MAX_SAFE_INTEGER` (Telegram ids are numeric bigints).
 *
 * NOTE: A deliberate mirror of this helper lives at
 * `apps/bot/src/test-helpers/integration/id-factory.ts` for the bot e2e lane.
 * They are not shared because packages must not depend on apps, and because the
 * per-process module state is not shared across workers anyway — so a single
 * module would give no functional benefit over two identical ones.
 */

// A 23-bit random bucket mixed with the pid, scaled by 1e6 → up to ~8.3e12, which
// leaves a 1e6-wide lane for the counter. 8.3e12 + 1e6 is far below 2^53.
const BUCKET = ((process.pid & 0x7f_ffff) ^ Math.floor(Math.random() * 0x80_0000)) * 1_000_000;

let counter = 0;

/** Returns a unique, positive, safe-integer Telegram id for one test's user. */
export function uniqueTelegramId(): number {
  counter += 1;
  return BUCKET + counter;
}
