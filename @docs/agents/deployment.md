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
  release image survives for at least a week.

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

- `/etc/nginx/conf.d/polyglot-tls.conf` — Mozilla "intermediate" TLS
  (`TLSv1.2`/`TLSv1.3`, modern ciphers, session cache), http-context so every
  TLS vhost inherits it.
- `/etc/nginx/snippets/polyglot-hardening.conf` — HSTS + `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`, `client_max_body_size`, proxy timeouts;
  `include`d per TLS `server` block (HSTS must not be emitted over plain HTTP). A
  full CSP is intentionally **not** set — a restrictive policy would break the
  Astro admin SPA and Grafana; `X-Frame-Options: SAMEORIGIN` covers clickjacking.
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
