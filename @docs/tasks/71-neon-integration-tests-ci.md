# Task 71 — Neon-branched real-database integration tests in CI

> **Status: PENDING APPROVAL** (plan approved by ralplan consensus 2026-07-05; execution not yet authorized)
>
> Consensus record: Planner draft → Architect `SOUND-WITH-CHANGES` → Critic `ITERATE` (1 major: workflow_call secret propagation) → revision → Architect `SOUND` → Critic `APPROVE` (iteration 2 of max 5).

---

## Context

Today the repo has ~150 Vitest files, all mock-only, running under a single root `vitest.config.ts`. Nothing exercises real Postgres, real committed migrations, or the real grammY dispatch path (`bot.handleUpdate`). This has let a recurring class of bug ship that mocks structurally cannot catch:

- SQL-level bugs (LIKE escaping, pagination ordering, unique-constraint upserts).
- Data-seed gaps (the `languages` table rows arrive only via a data-seed migration, invisible to unit tests).
- grammY session/callback lifecycle bugs — "session expired" on card buttons, translation-map eviction (`1e6407c`), the 48h edit-limit fallback (`d9b330f`), and the `/report` DI-injection regression (`3d78183`).

We add two real-DB test layers, provisioned on Neon's free plan via copy-on-write branches, run in CI on push/PR to `develop` and `master`, and auto-provisioned locally so no human ever hand-creates or rotates a `TEST_DATABASE_URL`.

## Work Objectives

1. A second Vitest lane (`*.integration.test.ts`, `pnpm test:integration`) against a real Postgres branch, leaving `pnpm test` fast and mock-only.
2. Fail-safe DB wiring: `TEST_DATABASE_URL` with **no fallback**, mapped to `DATABASE_URL` before the connection singleton loads.
3. Auto-provisioning of an ephemeral Neon branch — CI via the official actions, local via a wrapper script — with guaranteed teardown.
4. v1 coverage: key repository tests + e2e bot happy paths + session/callback regression tests, on a reusable grammY harness.
5. A CI `integration` job in `ci.yml` that (via `workflow_call` reuse in `deploy.yml`) blocks master deploy on failure — with secrets correctly propagated through `workflow_call`.

## Guardrails

**Must have**
- `pnpm test` unchanged in speed/behavior (integration files excluded by the base config).
- Setup fails fast if `TEST_DATABASE_URL` is unset — never falls back to `DATABASE_URL`.
- Every ephemeral branch is deleted, including on crash/`SIGINT` (trap), on CI failure, and on **mid-job `db:migrate` failure** (`if: always()`, delete-by-deterministic-name).
- Schema applied via `pnpm db:migrate` (the prod path), not `db:push`.
- The connection string (`db_url`) carries credentials: **passed only via env, never printed/echoed** in CI or the local script.
- No `any`; no logic in index files; new helpers are consumed (knip-clean); spec-first tests.
- **No production code change in this PR** — connection pool options stay untouched; fan-out is bounded at the test-runner layer.

**Must NOT have**
- No truncate/cleanup-between-tests code and no fixture seed files — tests arrange their own data through real repositories and use unique telegram IDs.
- **Parallel-lane isolation invariant: no test in the parallel lane may issue an unscoped mutation** (no table-wide `DELETE`/`UPDATE`/`TRUNCATE`). All writes are scoped to the test's own unique entity IDs.
- No testcontainers/pglite/docker.
- No persisted `TEST_DATABASE_URL` secret (branches are ephemeral → nothing to rotate).
- No change to the local/dev DB workflow: the ephemeral-branch `db:migrate` is the CI-applies-migrations posture, explicitly exempt from the "never `db:migrate` on develop" rule (which governs the local/dev DB only).

---

## RALPLAN-DR Summary

### Principles
1. **Fidelity over isolation tricks.** Tests run the real committed SQL migrations against real managed Postgres and the real grammY dispatch, catching what mocks cannot.
2. **Fail-safe by construction.** No env fallback, throwaway copy-on-write branches, always-delete — a run can never touch dev/prod and never persists a credential.
3. **Frictionless in both lanes.** One command auto-provisions locally and in CI; the base suite stays fast and mock-only.
4. **Prod parity.** Same Neon project, same migration path, same Node major (26), same real DB→language-registry path prod uses.
5. **Minimal blast radius.** v1 targets known-risk repositories and real past bugs; reuse the existing bot factory + DI container; zero production-code changes.

