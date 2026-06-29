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
