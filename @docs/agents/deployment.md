# Deployment & Host Provisioning

Canonical, harness-neutral guidance for shipping Polyglot. There are **two
separate pipelines** — never conflate them.

## 1. App deploy (containers)

- File: `.github/workflows/deploy.yml`, triggered on push to `master`.
- Builds/pushes the Docker images and runs `docker compose up` on the VPS.
- Touches **containers only** — it never configures nginx, TLS, or host packages.
- Image names, ports, `NODE_ENV`, and `*_URL` values are **computed inside the
  workflow** from a few base secrets (`DOCKER_USERNAME`, the `*_DOMAIN`s, the
  commit SHA). Do not store them as standalone secrets.

### Build cache layout

Each Dockerfile owns a `type=gha` cache scope: `bot`, `admin-api`, `admin`, and
`landing` (the last with `mode=min` — it is a small static Astro build, and the
scopes share one 10 GB repo-wide Actions cache with `setup-node`'s pnpm cache in
`ci.yml`). Check `gh cache list` if builds start missing.

**The bot's two targets share `scope=bot`, and only `production` may write to
it.** `production` runs first and exports with `mode=max`, which carries
`base`/`deps`/`build` along because it resolves `COPY --from=build`. `migrate`
runs last and is `cache-from` only. Giving `migrate` a `cache-to` would write a
newer index that shadows production's on the next run, evicting the
`pnpm install --frozen-lockfile --prod` layer — the most expensive one in the
image — from the restorable set, while caching nothing of value in return
(`migrate` is `FROM build` plus three metadata-only layers).

