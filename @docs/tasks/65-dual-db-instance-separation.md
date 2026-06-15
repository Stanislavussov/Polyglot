# Task 65 — Dual Database Instance Separation on Single VPS

**Status:** 🔲 To Do
**Category:** DevOps / Infrastructure — High
**Blocks:** Safe testing on shared infrastructure, staging parity, environment isolation
**Last verified:** 2026-06-14

---

## Goal

Run two fully isolated application environments on the same virtual server: one **production** and one **testing**. Both share the same VPS but connect to separate database instances (e.g., two separate databases within Neon, or two separate Neon projects) with different API keys and environment variables. Use Docker Compose with separate compose files and `project_name` for each environment. Docker Swarm is explicitly out of scope — it is unnecessary for a single-node, two-environment setup.

## Current State

- Production uses external managed PostgreSQL (Neon DB) via `DATABASE_URL`
- Testing currently has no isolated database — it would share the same Neon DB instance and same bot token
- All environments (prod, dev, test) are planned to share one VPS host
- Docker Compose is used for local development and VPS deployment
- No container orchestration (Swarm/Kubernetes) is in place

## Required Behavior

### 1. Database Instance Isolation

Use separate database instances within the existing Neon DB (or managed PostgreSQL) provider:

- **Production DB** (`polyglot_prod` or separate Neon project)
  - Existing database — no migration needed
  - Separate connection string: `DATABASE_URL_PROD`
  - Dedicated API key / credentials for production

- **Testing DB** (`polyglot_test` or separate Neon project)
  - New database instance created in Neon (or managed provider)
  - Separate connection string: `DATABASE_URL_TEST`
  - Dedicated API key / credentials for testing
  - Can be wiped/recreated for clean test states
  - Independent migration lifecycle

Both databases remain externally managed (Neon DB). No self-hosted PostgreSQL containers.

### 2. API Key & Environment Separation

Each environment has its own set of keys and configuration:

- **Bot Token**: `BOT_TOKEN` (prod) vs. `BOT_TOKEN_TEST` (test) — separate Telegram bots
- **AI API Key**: `OPENROUTER_API_KEY` (shared or separate per environment)
- **JWT Secret**: `JWT_SECRET` (prod) vs. `JWT_SECRET_TEST` (test)
- **Admin Panel / API URLs**: Different domains or ports per environment
- **Environment Label**: `ENVIRONMENT=production` vs. `ENVIRONMENT=testing` (from Task 63)

### 3. Orchestration Choice: Docker Compose (Recommended) vs. Docker Swarm

**Evaluation criteria:**

| Criteria | Docker Compose (two stacks) | Docker Swarm |
|---|---|---|
| Learning curve | Low — already familiar | Medium — new concepts (services, stacks, secrets) |
| Resource isolation | Good (separate networks via `project_name`) | Better (built-in resource limits, reservations) |
| Secret management | Env files on disk | Built-in encrypted secrets |
| Rolling updates | Manual restart | Automatic, zero-downtime |
| Health checks | Basic | Built-in with auto-recovery |
| Scaling | Manual replica count | `docker service scale` |
| Service discovery | None | Built-in DNS |
| Port binding | Manual host port mapping | Ingress routing mesh |
| Future migration to K8s | N/A | Concepts overlap (services, stacks, secrets) |

**Recommendation:** Use **Docker Compose**.

- For a single VPS with two environments, Swarm is overkill. Compose gives 100% of the needed isolation with zero learning curve.
- Two compose files with explicit `project_name` (`polyglot_prod`, `polyglot_test`) create fully isolated networks, volumes, and container names. No collisions, no crossover.
- Resource limits are available in Compose v3+ via `deploy.resources` (requires Docker Engine with Swarm features enabled, but no `docker swarm init` needed).
- No secret management benefit on a single node — `.env` files on the host are equally secure if the host is secured (which it must be anyway).
- If you ever grow to 2+ nodes, migrating from Compose to Swarm is trivial (same YAML structure, just add `docker swarm init` and `docker stack deploy`).
- Save the time you would spend learning Swarm, and spend it on the actual problem: env isolation, separate DBs, and separate tokens.

### 4. Docker Compose Implementation

Create two separate Docker Compose files:

- `deploy/docker-compose.prod.yml` — production services (bot, admin-api, admin, migrate)
- `deploy/docker-compose.test.yml` — test services (bot, admin-api, admin, migrate)

Each file must declare `project_name` to ensure isolation:

```yaml
name: polyglot_prod   # in docker-compose.prod.yml
name: polyglot_test   # in docker-compose.test.yml
```

