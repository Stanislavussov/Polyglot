# Task 64 — Application Clustering (Admin API, Admin, Bot)

**Status:** 🔲 To Do  
**Category:** DevOps / Architecture — High  
**Blocks:** Independent scaling, selective deployment, team separation of concerns  
**Last verified:** 2026-06-14  

---

## Goal

Group the Polyglot applications into logical clusters that can be deployed, scaled, and managed independently. The current `docker-compose.yml` defines all services together, which means every deploy restarts every container even when only one app changed. By clustering Admin API + Admin panel into a "management cluster" and the Bot into a "core cluster" (and later the notification scheduler into its own cluster), we gain faster deploys, safer rollbacks, and clearer team ownership.

## Current State

- `deploy/docker-compose.yml` defines bot, admin-api, admin, and migrate in a single file
- All services share the same network, env file, and deploy lifecycle
- GitHub Actions deploy workflow builds and pushes all four images on every `master` push
- VPS deploy script runs `docker compose up -d` which restarts every service
- There is no way to deploy only the bot, or only the admin panel, without touching the others

## Required Behavior

### 1. Cluster Definitions

Define three logical clusters:

- **Core Cluster** — `bot` (Telegram bot, long-polling, user-facing)
- **Management Cluster** — `admin-api` + `admin` (internal admin panel and its API)
- **Data Cluster** — `migrate` + (future) `scheduler` (database migrations, background jobs)

Each cluster gets its own Docker Compose file and can be deployed independently.

### 2. Shared Infrastructure

Services that all clusters need must be extracted into a shared compose file:

- `deploy/docker-compose.shared.yml` — defines networks, volumes, and any future shared services (e.g., Redis, RabbitMQ)
- Each cluster compose file extends the shared file via `include` or Docker Compose `extends`

### 3. Independent Deploy Scripts

- `deploy/scripts/deploy-core.sh` — deploys only the bot cluster
- `deploy/scripts/deploy-management.sh` — deploys only the admin-api + admin cluster
- `deploy/scripts/deploy-data.sh` — runs migrations and background jobs
- `deploy/scripts/deploy-all.sh` — convenience wrapper that runs all three in order

### 4. CI/CD Pipeline Changes

- GitHub Actions `deploy.yml` should support cluster-specific deploys
- New workflow input: `cluster` (all | core | management | data)
- Default push to `master` still deploys `all` (for safety)
- Image build step should be conditional: only build images for the selected cluster
- VPS deploy script should be cluster-aware and only restart the relevant containers

### 5. Environment Isolation

Clusters must be composable with environments (Task 62):

- `deploy/docker-compose.prod.core.yml` — production bot cluster
- `deploy/docker-compose.prod.management.yml` — production admin cluster
- `deploy/docker-compose.dev.core.yml` — development bot cluster
- etc.

Alternatively, use a single file per environment with Docker Compose profiles:
- `docker-compose.yml` with profiles `core`, `management`, `data`
- `docker compose --profile core up -d` deploys only bot services

### 6. Service Dependencies & Health Checks

- `admin` depends on `admin-api` (current behavior) — keep this within the management cluster
- `bot` has no hard dependencies (connects to external DB) — core cluster is self-contained
- `migrate` must run before any cluster starts, but should not block other clusters
- Each cluster should have its own health check aggregation

## Acceptance Criteria

### Compose Files
- [ ] `deploy/docker-compose.shared.yml` exists with shared networks and volumes
- [ ] `deploy/docker-compose.core.yml` exists with bot service (and metrics if needed)
- [ ] `deploy/docker-compose.management.yml` exists with admin-api and admin services
- [ ] `deploy/docker-compose.data.yml` exists with migrate service (and future scheduler)
- [ ] `deploy/docker-compose.yml` (legacy) is removed or becomes a symlink to the new structure
- [ ] All compose files are validated with `docker compose config` (no errors, no missing env vars)

### Deploy Scripts
- [ ] `deploy/scripts/deploy-core.sh` deploys only the bot cluster
- [ ] `deploy/scripts/deploy-management.sh` deploys only the admin cluster
- [ ] `deploy/scripts/deploy-data.sh` runs migrations
- [ ] `deploy/scripts/deploy-all.sh` runs all three in the correct order
- [ ] All scripts accept an environment argument (`production`, `development`, `testing`)
- [ ] All scripts fail fast on missing env vars or invalid arguments

### CI/CD
- [ ] `.github/workflows/deploy.yml` has a `cluster` input for manual dispatch
- [ ] Default `master` deploy still deploys all clusters (backward compatibility)
- [ ] Image build matrix is conditional (only build bot image for core deploy, etc.)
- [ ] VPS deploy step uses the correct compose file and script per cluster

### Documentation
- [ ] `docs/deployment-checklist.md` updated with cluster-specific steps
- [ ] `@docs/tech-reqs/12-deployment.md` updated with cluster architecture diagram
- [ ] `README.md` updated with cluster-specific commands
- [ ] New `deploy/scripts/README.md` explains each script and when to use it

### Backward Compatibility
- [ ] Existing `pnpm docker:up` and `docker compose` commands still work (or are deprecated with clear messaging)
- [ ] Old `deploy/docker-compose.yml` is preserved as a symlink or deprecated warning until all docs are updated

## Dependencies

- Task 62 (Separate Deployment Environments) — clusters must be environment-aware
- Task 63 (Parameterize Bot by Environment) — core cluster bot needs env identity
- Task 56 (Docker Compose Build) — existing compose files are the starting point

## Effort Estimate

6–8 hours (compose restructuring: 2h, deploy scripts: 2h, CI/CD changes: 2h, documentation: 1–2h)

## Files Likely Affected

- **NEW** `deploy/docker-compose.shared.yml`
- **NEW** `deploy/docker-compose.core.yml`
- **NEW** `deploy/docker-compose.management.yml`
- **NEW** `deploy/docker-compose.data.yml`
- **NEW** `deploy/scripts/deploy-core.sh`
- **NEW** `deploy/scripts/deploy-management.sh`
- **NEW** `deploy/scripts/deploy-data.sh`
- **NEW** `deploy/scripts/deploy-all.sh`
- **NEW** `deploy/scripts/README.md`
- **DELETE** `deploy/docker-compose.yml` (or deprecate)
- `.github/workflows/deploy.yml` — add cluster input and conditional logic
- `package.json` — update docker scripts to point to new compose files
- `docs/deployment-checklist.md` — cluster-specific steps
- `@docs/tech-reqs/12-deployment.md` — architecture diagram

## Notes

- **Profiles vs. separate files**: Docker Compose profiles are simpler but harder to read. Separate files are more explicit. The task should evaluate both and pick one; separate files are recommended for clarity.
- **Shared services**: If Redis or a message queue is added later, it goes in `docker-compose.shared.yml`.
- **Database**: The external PostgreSQL (Neon DB) is shared across all clusters. Each cluster connects to it independently. The data cluster runs migrations that affect the shared DB.
- **Monitoring**: Prometheus currently scrapes bot metrics. If clusters are separated, consider adding a Prometheus instance per cluster or using a shared Prometheus with relabeling.
- **Team ownership**: Core cluster (bot) is owned by the bot team. Management cluster (admin) is owned by the web team. Data cluster is owned by the platform team. Cluster separation makes this explicit.
