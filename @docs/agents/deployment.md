# Deployment Rules

Two pipelines, never conflated.

## App deploy — `.github/workflows/deploy.yml`

- Push to `master` → production VPS; push to `develop` → dev VPS. Containers only — never
  nginx, TLS or host packages. Order: CI → images → migrate → seed → data steps → `up -d`
  → health gate.
- Branch selects the GitHub environment. `production` has no secrets of its own (inherits
  repository secrets); `development` overrides only what differs, under the same names.
- Image names, ports, `NODE_ENV` and `*_URL` are computed in the workflow. Never store them
  as secrets.
- Dev DB: each dev deploy cuts Neon branch `dev/<sha>` from production, migrates it, and
  deletes older `dev/*` after success. Never `db:push` into that branch — the same deploy's
  migrate then fails with `42P07`. Dev also deletes the accounts in `DEV_RESET_USERS`
  (refuses unless `POLYGLOT_ENV=development`).
- Health gate: every container must reach `healthy` and bot `/readyz` must pass, before
  image pruning. A failure turns the workflow red and leaves the previous image.
- Rollback (VPS, app containers only):
  `cd /opt/polyglot && cat PREVIOUS_RELEASE >> .env && docker compose up -d --remove-orphans`.
  Prune keeps images 7 days; `deploy-monitoring.yml` prunes dangling images only.
- Concurrency: prod `deploy` job and `deploy-monitoring.yml` share `vps-host`; dev uses
  `vps-host-dev`. A newer pending run evicts an older one — an evicted `deploy-monitoring`
  run is lost; re-run it via `workflow_dispatch`. `ci.yml` must never cancel in-progress on
  `master`.
- Build cache: the bot's `production` target alone writes `scope=bot`; `migrate` is
  `cache-from` only.

## Migrations

- **Expand/contract.** Migrations run before new containers start, so old code runs on the
  new schema and rollback depends on it. Never drop, rename or tighten anything deployed
  code still uses: add → switch reads → contract in a later release.
- `meta/_journal.json` is the apply order, not filenames. Never renumber applied files; a
  `.sql` absent from the journal never runs.
- Never squash history without rewriting seed migrations from the current `schema.ts`.
- `pnpm db:check` validates the journal only — not drift, never connects. Drift is caught
  by CI's `Schema drift` step.

## Data changes ride the deploy

A change that repairs or backfills rows is done when it applies itself to both databases
without anyone running anything.

1. A compiled CLI `apps/bot/src/<name>.cli.ts` (listed in `knip.json` entries), invoked in
   `deploy.yml` after the seed with
   `docker compose run --rm --no-deps bot node apps/bot/dist/<name>.cli.js`. Never a
   `pnpm` script run from a laptop.
2. Unconditional — never gated on `DEPLOY_ENV`. Develop rehearses what master runs.
3. Idempotent in the data (a predicate that stops matching, `onConflictDoNothing`), never a
   marker table or flag. It re-runs every deploy.
4. Additive and safe against the old image still serving.
5. Proved in `packages/adapters/db/src/__tests__/*.integration.test.ts`: what it restores,
   what it leaves alone, and that a second run writes nothing.
6. Removal condition written in the file header and CHANGELOG entry.

## Host provisioning — `deploy/ansible/site.yml`

- `pnpm ansible` (prod, `.env.prod`) / `pnpm ansible:dev` (`.env.dev`). Requires `VPS_HOST`,
  `VPS_USER`, `VPS_SSH_KEY` (a path). Read the printed `[env] user@host` — the env file is
  the only thing selecting the host.
- Configures UFW, Docker, nginx, certbot. Each vhost is gated by its domain var (admin needs
  both `ADMIN_PANEL_DOMAIN` and `ADMIN_API_DOMAIN`; TLS needs `ACME_EMAIL`).
- Apply to dev first. Production only on an explicit, separate user request. Confirm DNS
  resolves first — certbot failures burn Let's Encrypt quota.
- Changed `deploy/ansible/**` or nginx → dormant until re-applied; say so. App-only changes
  never need Ansible.
- Monitoring images are pinned by patch tag; bump deliberately after reading release notes.
- No CSP header (it breaks the admin SPA and Grafana); ciphers/protocols live in the
  per-server snippet, not http context (duplicate-directive error).

## Secrets

- `gh secret set <NAME>` with the value on stdin. Dev: `--env development`, same names;
  `scripts/sync-dev-secrets.sh` pushes the dev set. Never rename repository-level secrets.
- Infra vars from `.env.prod` that Ansible or the workflow consumes must be pushed, or CI
  runs stale: `VPS_HOST`, `VPS_USER`, `VPS_SSH_PORT`, `DEPLOY_USER_SSH_KEY`, `ACME_EMAIL`,
  `ADMIN_PANEL_DOMAIN`, `ADMIN_API_DOMAIN`, `GRAFANA_DOMAIN`, `LANDING_DOMAIN`,
  `LANDING_WWW_DOMAIN`.
- `VPS_SSH_KEY` holds key contents in GitHub but a path in `.env.prod` — set it manually:
  `gh secret set VPS_SSH_KEY < ~/.ssh/<deploy_key>`.
