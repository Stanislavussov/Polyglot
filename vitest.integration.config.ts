import { configDefaults, defineConfig } from "vitest/config";

/**
 * Integration test lane (Task 71).
 *
 * A second Vitest configuration that runs ONLY `*.integration.test.ts` files
 * against a real, ephemeral Postgres branch (provisioned on Neon). The base
 * `vitest.config.ts` excludes these files so `pnpm test` stays fast and
 * mock-only.
 *
 * Notes:
 * - The base `packages/core/src/test-setup.ts` is intentionally NOT wired here.
 *   That setup seeds the language registry from an in-memory array; this lane
 *   instead loads the registry from the migrated branch's `languages` rows in
 *   `test/integration/setup.ts` (last-writer-wins).
 * - `maxWorkers: 2` bounds connection fan-out (2 workers × postgres-js default
 *   pool max 10 = ≤20 connections) without touching production `connection.ts`.
 * - Compiled dist copies of the tests are excluded so they are never picked up.
 */
export default defineConfig({
  resolve: {
    alias: {
      // The harness answers API calls instantly via a fake fetch; the real
      // throttler's flood-limit pacing (~1 msg/sec per chat) would make the
      // multi-message e2e tests take minutes. See throttler-stub.ts.
      "@grammyjs/transformer-throttler": new URL(
        "./apps/bot/src/test-helpers/integration/throttler-stub.ts",
        import.meta.url,
      ).pathname,
    },
  },
  test: {
    globals: true,
    include: ["**/*.integration.test.ts"],
    setupFiles: ["./test/integration/setup.ts"],
    testTimeout: 30000,
    exclude: [...configDefaults.exclude, "**/.claude/**", "**/dist/**"],
    maxWorkers: 2,
  },
});
