# Task 62 — Separate Deployment Environments (Prod / Dev / Testing)

**Status:** 🔲 To Do  
**Category:** DevOps / Infrastructure — High  
**Blocks:** Environment-specific bot behavior, independent staging deployments, safe testing  
**Last verified:** 2026-06-14  

---

## Goal

Separate the current single-environment deployment into three distinct, isolated environments: **production**, **development**, and **testing**. Each environment must have its own Docker Compose configuration, environment variable file, and CI/CD workflow triggers. The bot (and later admin-api and admin) must know which environment it is running in so that behavior, logging, and external integrations can be tailored per environment.

## Current State

- One `docker-compose.yml` in `deploy/` used for both local development and production
- One `.env` file (or `.env.prod` for Ansible) used for all contexts
- GitHub Actions deploy workflow triggers only on `master` branch push
- No explicit environment variable distinguishes prod from dev or testing
- Bot, admin-api, and admin share the same DATABASE_URL in production

## Required Behavior

### 1. Environment-Specific Compose Files

Create three separate Docker Compose files:

- `deploy/docker-compose.prod.yml` — production cluster (bot, admin-api, admin, migrate)
- `deploy/docker-compose.dev.yml` — local development cluster (builds from source, hot reload where possible)
- `deploy/docker-compose.test.yml` — isolated testing cluster (separate DB container, disposable services)

### 2. Environment-Specific Env Files

Create and enforce distinct env files:

- `.env.prod` — production secrets and URLs (already exists for Ansible, expand for all services)
- `.env.dev` — local development overrides (local DB, dev JWT secret, local API URLs)
- `.env.test` — testing overrides (test DB container, ephemeral tokens, mock API keys)

Update `.env.example` with all new variables and clear documentation.

### 3. CI/CD Workflow Updates

- `deploy.yml` must accept an `environment` input (`production`, `staging`, `testing`) via `workflow_dispatch`
- `push` to `master` still triggers **production** deploy automatically
- `push` to `develop` triggers **staging** deploy (new behavior)
- Manual workflow dispatch can target any environment
- Each environment deploys to a separate VPS directory or uses separate Docker Compose project names (e.g., `polyglot_prod`, `polyglot_dev`, `polyglot_test`)

### 4. Database Isolation

- **Production**: external managed PostgreSQL (Neon DB) — current behavior
- **Development**: local PostgreSQL container or shared Neon DB branch — new behavior
- **Testing**: dedicated PostgreSQL container inside `docker-compose.test.yml` — new behavior
- Ensure migrations and seed scripts run against the correct database per environment

### 5. Reverse Proxy / Ingress Separation

- Production: nginx + Let's Encrypt on real domains (current behavior)
- Development: localhost ports only (no nginx, direct port mapping)
- Testing: localhost ports or no external access at all (headless)

## Acceptance Criteria

### Compose Files
- [ ] `deploy/docker-compose.prod.yml` exists and defines bot, admin-api, admin, migrate services
- [ ] `deploy/docker-compose.dev.yml` exists and builds from local Dockerfiles with source mounts or watch mode
- [ ] `deploy/docker-compose.test.yml` exists and includes a disposable PostgreSQL container
- [ ] All compose files use `project_name` or `COMPOSE_PROJECT_NAME` to avoid container name collisions
- [ ] `deploy/docker-compose.override.yml` is removed or repurposed to avoid confusion

### Environment Variables
- [ ] `.env.example` lists all environment-specific variables with comments
- [ ] `.env.prod` is documented for Ansible and CI/CD usage
- [ ] `.env.dev` is documented for local development
- [ ] `.env.test` is documented for running integration tests
- [ ] `ENVIRONMENT` variable added to all env files (values: `production`, `development`, `testing`)
- [ ] `NODE_ENV` is kept for Node.js runtime behavior (may differ from `ENVIRONMENT`)

### CI/CD
- [ ] `.github/workflows/deploy.yml` accepts `environment` input
- [ ] `master` branch push → `production` deploy
- [ ] `develop` branch push → `staging` deploy (new branch)
- [ ] Workflow generates environment-specific image tags (e.g., `polyglot-bot:prod-{sha}`, `polyglot-bot:staging-{sha}`)
- [ ] VPS deployment script copies the correct compose file and env file per environment

### Documentation
- [ ] `@docs/tech-reqs/12-deployment.md` updated with environment-specific instructions
- [ ] `docs/deployment-checklist.md` updated with environment-specific steps
- [ ] `README.md` updated with environment startup commands

## Dependencies

- Task 56 (Docker Compose Build) — compose files already exist
- Task 63 (Parameterize Bot by Environment) — bot must read `ENVIRONMENT` variable
- Task 64 (Application Clustering) — cluster separation informs compose file grouping

## Effort Estimate

5–7 hours (compose files: 2h, env files + CI/CD: 2h, documentation + testing: 2h)

## Files Likely Affected

- **NEW** `deploy/docker-compose.prod.yml`
- **NEW** `deploy/docker-compose.dev.yml`
- **NEW** `deploy/docker-compose.test.yml`
- **DELETE** `deploy/docker-compose.override.yml` (or merge into dev)
- `.env.example` — expand with environment variables
- `.github/workflows/deploy.yml` — add environment matrix
- `@docs/tech-reqs/12-deployment.md` — update docs
- `docs/deployment-checklist.md` — update checklist

## Notes

- Keep production as the default / safest path. Devs and testers must opt-in to non-prod environments.
- The `ENVIRONMENT` variable is distinct from `NODE_ENV` to allow flexibility (e.g., `NODE_ENV=production` in a staging load-test).
- Consider using Docker Compose profiles (`--profile`) if clustering is needed before full environment separation.