### Decision Drivers (top 3)
1. **Free-plan limits** (branch count ~10, finite compute hours) → ephemeral branches + serialized concurrency + guaranteed cleanup.
2. **Safety** (never hit dev/prod; never persist a credential) → no-fallback `TEST_DATABASE_URL` + empty copy-on-write `ci-base` + env-only `db_url`.
3. **Low maintenance burden** → auto-provisioning + ephemeral branches ⇒ zero secret rotation, zero fixture upkeep.

### Viable Options (locked choice vs. strongest rejected alternative)

**A. DB provisioning — Neon branching [LOCKED] vs. Testcontainers/pglite.**
- Neon: + prod parity (same managed engine/host class and version as prod, validates the exact deploy migration path *including data-seed migrations* like `languages`), + instant copy-on-write branches, + zero standing infra, + no Docker-in-CI. − network latency, − free-plan quotas, − external dep for local dev.
- Testcontainers/pglite: + hermetic/offline/unlimited. − proves less: no managed-Neon parity (pooler, version, host behavior differ), − does not validate the actual prod migration path, − adds Docker plumbing to CI and local.
- **Argued invalidation:** the goal is to validate the committed-SQL → real-managed-DB path prod deploys through, including data-seed migrations. Testcontainers cannot exercise that path, gives false confidence, and adds Docker infrastructure for less coverage. The decision is also user-locked.

**B. Schema application — `db:migrate` [LOCKED] vs. `db:push`.**
- `db:migrate`: + runs committed migrations (prod path), + applies data-seed migrations (`languages` rows). − slower.
- `db:push`: + fast, schema-from-source. − skips migration files and the `languages` seed → tests lack language rows and can't catch migration bugs.
- **Invalidation:** `db:push` seeds no data and bypasses the very path under test.

**C. CI concurrency bounding — global serialize [CHOSEN] vs. per-ref group.**
- Global serialize (`concurrency: neon-integration`, `cancel-in-progress: false`): + guarantees ≤1 ephemeral branch → safely under the ~10 cap; + also serializes the double-run-on-master (see Phase 6); simplest. − integration jobs queue on busy days.
- Per-ref group: + parallel PR feedback. − can approach the branch cap; leaked branches compound.
- **Rationale:** global serialize for a small team on the free plan; revisit if throughput hurts.

**D. Local provisioning transport — `neonctl` (pinned) [LOCKED] vs. Neon REST via `fetch`.**
- `neonctl`: + official, matches the CI actions, handles auth/URL retrieval. − extra `pnpm dlx` cold start; version drift risk → **pin the version; parse `--output json` defensively.**
- REST/fetch: + zero deps. − more code to maintain.
- **Rationale:** parity with the CI `create-branch-action`/`delete-branch-action`.

### ADR
- **Decision:** Real-DB integration tests on ephemeral Neon branches, migrated with `db:migrate`, in a dedicated Vitest lane + CI job, auto-provisioned in both CI and local dev, on Node 26.
- **Drivers:** free-plan limits; safety (no dev/prod contact, no persisted credential); low maintenance (no rotation/fixtures).
- **Alternatives considered:** testcontainers/pglite (rejected — no managed-Neon parity, adds Docker, proves less); `db:push` (rejected — no seed, no migration validation); per-ref concurrency (deferred — quota risk); REST transport (deferred — CLI parity preferred); modifying `connection.ts` pool `max` (rejected — no prod code in a test-infra PR).
- **Why chosen:** maximum prod fidelity at zero standing infra cost, with structural guarantees against touching dev/prod and against secret rotation.
- **Consequences:** tests depend on Neon availability and network; CI integration runs serialize; a one-time human Neon setup exists; the integration job runs twice per master push (accepted v1 cost, see Risks).
- **Follow-ups (non-goals below):** parallel-per-ref concurrency; deduping the double-run-on-master; a serial shard for unscoped/global-sweep tests; broader coverage; a scheduled leaked-branch pruner.

---

## Implementation Phases