Note what does **not** cache: `apps/admin/reports-data` is tracked and not in
`.dockerignore`, so it lands in two build contexts — `COPY apps/ apps/`
(`deploy/Dockerfile:30`, the bot's build stage) and `COPY apps/admin/ apps/admin/`
(`Dockerfile.admin:33`, where `astro build` actually pays for it). Its
`generatedAt` is pinned to the commit date (`scripts/test-catalog.mjs`) so the
context is stable for a given commit — but across commits the compile stages
still rebuild, which is correct, since the source changed too.

### Concurrency

`deploy.yml`'s `deploy` job and the whole of `deploy-monitoring.yml` share the
`vps-host` concurrency group: one mutex on the VPS Docker daemon, since both
touch the same host and `deploy.yml` has no `paths` filter. It sits on the job
rather than the workflow so the mutex is held for the ~2 min the host is busy,
not the ~8 min including `ci` and `push`.

`cancel-in-progress: false` protects the **running** deploy, but GitHub keeps at
most one **pending** run per group and a newer one evicts the older. Two
consequences worth knowing:

- Within `deploy.yml`, three merges in quick succession mean the middle commit
  never deploys on its own — it ships inside the third run's tree, and the
  release announcement then covers both.
- Across workflows, an evicted pending `deploy-monitoring` run is **not**
  absorbed: `deploy.yml` never deploys monitoring. The config change is lost and
  shows only as a `cancelled` row. Re-run it with `workflow_dispatch`.

`ci.yml` uses `cancel-in-progress: ${{ github.ref != 'refs/heads/master' }}`
rather than `true`. Inside a `workflow_call` invocation the `github` context
belongs to the **caller**, so a literal `true` would let a second merge cancel
the CI gate of an in-flight production deploy and kill the release.

## 2. Host provisioning (Ansible)

- Playbook: `deploy/ansible/site.yml`, run via the wrapper:

  ```bash
  pnpm ansible          # → scripts/run-ansible.sh → ansible-playbook site.yml
  ```

- The wrapper sources `.env.prod` (must exist locally) and requires
  `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` (a **path** to the private key file).
- Configures UFW, Docker, nginx reverse proxies, and certbot TLS.
- Each routing block is **gated by its domain env var** — the play degrades
  gracefully when one is unset:
  - admin needs **both** `ADMIN_PANEL_DOMAIN` and `ADMIN_API_DOMAIN`
  - Grafana needs `GRAFANA_DOMAIN`
  - landing needs `LANDING_DOMAIN` (optional `LANDING_WWW_DOMAIN`,
    `LANDING_PORT` defaults to `8080`)
  - any TLS needs `ACME_EMAIL`
- The landing site is a **separate** nginx vhost (`polyglot-landing`); admin
  routing is never touched by landing changes.

### Rules

- **Production provisioning is a manual, explicit step.** Agents must not run
  `pnpm ansible` against production without an explicit, separate user request
  for that exact action — same posture as `pnpm db:migrate`.
- **Confirm DNS first.** The target domain (and `www`) must resolve to the VPS
  before provisioning, or certbot fails and burns Let's Encrypt rate-limit
  quota. The playbook is idempotent; certs are guarded by certbot's `creates:`.
- Host routing/TLS is set up **once** per domain. After that, ordinary app
  deploys just swap the container — no re-run needed (certbot auto-renews).

## 3. GitHub Actions secrets

- Manage with `gh secret set <NAME>` (value via stdin, never on the CLI).
- Sync **infra/Ansible** vars from `.env.prod`:
  `VPS_HOST`, `VPS_USER`, `VPS_SSH_PORT`, `DEPLOY_USER_SSH_KEY`, `ACME_EMAIL`,
  `ADMIN_PANEL_DOMAIN`, `ADMIN_API_DOMAIN`, `GRAFANA_DOMAIN`, `LANDING_DOMAIN`,
  `LANDING_WWW_DOMAIN`.
- **Do not push** derived/generated vars (`*_IMAGE_NAME`, `*_PORT`, `NODE_ENV`,
  `ADMIN_PANEL_URL`, `PUBLIC_API_URL`) — the deploy workflow computes them.
- **`VPS_SSH_KEY` is special:** in `.env.prod` it is a file *path*, but the
  GitHub secret must hold the key *contents*. Set it manually and never sync it
  from `.env.prod`:

  ```bash
  gh secret set VPS_SSH_KEY < ~/.ssh/your_deploy_key
  ```

## 4. When to run these steps (code-change triggers)

Treat these as part of "done" — a related code change is **not complete** until
the matching step is handled. Surface it even when you cannot execute it.

- **Changed `deploy/ansible/**`, nginx routing, or added a domain/service that
  needs host routing** → host provisioning must be re-applied with
  `pnpm ansible`. The change is dormant until then. Production runs still need
  the explicit user go-ahead from §2 — do not silently apply to prod, but do
  flag that provisioning is required and confirm DNS first.
- **Added/changed an infra var in `.env.prod` that Ansible or the deploy
  workflow consumes** (see §3 for the synced set) → push it to GitHub with
  `gh secret set`, or CI/provisioning will run with stale values.
- **Changed only app code / containers** → nothing here applies; the normal
  app-deploy pipeline (§1) covers it. Do not run Ansible for app-only changes.

## 5. Deploy health gate & rollback (T13)

The app-deploy pipeline (§1) does **not** blindly declare success:

- **Health gate.** After `docker compose up -d`, the deploy script waits for each
  container's `docker inspect … .State.Health.Status` to become `healthy`
  (services without a healthcheck are skipped), then probes the bot's **`/readyz`**
  (T12) to confirm the DB is reachable and long-polling is live. A crash-loop or a
  failed readiness check makes the **workflow fail** (red) instead of silently
  shipping a broken release. The gate runs **before** image pruning, so a failed
  deploy leaves the previous image in place.
- **Rollback.** Before pulling new images, the script records the currently
  running image references to `/opt/polyglot/PREVIOUS_RELEASE`. Pruning uses
  `docker image prune -af --filter "until=168h"` (not `-af`), so the previous
  release image survives for **7 days from the moment it was built** — a bound,
  not a guarantee of "always". If more than a week passes between releases, the
  deploy that creates the need for a rollback is also the one that prunes its
  target. Pin the image by hand before a long gap, or pull the tag from Docker
  Hub, where it still exists.

  `deploy-monitoring.yml` prunes **dangling images only** for the same reason: it
  runs on the same daemon, and a host-wide `-a` prune there deleted the image
  this rollback depends on.

  **To roll back** (on the VPS):

  ```bash
  cd /opt/polyglot
  # Overlay the previous image tags onto the running env and restart.
  cat PREVIOUS_RELEASE >> .env
  docker compose up -d --remove-orphans
  ```

  Rollback reverts **app containers only**. The database schema is not rolled
  back — which is safe *only* if migrations followed the expand/contract rule
  below (old code keeps working against the newer schema).

## 6. Expand/contract migrations

`db:migrate` runs in CI on merge to `master` (CLAUDE.md Hard Rule #3), **before**
the new containers start. For the window between "schema migrated" and "new code
live", the **old** code runs against the **new** schema — a destructive change
(drop/rename column, tighten a constraint) is an instant incident there, and it
also breaks rollback.

Split every destructive schema change into backward-compatible steps across
**separate releases**:

1. **Expand** — add the new column/table/index; keep the old one. Deploy code
   that writes both (or reads new, falls back to old). Backfill data.
2. **Migrate reads** — once the new shape is populated, switch code to read it.
3. **Contract** — only in a *later* release, after the expand code is fully
   deployed and stable, drop the old column/constraint.

A single migration must never drop or rename something the currently-deployed
code still uses. Destructive migrations get an explicit compatibility review.

## 7. Monitoring image pins & nginx edge hardening (T20)

**Monitoring images are pinned** by patch tag in
`deploy/monitoring/docker-compose.monitoring.yml` (Grafana, Loki, promtail,
Prometheus, node-exporter, cadvisor). `docker compose pull` must never drag in a
new **major** — Loki changes its on-disk storage schema between majors and
Grafana changes provisioning. Bump a pin deliberately: read the release notes,
then update the tag in one commit.

**nginx is hardened** via provisioned includes (written by `site.yml`):

- `/etc/nginx/conf.d/polyglot-tls.conf` — **only** the TLS session cache
  (`ssl_session_cache shared:PolyglotSSL:10m`, timeout, tickets off), in the
  http context so the named shared-memory zone is defined exactly once. The
  protocol/cipher directives are deliberately **not** here: Ubuntu's stock
  `nginx.conf` already sets `ssl_protocols` and `ssl_prefer_server_ciphers` in
  the http context, so repeating them there is a duplicate-directive error
  (`nginx -t` emerg). They live in the per-server snippet below instead.
- `/etc/nginx/snippets/polyglot-hardening.conf` — Mozilla "intermediate" TLS
  (`TLSv1.2`/`TLSv1.3`, modern `ssl_ciphers`, `ssl_prefer_server_ciphers off`) +
  HSTS + `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
  `client_max_body_size`, proxy timeouts; `include`d per TLS `server` block.
  Server context **overrides** the stock http-level `ssl_protocols` /
  `ssl_prefer_server_ciphers` cleanly (no duplicate), and HSTS must not be
  emitted over plain HTTP. A full CSP is intentionally **not** set — a
  restrictive policy would break the Astro admin SPA and Grafana;
  `X-Frame-Options: SAMEORIGIN` covers clickjacking.
- `/etc/nginx/conf.d/polyglot-limits.conf` — `limit_req_zone` applied to
  `/api/auth/login` (5 r/min per IP), edge-level defense-in-depth in front of the
  app's own limiter (T05).

**Pre-TLS bootstrap (S10):** before a certificate exists, the admin panel, admin
API and Grafana vhosts return **503** on port 80 instead of proxying their login
UIs over plain HTTP. `certbot --nginx` layers the ACME HTTP-01 challenge on top,
then the TLS `server` blocks take over on the next provisioning pass. (The public
landing site has no login and keeps proxying during bootstrap.)

These are **provisioning** changes: they are dormant until `pnpm ansible` is
re-run against the host (subject to the explicit-prod rule in §Rules). Verify
after applying with `curl -I https://<domain>` (expect `Strict-Transport-Security`
and the security headers; no `TLSv1.0/1.1`).

## 8. Migration file hygiene (T26)

**`meta/_journal.json` is the source of apply order — the numeric filename is
not.** `drizzle-kit migrate` applies exactly the migrations listed in the
journal, in journal order, and ignores any `drizzle/*.sql` file that has no
journal entry. Consequences to keep in mind:

- Duplicate or gapped numbers are harmless as long as the journal is correct —
  `packages/adapters/db/drizzle/` legitimately has two `0017_*` tags (both in the
  journal) and no `0018`. Do **not** "fix" numbering by renaming applied files.
- A `.sql` file that is **not** in the journal is dead — it never applies. Such
  files are landmines when someone later assumes filename = order (or squashes
  history). The orphaned `0015_custom_notification_time.sql` (absent from the
  journal, and updating the long-since-renamed `notification_time` column) was
  removed under T26.
- **Never squash/rebuild migration history without rewriting seed migrations from
  the current `schema.ts`.** Old seeds reference columns valid only at their point
  in history — e.g. `0002_languages_metadata` still inserts `iso3_code`, which is
  correct only because `0007_drop_iso3_code` runs after it on a fresh DB. Replay
  them out of that order and `drizzle-kit migrate` fails with `42703 column … does
  not exist` (see CLAUDE.md Hard Rule #3).

Run `pnpm db:check` (safe on any branch) after touching migrations — it must
report "Everything's fine". Be precise about what it checks: it validates the
**migration folder and journal** for collisions and inconsistencies. It does
**not** compare `schema.ts` against the snapshots, and it is not a drift check —
a table added to `schema.ts` and present in no migration passes it, and so does
an unreachable `DATABASE_URL`, because it never opens a connection (it needs the
variable set only because `drizzle.config.ts` throws when it is absent).

Drift — "someone edited `schema.ts` and forgot `db:generate`" — is caught by the
**`Schema drift` step in `ci.yml`**, which re-runs `db:generate` and fails if
anything new appears under `packages/adapters/db/drizzle`. It asserts with
`git status --porcelain`, not `git diff`, because `db:generate` writes its new
`.sql` and `meta/*_snapshot.json` as **untracked** files that `git diff` cannot
see at all.

On `develop` use only `db:generate` + `db:push`; a true from-scratch `db:migrate`
replay is a CI-environment check, never a local one.
