/**
 * Integration-lane setup (Task 71).
 *
 * Runs once per test worker BEFORE any test module is imported. Responsibilities:
 *
 * 1. Fail fast if `TEST_DATABASE_URL` is unset — the integration lane must run
 *    against a real, ephemeral Postgres branch and NEVER falls back to
 *    `DATABASE_URL` (a fallback could point tests at dev/prod).
 * 2. Map `TEST_DATABASE_URL → DATABASE_URL` (and set a fake `BOT_TOKEN` +
 *    `NODE_ENV=test`) before anything imports `connection.ts` / `config.ts`.
 *    `getDb()` reads `DATABASE_URL` lazily on first call, so setting it here —
 *    before the first test module loads — is sufficient.
 * 3. Load the language registry from the migrated branch's seeded `languages`
 *    rows (the real DB→registry path prod uses), replacing the in-memory seed
 *    that the base `test-setup.ts` would otherwise install.
 * 4. Close the connection pool after the worker's tests finish so it exits
 *    cleanly.
 */
import { closeDb, loadLanguageCache, planFeatureAccessRepository } from "@polyglot/adapter-db";
import { afterAll } from "vitest";
import { DEFAULT_PLAN_CATALOG } from "../../apps/admin-api/src/plan-catalog.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error(
    [
      "TEST_DATABASE_URL is not set.",
      "The integration lane runs against a real, throwaway Postgres and never falls back to DATABASE_URL.",
      "Export TEST_DATABASE_URL pointing at a migrated+seeded database (CI uses a service container;",
      "locally see `pnpm test:integration` for a docker one-liner or the optional Neon-branch lane).",
    ].join(" "),
  );
}

// Map the branch URL onto DATABASE_URL before the connection singleton loads.
process.env.DATABASE_URL = testDatabaseUrl;
// The bot config schema requires BOT_TOKEN; a fake value is fine (no real API calls).
process.env.BOT_TOKEN ??= "TEST:INTEGRATION_FAKE_TOKEN";
process.env.NODE_ENV = "test";

// Populate the in-memory language registry from the migrated branch's `languages`
// rows. This deliberately replaces the base in-memory seed (last-writer-wins).
await loadLanguageCache();

// Re-assert the default tier matrix's feature junction. The seed is
// bootstrap-only (the admin panel owns `plan_feature_access` once a plan row
// exists), so a warm database — the supplied and Neon lanes — keeps whatever
// the panel last wrote there, and the gate tests that put users on plus/pro
// assume the catalog's matrix. Test-only hermeticity, deliberately NOT part of
// the seed. Compare-first so the common already-correct case writes nothing;
// on a genuinely divergent DB two workers may race the same delete+insert, so
// a loser whose write collided is fine as long as the target set landed.
for (const { name, features } of DEFAULT_PLAN_CATALOG) {
  const target = [...features].sort().join();
  if ((await planFeatureAccessRepository.findFeaturesForPlan(name)).sort().join() === target) continue;
  try {
    await planFeatureAccessRepository.setFeaturesForPlan(name, features);
  } catch (err) {
    if ((await planFeatureAccessRepository.findFeaturesForPlan(name)).sort().join() !== target) throw err;
  }
}

afterAll(async () => {
  await closeDb();
});