### Phase 0 — One-time manual Neon setup (human, not code)
Separated deliberately: performed once by a human, out of band.
1. Create a Neon API key (Neon console → Account → API keys). Store as GitHub secret: `gh secret set NEON_API_KEY`.
2. Set `NEON_PROJECT_ID` (the existing prod project's ID). It is **non-sensitive** and may be a repo *variable* (`gh variable set NEON_PROJECT_ID`); if kept a secret instead, it must be declared in `workflow_call.secrets` (Phase 6). Pick one and be consistent across `ci.yml`/`deploy.yml`. This plan assumes **secret** for both, for a uniform pass-through (adjust to variable if preferred).
3. Create the permanent base branch from the prod branch: `neonctl branches create --project-id <id> --name ci-base --parent main`.
4. Empty it once (copy-on-write keeps it empty thereafter): connect to `ci-base`, run `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`.
5. Locally, developers put `NEON_API_KEY` and `NEON_PROJECT_ID` in `.env` (git-ignored) for the auto-provisioning script.

**Acceptance:** `ci-base` exists and is empty; a fresh child branch from it starts empty; both `NEON_API_KEY` and `NEON_PROJECT_ID` resolve in a workflow run.

### Phase 1 — Integration test lane infrastructure
**New files**
- `vitest.integration.config.ts` (root): `include: ['**/*.integration.test.ts']`; `setupFiles: ['test/integration/setup.ts']` — **note: the base `packages/core/src/test-setup.ts` is intentionally DROPPED from this lane** (see language-registry note below); `testTimeout: 30000`; `exclude: ['**/.claude/**', '**/dist/**']`; **`maxWorkers: 2`** to bound connection fan-out (2 workers × default pool max 10 = ≤20 connections; see Open Question #1). No `connection.ts` change.
- `test/integration/setup.ts`:
  - Fail fast if `!process.env.TEST_DATABASE_URL` (clear message; no fallback to `DATABASE_URL`).
  - Map `process.env.DATABASE_URL = process.env.TEST_DATABASE_URL`; set a fake `BOT_TOKEN` and `NODE_ENV='test'` **before** anything imports `connection.ts`/`config.ts`. (Verified: `getDb()` reads `DATABASE_URL` lazily at first call, `connection.ts:19` — setup-file ordering is sufficient.)
  - **Language registry (real DB→registry path):** call `loadLanguageCache()` against the migrated branch so the registry is populated from the seeded `languages` rows. `initLanguageRegistry` is **last-writer-wins** (clears + repopulates, no throw), so this lane's DB-sourced registry deliberately replaces the in-memory seed the base setup uses — do not silently reintroduce `packages/core/src/test-setup.ts` here.
  - Register a global teardown / `afterAll` calling `closeDb()` so workers exit cleanly.

**Changed files**
- Root `vitest.config.ts`: add `exclude: ['**/*.integration.test.ts']` so `pnpm test` stays mock-only.
- Root `package.json`: `"test:integration": "scripts/integration-test.sh"` (Phase 2 wrapper) and `"test:integration:run": "vitest run --config vitest.integration.config.ts"` (used when `TEST_DATABASE_URL` is already set; CI calls this directly).

**Acceptance:** with a valid `TEST_DATABASE_URL`, `pnpm test:integration:run` collects zero integration tests and exits green; unset → non-zero with a clear message; `pnpm test` count/time unchanged; the language registry in the integration lane is populated from the migrated branch.

### Phase 2 — Local auto-provisioning wrapper
**New file:** `scripts/integration-test.sh` (invoked by `pnpm test:integration`)

Design:
- **Escape hatch first:** if `TEST_DATABASE_URL` is set, `exec pnpm test:integration:run` and stop (supports local Postgres / pre-provisioned branch).
- **Provision:** else require `NEON_API_KEY` + `NEON_PROJECT_ID` (env or sourced `.env`); missing → exit 1 with remediation. Create a uniquely named branch from `ci-base`: `local/$(whoami)-$(date +%s)-$$` via a **pinned** `pnpm dlx neonctl@<pinned> branches create --parent ci-base --output json`; parse the connection string defensively; **use the DIRECT `db_url`, never the pooled one** (postgres-js prepared statements break under PgBouncer transaction pooling; DDL needs direct).
- **Migrate then test:** export `DATABASE_URL=<branch>`; run `pnpm db:migrate`; then export `TEST_DATABASE_URL=<branch>`; run `pnpm test:integration:run`. **Never `echo` the URL.** (Verified: `drizzle.config.ts:6` calls dotenv `config()` without `override`, so the exported branch URL wins over the dev `.env` value.)
- **Cleanup:** `trap cleanup EXIT INT TERM` deletes the branch unconditionally (`neonctl branches delete`), even on `db:migrate` or test failure or Ctrl-C. Exit code propagates from vitest.

**Failure modes handled**
- Missing `NEON_API_KEY`/`NEON_PROJECT_ID` → fail fast, remediation printed, no branch created.
- Branch creation fails (quota) → surface the neonctl error; no orphan.
- `neonctl` output shape drift → defensive JSON parse with a clear error if the URL field is absent.
- Runner `SIGKILL`/power loss → the one case the trap can't cover ⇒ mitigated by the timestamped `local/*` naming + `scripts/neon-prune.sh` (`pnpm neon:prune`) that lists/deletes `local/*` and `ci/*` branches older than N hours; bounded by the branch cap surfacing the leak loudly.
- **Rotation is a non-issue:** the branch — and its embedded credentials — exist only for the run and are destroyed on exit; nothing written to disk or CI secrets. The only durable secret is `NEON_API_KEY` (Phase 0), on the normal API-key cadence.

**`db:migrate`-rule note:** the script runs `db:migrate` against an *ephemeral CI-style branch* with `DATABASE_URL` pointed at that branch — the CI-applies-migrations posture the repo rule prescribes, distinct from the forbidden local/dev-DB migrate. Automated agents should not use this script as a substitute for the dev workflow; it is a test entrypoint.

**Acceptance:** with creds present, `pnpm test:integration` provisions → migrates → runs → deletes (verify no residual branch via `neonctl branches list`); with `TEST_DATABASE_URL` preset it bypasses Neon; with creds absent it fails fast; the URL never appears in output.

### Phase 3 — Repository integration tests + isolation helper
**New files**
- `apps/bot/src/test-helpers/integration/id-factory.ts`: `uniqueTelegramId(): number` — high-entropy base + monotonic counter, collision-safe across ≤2 parallel workers (each test its own user). No `any`.
- Colocated `*.integration.test.ts` beside each repository under `packages/adapters/db/src/**` (user, vocabulary, bot-session).

**Scope clarification — "retention" here means entity-scoped, per-user vocabulary retention ONLY.** The global time-ranged sweep in `packages/adapters/db/src/retention.ts` (an **unscoped** `DELETE ... WHERE < cutoff`) is **excluded** from the parallel lane because it would violate the no-unscoped-mutation invariant. Any future test of the global sweep goes to a dedicated serial shard (follow-up, not v1).

**Test specification (spec-first)**
- **User repository** (`user-repository.integration.test.ts`)
  - upsert on an unseen telegram id creates a row with expected defaults.
  - upsert on an existing telegram id updates mutable fields, does not duplicate (unique constraint holds), preserves `createdAt`.
  - lookup by unknown telegram id → null/undefined.
- **Vocabulary repository** (`vocabulary-repository.integration.test.ts`)
  - save persists and is retrievable by user + word.
  - pagination: insert N (scoped to one test user), page size K → correct non-overlapping slices, stable ordering.
  - **LIKE escaping:** arrange entries containing literal `%`/`_` for the test's own user; a search containing those chars matches only intended rows (fails if escaping is dropped).
  - **per-user retention:** the entity-scoped retention rule keeps/prunes that user's entries correctly — all mutations scoped to the test's user id.
  - duplicate word for the same user handled per the repository's contract (upsert/unique).
- **Bot-session repository / Postgres session storage** (`session-storage.integration.test.ts`)
  - read of a missing key → undefined; write→read round-trips; overwrite updates; delete removes (all on unique keys).
  - **translation-map eviction by monotonic insertion timestamp** (regression `1e6407c`): fill past capacity → oldest inserted evicted, a still-valid recent entry NOT prematurely expired.

**Acceptance:** all repository integration tests pass against a fresh branch, are order-independent under `maxWorkers: 2`, share no seeded fixtures, and issue no unscoped mutations.

### Phase 4 — grammY e2e harness + happy-path tests
**New files**
- `apps/bot/src/test-helpers/integration/bot-harness.ts`: builds the bot through the real `createPolyglotBot({ token, sessionStorage, services })` with a fake `BOT_TOKEN` and the **real** Postgres `session-storage`; presets `bot.botInfo` (so `bot.init()` is unnecessary); installs an outbound API transformer that intercepts every Telegram call, records it, and returns a plausible fake response (`sendMessage` → `{ message_id, … }`, `editMessageText` → `true`).
  - **AI mock via DI override (not `vi.mock`):** `const services = createContainer(); services.ai = deterministicMock;` and pass `services` into `createPolyglotBot({ services })`. Seam verified at `bot-factory.ts:196`; handlers consume via `ctx.services.ai`. Betterstack telemetry stubbed the same DI way. Everything else — handlers → services → repositories → DB — stays real. (Verified: auth middleware get-or-creates users, no allowlist — synthetic telegram IDs are accepted and provisioned.)
  - Exposes `dispatch(update)` → `bot.handleUpdate(update)`, update builders (`messageUpdate`, `callbackQueryUpdate`), and a `sent` capture buffer.
- `apps/bot/src/**/onboarding.integration.test.ts`, `translate-flow.integration.test.ts`.

**Test specification**
- **/start onboarding:** dispatch `/start` from a brand-new telegram user → a user row is created (assert via the real repo) and an onboarding `sendMessage` is captured with the expected text/keyboard; a second `/start` does not duplicate the user.
- **Translate flow:** dispatch a plain text message from an onboarded user → the DI-injected deterministic AI returns a translation → a vocab entry is persisted (assert via repo) → the reply `sendMessage` carries the translation and the inline card keyboard.

**Middleware note:** the harness runs the real middleware stack. `@grammyjs/runner` is not involved (`handleUpdate` called directly). `auto-retry` never triggers (the mock transformer always succeeds); `transformer-throttler` is inert with instant fake responses; `sequentialize`/`conversations` exercise the real Postgres session storage (also covering the `/report` DI regression `3d78183`). The factory is unchanged — the harness only adds the mock transformer + `botInfo` + the DI `services` override.

**Acceptance:** both e2e happy paths pass, asserting both the DB side effect and the captured outbound Telegram payload; no `vi.mock` used for the AI/telemetry boundary.

### Phase 5 — Session / callback regression e2e tests
**New file:** `apps/bot/src/**/callback-regressions.integration.test.ts`
- **"session expired":** produce a card with buttons via a message, then dispatch a `callbackQuery` on that button in a separate update sharing the session key → the handler resolves the session/translation-map entry (no "session expired" reply) and performs the action, capturing `editMessageText`.
- **translation-map eviction end-to-end:** drive multiple messages to overflow the map → oldest evicted; a recent entry's button still resolves (guards `1e6407c` at the dispatch level).
- **48h edit limit (`d9b330f`):** configure the mock transformer to return Telegram's "message to edit not found" for `editMessageText` → assert the edit-message helper falls back to `sendMessage` rather than throwing.

**Acceptance:** all three regression scenarios pass and would fail against the pre-fix behavior; all mutations scoped to per-test unique IDs.

### Phase 6 — CI integration job, secret propagation, Node bump, docs
**Changed files**
- `.github/workflows/ci.yml`:
  - Add the `integration` job (sketch below).
  - **Declare the new secrets in `workflow_call.secrets`** (currently only `DOCKER_USERNAME`/`DOCKER_TOKEN` at `ci.yml:8-14`): add `NEON_API_KEY` (required) and `NEON_PROJECT_ID` (required if kept a secret; omit if made a repo variable).
  - **Bump `node-version: 24 → 26`** in the existing `check` job's `setup-node` (prod parity: `.nvmrc` = 26, all `deploy/Dockerfile*` use `node:26-alpine`; the workflows at 24 were consistent with a stale value). Flag in the PR description as intentional prod-parity, not scope creep.
- `.github/workflows/deploy.yml`:
  - **Pass the new secrets through the `workflow_call`** (currently passes only `DOCKER_USERNAME`/`DOCKER_TOKEN` at `deploy.yml:17-20`). **Use explicit pass-through, not `secrets: inherit`**, for auditability — matches the existing `DOCKER_*` pattern:
    ```yaml
    secrets:
      DOCKER_USERNAME: ${{ secrets.DOCKER_USERNAME }}
      DOCKER_TOKEN: ${{ secrets.DOCKER_TOKEN }}
      NEON_API_KEY: ${{ secrets.NEON_API_KEY }}
      NEON_PROJECT_ID: ${{ secrets.NEON_PROJECT_ID }}
    ```
    Repo secrets do **not** flow through `workflow_call` automatically; without this, the integration job would receive an empty `NEON_API_KEY` only on the master deploy path and break every deploy.
  - **Bump `node-version: 24 → 26`** in the `setup-node` step here too.
- `CHANGELOG.md`: entry under `## [Unreleased]`.
- `@docs/tasks/71-neon-integration-tests-ci.md`: this spec.
- `pnpm test:catalog` artifacts regenerated and committed (test files changed).

**Double-run-on-master (accepted v1 cost):** on a master push, `ci.yml` runs standalone (its own `push` trigger) **and** again via `deploy.yml`'s `workflow_call` — so the `integration` job runs **twice per master push** (the existing `check` job already behaves this way). The global `concurrency: neon-integration` group serializes the two runs so they never exceed one ephemeral branch at a time. The 2× compute/branch churn is **explicitly accepted for v1**; deduping is a follow-up, not v1.

**CI `integration` job sketch**
```yaml
  integration:
    runs-on: ubuntu-latest
    concurrency:
      group: neon-integration          # global serialize → ≤1 ephemeral branch (free-plan safe)
      cancel-in-progress: false
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 26, cache: pnpm }   # prod parity (.nvmrc=26, node:26-alpine)
      - run: pnpm install --frozen-lockfile
      - name: Create Neon branch
        id: neon
        uses: neondatabase/create-branch-action@<pinned-sha-or-tag>   # verify input/output names at impl
        with:
          project_id: ${{ secrets.NEON_PROJECT_ID }}
          parent: ci-base
          branch_name: ci/${{ github.run_id }}-${{ github.run_attempt }}
          api_key: ${{ secrets.NEON_API_KEY }}
      - name: Apply migrations (prod path)
        run: pnpm db:migrate
        env:
          DATABASE_URL: ${{ steps.neon.outputs.db_url }}          # DIRECT url (never pooled); env-only, never echoed
      - name: Integration tests
        run: pnpm test:integration:run
        env:
          TEST_DATABASE_URL: ${{ steps.neon.outputs.db_url }}     # DIRECT url; env-only
      - name: Delete Neon branch
        if: always()                                              # deletes even if db:migrate failed mid-job
        uses: neondatabase/delete-branch-action@<pinned-sha-or-tag>
        with:
          project_id: ${{ secrets.NEON_PROJECT_ID }}
          branch: ci/${{ github.run_id }}-${{ github.run_attempt }}   # deterministic name → delete-by-name is outcome-independent
          api_key: ${{ secrets.NEON_API_KEY }}
```
> The exact action input/output identifiers (`db_url` vs. pooled variants, `project_id` vs `project-id`, etc.) **must be verified against the pinned action version at implementation time** — pin by tag/SHA and use the DIRECT connection output only.

**Acceptance:**
- Direct-trigger green: the `integration` job runs on push/PR to develop and master, provisions → migrates → tests → deletes (even on `db:migrate` failure), and a red job fails the workflow.
- **Deploy-path green (mandatory, distinct sub-criterion):** on the first master push (or a `workflow_dispatch` of `deploy.yml`), confirm the `integration` job invoked *via `deploy.yml`'s `workflow_call`* resolves `NEON_API_KEY`/`NEON_PROJECT_ID` (non-empty), provisions, migrates, tests, and deletes. The direct-trigger green alone does **not** count as done.
- No branch leaks after either path (`neonctl branches list` shows only `ci-base`).
- Full local quality gate passes: `pnpm build && pnpm lint && pnpm lint:deps && pnpm lint:knip && pnpm test && pnpm db:push`.

---

## Risks & Mitigations
- **Free-plan branch cap (~10):** global `concurrency: neon-integration` guarantees ≤1 CI ephemeral branch (and serializes the double-run-on-master); local branches are per-run trap-deleted; `scripts/neon-prune.sh` sweeps stragglers. `ci-base` is permanent and counts as one.
- **Compute-hour budget & 2× master churn:** branches are short-lived and auto-suspend; the base suite stays mock-only. The double-run-on-master (2× branch/compute per master push) is accepted for v1 and bounded by serialization; dedupe is a follow-up.
- **`workflow_call` secret propagation (was a MAJOR blocker in review):** repo secrets do NOT flow through `workflow_call` automatically. Mitigated by declaring `NEON_API_KEY`/`NEON_PROJECT_ID` in `ci.yml`'s `workflow_call.secrets` **and** explicitly passing them from `deploy.yml`; validated by the deploy-path acceptance sub-criterion.
- **Secret hygiene:** `db_url` contains credentials — passed only via `env:`/exported shell vars, never `echo`/printed, in both CI and the local script. GitHub masks step secrets, but the plan mandates "do not print the URL" regardless.
- **Partial-failure teardown:** `branch_name`/`branch` is the deterministic `ci/${run_id}-${run_attempt}`, so the `if: always()` delete-by-name succeeds regardless of whether `db:migrate` or the test step failed mid-job.
- **Pooled vs. direct connection:** always use the DIRECT `db_url`; postgres-js prepared statements break under PgBouncer transaction pooling and DDL (`db:migrate`) needs a direct connection.
- **Connection fan-out:** bounded at the runner (`maxWorkers: 2`) rather than by touching `connection.ts` (which calls `postgres(url)` with no options, default `max=10`) — keeping prod code out of a test-infra PR. Worst case ≤20 connections.
- **`getDb` singleton + env-mapping order:** `test/integration/setup.ts` maps `TEST_DATABASE_URL → DATABASE_URL` (and sets `BOT_TOKEN`/`NODE_ENV`) in a setup file that completes before any test module imports `connection.ts`/`config.ts`; the singleton reads the branch URL lazily on first `getDb()` (verified, `connection.ts:19`). Global teardown calls `closeDb()`.
- **Language registry last-writer-wins:** the integration lane drops the in-memory base seed and loads the registry from the migrated branch; documented so a future setup change doesn't silently reintroduce the mock seed.
- **grammY middleware in tests:** the mock transformer short-circuits outbound calls so `auto-retry` never fires and `throttler` is inert; `runner` is bypassed; real `sequentialize`/`conversations`/session storage are exercised.
- **`db:migrate`-rule confusion:** ephemeral-branch migration is the prescribed CI-applies-migrations posture, distinct from the forbidden local/dev-DB `db:migrate`.
- **Leaked branches from crashed runners:** CI `delete-branch-action` under `if: always()` covers job failure; local `trap … EXIT INT TERM` covers most exits; `SIGKILL`/power loss swept by `neon:prune` and bounded by the cap.

## Open Questions (executor-time confirmations, not blockers)
1. **Neon free-tier compute `max_connections` vs. workers × pool.** `maxWorkers: 2` × default `max=10` = ≤20 connections. Verify on the first CI run; lower `maxWorkers` if the tier caps below ~20. Close by observation, don't leave open indefinitely.
2. **Pinned Neon action contracts.** Verify `create-branch-action`/`delete-branch-action` input and output names at the pinned version (direct `db_url` output identifier; `project_id`/`branch_name`/`api_key` spellings).
3. **`NEON_PROJECT_ID` as secret vs. repo variable.** Non-sensitive; a variable avoids the `workflow_call.secrets` declaration but must then be referenced as `vars.` everywhere. Decide once and apply uniformly.
4. **`neonctl` pinned version & JSON output shape** for the local script's defensive connection-string parse.
5. **Exact repository module paths/method names** for user/vocabulary/bot-session repos — confirm signatures before writing assertions (design-neutral).
6. **Per-user vocabulary retention semantics** — confirm the actual rule the repository implements before writing the entity-scoped retention test.

## Non-Goals (v1)
- No testcontainers/pglite/local-docker path (Neon only).
- No exhaustive repository coverage — only user, vocabulary, bot-session.
- **No tests of the global/unscoped retention sweep** (`packages/adapters/db/src/retention.ts`) in the parallel lane — deferred to a future serial shard.
- No admin-panel or landing e2e; bot only.
- No production code changes — `connection.ts` pool options untouched; fan-out bounded at the runner.
- No dedupe of the double-run-on-master; no parallel-per-ref CI concurrency.
- No load/performance testing.
- No scheduled/cron leaked-branch pruner beyond the manual `neon:prune` helper.
- No new production migrations or schema changes.
- No change to the app-deploy or host-provisioning pipelines beyond the `integration` job (gating deploy via existing `workflow_call` reuse), the secret pass-through, and the Node 24→26 bump.