Deploy each environment independently:

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file .env.prod up -d
docker compose -f deploy/docker-compose.test.yml --env-file .env.test up -d
```

**Isolation guarantees:**
- Containers are prefixed with project name (`polyglot_prod_bot_1`, `polyglot_test_bot_1`)
- Networks are scoped to project (`polyglot_prod_default`, `polyglot_test_default`)
- Volumes are scoped to project if named explicitly (use `polyglot_prod_db-data` vs `polyglot_test_db-data` if volumes are needed later)
- No risk of one environment reaching the other's services

### 5. Database Configuration per Environment

- `DATABASE_URL_PROD` — existing Neon DB connection string for production
- `DATABASE_URL_TEST` — new Neon DB connection string for testing (different database name or project)
- Each compose project references its own `DATABASE_URL` via the respective `.env` file (`.env.prod` or `.env.test`)
- Migrations run independently against each database during deploy

### 6. Backup & Migration Strategy

- **Production DB**: Backups remain as currently handled by Neon DB (managed backups)
- **Test DB**: Optional `pg_dump` snapshot before destructive operations, or simply recreate via Neon dashboard
- No self-hosted backup scripts needed — Neon handles production backups

### 7. Resource Limits

- Production bot: `reservations` memory=256MB, `limits` memory=512MB
- Test bot: `reservations` memory=128MB, `limits` memory=256MB
- Production admin-api: `reservations` memory=128MB, `limits` memory=256MB
- Test admin-api: `reservations` memory=64MB, `limits` memory=128MB
- Admin panel (prod + test): `reservations` memory=64MB, `limits` memory=128MB

### 8. Monitoring & Alerts

- Prometheus scrapes metrics from both environments (use `prometheus.io/environment` labels)
- Alert if `polyglot_prod` bot service is down (critical)
- Alert if `polyglot_test` bot service is down (warning, non-blocking)
- Database connectivity alerts from application health checks (not from DB host itself)

## Acceptance Criteria

### Docker Compose Setup
- [ ] `deploy/docker-compose.prod.yml` exists with `name: polyglot_prod` and defines all production services (bot, admin-api, admin, migrate)
- [ ] `deploy/docker-compose.test.yml` exists with `name: polyglot_test` and defines all test services (bot, admin-api, admin, migrate)
- [ ] Both environments deploy successfully with `docker compose up -d`
- [ ] Environments are isolated: services in one project cannot reach the other project's services

### Database Configuration
- [ ] `DATABASE_URL_PROD` points to existing Neon DB production database
- [ ] `DATABASE_URL_TEST` points to new Neon DB test database (separate DB name or project)
- [ ] Migrations run successfully against each database independently
- [ ] Production database is never affected by test environment deploys or migrations

### API Keys & Environment
- [ ] `BOT_TOKEN` and `BOT_TOKEN_TEST` are separate Telegram bot tokens
- [ ] `JWT_SECRET` and `JWT_SECRET_TEST` are separate secrets
- [ ] `ENVIRONMENT` variable is set correctly per environment (`production` vs `testing`)
- [ ] Each environment has its own `.env` file (`.env.prod`, `.env.test`)

### CI/CD Integration
- [ ] `deploy.yml` workflow builds images for both environments (or only changed environment)
- [ ] VPS deploy step deploys the correct compose file based on branch (`master` → prod, `develop` → test)
- [ ] Manual workflow dispatch can target either environment

### Documentation
- [ ] `docs/deployment-checklist.md` updated with dual-environment deploy steps
- [ ] `@docs/tech-reqs/12-deployment.md` updated with environment architecture diagram
- [ ] `README.md` updated with environment startup commands
- [ ] New `deploy/README.md` explains compose file structure and commands
- [ ] Neon DB documentation updated with test database setup instructions

### Resource Limits
- [ ] All services in both environments have `deploy.resources.reservations` and `deploy.resources.limits`
- [ ] Test services use fewer resources than production services

## Dependencies

- Task 62 (Separate Deployment Environments) — environment-specific compose files
- Task 63 (Parameterize Bot by Environment) — bot must use correct `DATABASE_URL` and token per env
- Task 64 (Application Clustering) — cluster separation informs compose file structure

## Effort Estimate

3–4 hours (Compose files: 1h, env files + CI/CD: 1h, docs + testing: 1–2h)

## Files Likely Affected

- **NEW** `deploy/docker-compose.prod.yml`
- **NEW** `deploy/docker-compose.test.yml`
- **NEW** `deploy/README.md`
- **DELETE** `deploy/docker-compose.override.yml` (or merge into `docker-compose.test.yml`)
- `.env.example` — add `DATABASE_URL_PROD`, `DATABASE_URL_TEST`, `BOT_TOKEN_TEST`, `JWT_SECRET_TEST`
- `.env.prod` — new env file for production
- `.env.test` — new env file for testing
- `.github/workflows/deploy.yml` — add environment-specific deploy steps
- `docs/deployment-checklist.md` — add dual-environment deploy steps
- `@docs/tech-reqs/12-deployment.md` — add environment architecture diagram
- `deploy/docker-compose.yml` — deprecated or removed in favor of `docker-compose.prod.yml`

## Notes

- **Neon DB stays external:** Both production and test databases are managed by Neon (or your existing provider). No self-hosted PostgreSQL. This keeps backups, scaling, and maintenance handled by the provider.
- **Database separation options:** You can either create a new database within the same Neon project (`polyglot_test` alongside `polyglot_prod`) or create a separate Neon project for complete isolation. The task is agnostic — just use different `DATABASE_URL` values.
- **Why not Docker Swarm?** For a single VPS with two environments, Swarm adds complexity without real benefit. Compose with `project_name` gives full isolation. If you later grow to 2+ nodes, migrating from Compose to Swarm is trivial (same YAML structure, just add `docker swarm init` and `docker stack deploy`).
- **Env file security:** `.env` files live on the VPS host. Secure the host (SSH keys, firewall, no root login) and the env files are safe. If you need stronger secret management later, consider a vault or Swarm secrets — but don't optimize prematurely.
- **Test environment reset:** To completely reset the test environment, run `docker compose -f deploy/docker-compose.test.yml down -v` and redeploy. The test database can be wiped via Neon dashboard or a migration script.
- **Port mapping:** Use explicit host ports per environment to avoid collisions. For example, production admin panel on `4321`, test admin panel on `4322`. Or use a reverse proxy with host-based routing (e.g., `admin.polyglot.com` vs `admin-test.polyglot.com`).
- **Cost implication:** Two Neon databases may increase cost slightly. Evaluate Neon pricing for a second database vs. separate project. If cost is a concern, consider using a single Neon project with two database names (`polyglot_prod` and `polyglot_test`).
